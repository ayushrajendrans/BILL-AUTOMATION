"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { FileUpload } from "@/components/file-upload"
import { Button } from "@/components/ui/button"
import { Loader2, Download, CheckCircle, AlertCircle, Sparkles, X } from "lucide-react"
import { motion } from "framer-motion"
import { BackgroundBeams } from "@/components/ui/background-beams"
import { fitUpload, splitUploads } from "@/lib/upload-batches"

const apiUrl = "/api"
const isJobId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{32}$/.test(id)
const retryableUploadStatuses = new Set([408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524])
type Status = "idle" | "processing" | "success" | "error" | "paused"
type PosterRow = { club_name: string, date: string, month: string, thumbnail: string }
type PartSummary = { total: number, skipped: number, review: number }
type PartResult = PartSummary & { rows: PosterRow[], notes: string[] }
type UploadQueue = {
  batches: File[][], next: number, total: number, checked: number, results: PartResult[],
  retried: Set<number>, cooledDown: Set<number>,
  uploadId?: string,
}

class MissingJob extends Error {}

function waitForRetry(milliseconds: number, signal: AbortSignal) {
  signal.throwIfAborted()
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, milliseconds)
    signal.addEventListener("abort", abort, { once: true })
  })
}

async function readResponse(response: Response, fallback: string) {
  const body = await response.json().catch(() => null)
  if (!response.ok || !body) {
    throw new Error(typeof body?.detail === "string" ? body.detail : fallback)
  }
  return body
}

async function uploadPart(formData: FormData, signal: AbortSignal, onRetry: () => void) {
  const retryDelays = [2000, 6000]
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    const lastAttempt = attempt === retryDelays.length
    let response: Response | undefined
    try {
      response = await fetch(`${apiUrl}/jobs`, {
        method: "POST", body: formData,
        signal: AbortSignal.any([signal, AbortSignal.timeout(125_000)]),
      })
    } catch (error) {
      if (signal.aborted || lastAttempt) throw error
    }
    if (response && (lastAttempt || !retryableUploadStatuses.has(response.status))) return response
    onRetry()
    await waitForRetry(retryDelays[attempt], signal)
  }
}

export default function Dashboard() {
  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState<Status>("idle")
  const [message, setMessage] = useState("")
  const [elapsed, setElapsed] = useState(0)
  const [progress, setProgress] = useState<{ checked: number, total: number } | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState("")
  const [canResume, setCanResume] = useState(false)
  const [canExportPartial, setCanExportPartial] = useState(false)
  const [cancelPending, setCancelPending] = useState(false)
  const uploadController = useRef<AbortController | null>(null)
  const activeJob = useRef<string | null>(null)
  const queue = useRef<UploadQueue | null>(null)
  const archiveUrl = useRef("")

  const setActiveJob = useCallback((id: string | null) => {
    activeJob.current = id
    setJobId(id)
  }, [])

  const replaceDownload = useCallback((url: string) => {
    if (archiveUrl.current) URL.revokeObjectURL(archiveUrl.current)
    archiveUrl.current = url
    setDownloadUrl(url)
  }, [])

  useEffect(() => {
    if (status !== "processing") return
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [status])

  const trackJob = useCallback(async (id: string, prefix: string, signal: AbortSignal): Promise<PartSummary> => {
    let failures = 0
    while (!signal.aborted) {
      let response: Response | null = null
      try {
        response = await fetch(`${apiUrl}/jobs/${id}`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
          cache: "no-store",
        })
      } catch (error) {
        if (signal.aborted) throw error
      }
      if (!response || response.status >= 500) {
        if (++failures >= 4) throw new Error("Could not check this part. Resume to reconnect.")
        setMessage(prefix + "Connection interrupted. Reconnecting...")
      } else {
        if (response.status === 404) throw new MissingJob("The server no longer has this part.")
        const job = await readResponse(response, "Unable to check this part.")
        failures = 0
        if (job.status === "error" || job.status === "cancelled") {
          setActiveJob(null)
          throw new Error(job.message || "This part did not finish.")
        }
        if (job.status === "ready") {
          return { total: job.total, skipped: Number(job.failed) || 0, review: Number(job.review) || 0 }
        }
        setMessage(`${prefix}${job.stage}: ${job.completed} of ${job.total} posters checked.`)
      }
      await new Promise(resolve => window.setTimeout(resolve, 1000))
    }
    signal.throwIfAborted()
    throw new Error("Batch tracking stopped.")
  }, [setActiveJob])

  const processQueue = useCallback(async (signal: AbortSignal, exportPartial: boolean) => {
    const pending = queue.current
    if (!pending) return
    while (!exportPartial && pending.next < pending.batches.length) {
      signal.throwIfAborted()
      let batch = pending.batches[pending.next]
      const prefix = pending.batches.length > 1
        ? `Part ${pending.next + 1} of ${pending.batches.length}: ` : ""
      let id = activeJob.current
      if (!id) {
        setMessage(prefix + "Uploading posters...")
        const formData = new FormData()
        formData.append("extract_only", "true")
        const skipped = new Set<File>()
        const notes: string[] = []
        for (const file of batch) {
          try {
            formData.append("files", await fitUpload(file))
          } catch {
            skipped.add(file)
            notes.push(`Skipped ${file.name}: The browser could not prepare this image for upload.`)
          }
          signal.throwIfAborted()
        }
        if (skipped.size) {
          pending.results.push({ total: skipped.size, skipped: skipped.size, review: 0, rows: [], notes })
          pending.checked += skipped.size
          setProgress({ checked: pending.checked, total: pending.total })
          setFiles(current => current.filter(file => !skipped.has(file)))
          batch = batch.filter(file => !skipped.has(file))
          pending.batches[pending.next] = batch
          if (!batch.length) {
            pending.next++
            continue
          }
        }
        pending.uploadId ??= crypto.randomUUID().replaceAll("-", "")
        formData.append("job_id", pending.uploadId)
        const response = await uploadPart(formData, signal, () => {
          setMessage(prefix + "Upload interrupted. Retrying this part...")
        })
        const result = await readResponse(response, response.ok
          ? prefix + "The server returned an unreadable upload response. Resume to try again."
          : prefix + `The upload failed (HTTP ${response.status}). Resume to try again.`)
        const createdId: unknown = result.id
        if (!isJobId(createdId)) throw new Error("The billing service returned an invalid batch ID.")
        id = createdId
        setActiveJob(id)
        pending.uploadId = undefined
      }

      try {
        const part = await trackJob(id, prefix, AbortSignal.any([signal, AbortSignal.timeout(270_000)]))
        const response = await fetch(`${apiUrl}/jobs/${id}/results`, {
          signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
          cache: "no-store",
        })
        if (response.status === 404) throw new MissingJob("The server no longer has this part.")
        const data = await readResponse(response, "Could not retrieve the extracted poster details. Resume to try again.")
        if (!Array.isArray(data.rows) || !Array.isArray(data.notes)) {
          throw new Error("The billing service returned invalid poster details.")
        }
        const retryIndices: unknown[] = Array.isArray(data.retry_indices) ? data.retry_indices : []
        const retry = new Set(retryIndices.filter((index): index is number =>
          typeof index === "number" && Number.isInteger(index) && index >= 0 && index < batch.length))
        if (data.rows.length + part.skipped + retry.size !== batch.length) {
          throw new Error("The billing service returned an incomplete part. Resume to check it again.")
        }
        signal.throwIfAborted()
        if (data.rows.length || data.notes.length) {
          pending.results.push({ ...part, rows: data.rows, notes: data.notes })
        }
        pending.checked += batch.length - retry.size
        setProgress({ checked: pending.checked, total: pending.total })
        setCanExportPartial(pending.results.some(result => result.rows.length > 0))
        setActiveJob(null)
        const processed = new Set(batch.filter((_, index) => !retry.has(index)))
        setFiles(current => current.filter(file => !processed.has(file)))
        if (retry.size) {
          pending.batches[pending.next] = batch.filter((_, index) => retry.has(index))
          const delay = Number(data.retry_after)
          if (Number.isFinite(delay) && delay >= 1 && delay <= 90 && !pending.cooledDown.has(pending.next)) {
            pending.cooledDown.add(pending.next)
            setMessage(`Waiting for the analysis service. Retrying the remaining posters in ${Math.ceil(delay)} seconds.`)
            await waitForRetry(Math.ceil(delay * 1000), signal)
            continue
          }
          setStatus("paused")
          setMessage(typeof data.retry_message === "string"
            ? `${data.retry_message} Resume when ready; completed posters are kept.`
            : "Processing paused. Resume to retry the remaining posters.")
          return
        }
        pending.next++
      } catch (error) {
        if (!(error instanceof MissingJob)) throw error
        setActiveJob(null)
        if (pending.retried.has(pending.next)) {
          throw new Error("The server lost this part again. Resume to retry the remaining posters.")
        }
        pending.retried.add(pending.next)
        setMessage(prefix + "The server lost this part. Retrying it...")
        await new Promise(resolve => window.setTimeout(resolve, 1500))
      }
    }

    const rows = pending.results.flatMap(part => part.rows)
    const notes = pending.results.flatMap(part => part.notes)
    const skipped = pending.results.reduce((sum, part) => sum + part.skipped, 0)
    const review = pending.results.reduce((sum, part) => sum + part.review, 0)
    if (!rows.length) {
      queue.current = null
      setCanResume(false)
      setCanExportPartial(false)
      setProgress(null)
      throw new Error("No readable posters were found. Try again with clearer images.")
    }
    setMessage("Grouping posters by club and creating the Excel ZIP...")
    const response = await fetch(`${apiUrl}/exports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows, notes }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(115_000)]),
    })
    if (!response.ok) await readResponse(response, "Could not build the Excel ZIP. Resume to try again.")
    if (!response.headers.get("Content-Type")?.includes("application/zip")) {
      throw new Error("The server did not return an Excel ZIP. Resume to try again.")
    }
    const archive = await response.blob()
    signal.throwIfAborted()
    replaceDownload(URL.createObjectURL(archive))
    queue.current = null
    setCanResume(false)
    setCanExportPartial(false)
    const exported = `${rows.length} poster${rows.length === 1 ? "" : "s"} exported.`
    setMessage([
      exported,
      exportPartial ? "This ZIP includes only the posters processed so far." : "",
      skipped || review ? `${skipped} skipped, ${review} need review. See processing-report.txt in the ZIP.` : "",
    ].filter(Boolean).join(" "))
    setStatus("success")
  }, [replaceDownload, setActiveJob, trackJob])

  const run = useCallback(async (exportPartial = false) => {
    if (uploadController.current || !queue.current) return
    const controller = new AbortController()
    uploadController.current = controller
    setElapsed(0)
    setStatus("processing")
    try {
      await processQueue(controller.signal, exportPartial)
    } catch (error) {
      if (uploadController.current !== controller || controller.signal.reason === "cancel") return
      if (controller.signal.reason === "pause") {
        setStatus("paused")
        setMessage("Processing paused. Resume to continue this selection.")
      } else {
        setStatus("error")
        setMessage(error instanceof DOMException && error.name === "TimeoutError"
          ? "The request timed out. Resume to try again without losing completed posters."
          : error instanceof Error && error.message !== "Failed to fetch"
            ? error.message : "Could not connect to the billing service. Resume to try again.")
      }
    } finally {
      if (uploadController.current === controller) uploadController.current = null
    }
  }, [processQueue])

  useEffect(() => {
    try {
      sessionStorage.removeItem("billing_job")
      sessionStorage.removeItem("billing_downloads")
    } catch {
      // Storage can be disabled without preventing uploads.
    }
    void window.caches?.delete("billing-archives-v1").catch(() => undefined)
    return () => {
      if (archiveUrl.current) URL.revokeObjectURL(archiveUrl.current)
      archiveUrl.current = ""
      const controller = uploadController.current
      uploadController.current = null
      controller?.abort()
    }
  }, [])

  const handleUpload = () => {
    if (!files.length || uploadController.current || queue.current) return
    replaceDownload("")
    queue.current = {
      batches: splitUploads(files), next: 0, total: files.length, checked: 0, results: [],
      retried: new Set(), cooledDown: new Set(),
    }
    setProgress({ checked: 0, total: files.length })
    setCanResume(true)
    void run()
  }

  const resume = () => {
    const pending = queue.current
    if (!pending) return
    pending.retried.delete(pending.next)
    pending.cooledDown.delete(pending.next)
    setMessage("Resuming processing...")
    void run()
  }

  const cancel = async () => {
    setCancelPending(true)
    uploadController.current?.abort("cancel")
    try {
      const id = activeJob.current
      if (id) {
        const response = await fetch(`${apiUrl}/jobs/${id}`, {
          method: "DELETE", signal: AbortSignal.timeout(12_000),
        })
        if (!response.ok && response.status !== 404) throw new Error("Could not cancel this part.")
      }
      setActiveJob(null)
      if ((id || status === "processing") && queue.current?.results.length) {
        setStatus("paused")
        setMessage("Processing stopped. Resume or export the posters already processed.")
      } else {
        queue.current = null
        setCanResume(false)
        setCanExportPartial(false)
        setProgress(null)
        setStatus("idle")
        setMessage("")
      }
    } catch {
      setStatus("error")
      setMessage("Could not cancel the batch. Resume to check whether it is still running.")
    } finally {
      setCancelPending(false)
    }
  }

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-neutral-950 text-white selection:bg-purple-500 selection:text-white">
      <BackgroundBeams />

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-4 sm:p-8">
        <motion.div
          className="mb-12 text-center space-y-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <h1 className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-4xl font-bold sm:text-6xl text-transparent md:text-7xl">
              ClubBill AI
            </h1>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.8 }}
            className="text-lg text-neutral-400 md:text-xl max-w-2xl mx-auto"
          >
            Poster billing
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="w-full max-w-3xl"
        >
          <section aria-label="Poster batch" className="rounded-lg border border-white/15 bg-neutral-900/90 p-4 sm:p-6">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-white">Upload Posters</h2>
                  <p className="text-sm text-neutral-400">JPG, PNG & WEBP</p>
                </div>
                <Sparkles className="h-6 w-6 text-purple-400 animate-pulse" />
              </div>

              <div className="bg-neutral-900/50 rounded-lg p-1 border border-white/5">
                <FileUpload
                  files={files}
                  onFilesSelected={setFiles}
                  isProcessing={canResume}
                />
              </div>

              {canResume && progress && (
                <div className="space-y-1 text-sm text-neutral-300">
                  <p>{progress.checked} of {progress.total} posters checked</p>
                  <progress aria-label="Posters checked" value={progress.checked} max={progress.total}
                    className="h-2 w-full accent-emerald-400" />
                </div>
              )}

              {status === 'processing' && (
                <div role="status" aria-live="polite" className="flex items-center gap-2 text-sm text-neutral-300">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  <p>{message} {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")} elapsed</p>
                </div>
              )}

              {(status === "error" || status === "paused") && (
                <div
                  role="alert"
                  className="p-4 rounded-md bg-red-500/10 border border-red-500/20 text-red-200 flex items-center gap-2"
                >
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  <p className="min-w-0 break-words">{message}</p>
                </div>
              )}

              {status === 'success' && (
                <div
                  role="status"
                  className="p-4 rounded-md bg-green-500/10 border border-green-500/20 text-green-200 flex items-center gap-2"
                >
                  <CheckCircle className="h-5 w-5 shrink-0" />
                  <p className="min-w-0 break-words">{message}</p>
                </div>
              )}

              {downloadUrl && (
                <Button asChild size="lg" className="w-full bg-white text-black hover:bg-neutral-200">
                  <a href={downloadUrl} download="billing_files.zip">
                    <Download className="mr-2 h-4 w-4 shrink-0" />
                    Download Excel ZIP
                  </a>
                </Button>
              )}

              <div className="flex flex-wrap justify-end gap-3 pt-4">
                {status === "processing" && jobId && (
                  <Button variant="outline" onClick={() => uploadController.current?.abort("pause")} disabled={cancelPending}>
                    Pause tracking
                  </Button>
                )}
                {canResume && (
                  <Button variant="outline" onClick={cancel} disabled={cancelPending}>
                    <X className="mr-2 h-4 w-4" />
                    {status === "processing" || jobId ? "Cancel batch" : "Discard batch"}
                  </Button>
                )}
                {canResume && (status === "paused" || status === "error") && (
                  <Button variant="outline" onClick={resume} disabled={cancelPending}>Resume processing</Button>
                )}
                {canExportPartial && !jobId && (status === "paused" || status === "error") && (
                  <Button variant="outline" onClick={() => void run(true)} disabled={cancelPending}>
                    <Download className="mr-2 h-4 w-4" /> Export processed posters
                  </Button>
                )}
                <Button
                  size="lg"
                  onClick={handleUpload}
                  disabled={files.length === 0 || canResume || cancelPending}
                  className="w-full sm:w-auto bg-white text-black hover:bg-neutral-200 transition-all duration-300 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:shadow-[0_0_30px_rgba(255,255,255,0.5)]"
                >
                  {status === 'processing' ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Process posters
                    </>
                  )}
                </Button>
              </div>
            </div>
          </section>
        </motion.div>
      </div>
    </div>
  )
}
