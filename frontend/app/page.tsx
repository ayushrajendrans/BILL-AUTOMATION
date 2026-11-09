"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { FileUpload } from "@/components/file-upload"
import { Button } from "@/components/ui/button"
import { Loader2, Download, CheckCircle, AlertCircle, Sparkles, X } from "lucide-react"
import { motion } from "framer-motion"
import { BackgroundBeams } from "@/components/ui/background-beams"
import { fitUpload, splitUploads } from "@/lib/upload-batches"
import { loadArchive, pruneSavedArchives } from "@/lib/billing-downloads"

const apiUrl = "/api"
const jobKey = "billing_job"
const downloadKey = "billing_downloads"
const isJobId = (id: unknown): id is string => typeof id === "string" && /^[a-f0-9]{32}$/.test(id)
type Status = "idle" | "processing" | "success" | "error" | "paused"
type DownloadPart = { id: string, total: number, skipped: number, review: number }
type UploadQueue = { batches: File[][], next: number, results: DownloadPart[] }

class MissingJob extends Error {}

function readStorage(key: string) {
  try { return sessionStorage.getItem(key) } catch { return null }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key)
    else sessionStorage.setItem(key, value)
  } catch {
    // Storage can be disabled without preventing uploads.
  }
}

function readDownloads(): DownloadPart[] {
  try {
    const value = JSON.parse(readStorage(downloadKey) || "[]")
    return Array.isArray(value) ? value.filter(part => isJobId(part?.id)
      && Number.isFinite(part.total) && Number.isFinite(part.skipped) && Number.isFinite(part.review)) : []
  } catch { return [] }
}

async function readResponse(response: Response, fallback: string) {
  const body = await response.json().catch(() => null)
  if (!response.ok || !body) {
    throw new Error(typeof body?.detail === "string" ? body.detail : fallback)
  }
  return body
}

export default function Dashboard() {
  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState<Status>("idle")
  const [message, setMessage] = useState("")
  const [elapsed, setElapsed] = useState(0)
  const [jobId, setJobId] = useState<string | null>(null)
  const [downloads, setDownloads] = useState<DownloadPart[]>([])
  const [downloadLinks, setDownloadLinks] = useState<Record<string, string>>({})
  const [downloadNotice, setDownloadNotice] = useState("")
  const [cancelPending, setCancelPending] = useState(false)
  const uploadController = useRef<AbortController | null>(null)
  const activeJob = useRef<string | null>(null)
  const queue = useRef<UploadQueue | null>(null)
  const completed = useRef<DownloadPart[]>([])
  const uncheckedDownloads = useRef<DownloadPart[]>([])
  const archiveUrls = useRef(new Map<string, string>())

  const setActiveJob = useCallback((id: string | null) => {
    activeJob.current = id
    setJobId(id)
    writeStorage(jobKey, id)
  }, [])

  const saveDownloads = useCallback((parts: DownloadPart[]) => {
    completed.current = parts
    setDownloads(parts)
    const saved = new Map([...uncheckedDownloads.current, ...parts].map(part => [part.id, part]))
    writeStorage(downloadKey, JSON.stringify([...saved.values()]))
  }, [])

  const rememberArchive = useCallback(async (id: string, signal: AbortSignal) => {
    if (archiveUrls.current.has(id)) return true
    const blob = await loadArchive(id, signal)
    signal.throwIfAborted()
    if (!blob) return false
    if (!archiveUrls.current.has(id)) {
      const url = URL.createObjectURL(blob)
      archiveUrls.current.set(id, url)
      setDownloadLinks(links => ({ ...links, [id]: url }))
    }
    return true
  }, [])

  useEffect(() => {
    if (status !== "processing") return
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [status])

  const trackJob = useCallback(async (id: string, prefix: string, signal: AbortSignal): Promise<DownloadPart> => {
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
        if (++failures >= 3) throw new Error("Could not check this batch. Resume it to try again.")
        setMessage(prefix + "Connection interrupted. Reconnecting...")
      } else {
        if (response.status === 404) throw new MissingJob("The server no longer has this batch.")
        const job = await readResponse(response, "Unable to check this batch.")
        failures = 0
        if (job.status === "error" || job.status === "cancelled") {
          setActiveJob(null)
          throw new Error(job.message || "This batch did not finish.")
        }
        if (job.status === "ready") {
          return { id, total: job.total, skipped: Number(job.failed) || 0, review: Number(job.review) || 0 }
        }
        setMessage(`${prefix}${job.stage}: ${job.completed} of ${job.total} posters checked.`)
      }
      await new Promise(resolve => window.setTimeout(resolve, 1000))
    }
    signal.throwIfAborted()
    throw new Error("Batch tracking stopped.")
  }, [setActiveJob])

  const processQueue = useCallback(async (signal: AbortSignal) => {
    const pending = queue.current
    const results = pending?.results ?? []
    let retriedPart = -1
    while (activeJob.current || (pending && pending.next < pending.batches.length)) {
      signal.throwIfAborted()
      const batch = pending?.batches[pending.next]
      const prefix = pending && pending.batches.length > 1
        ? `Part ${pending.next + 1} of ${pending.batches.length}: ` : ""
      let id = activeJob.current
      if (!id && batch) {
        setMessage(prefix + "Uploading posters...")
        const formData = new FormData()
        for (const file of batch) {
          const upload = await fitUpload(file)
          signal.throwIfAborted()
          formData.append("files", upload)
        }
        const response = await fetch(`${apiUrl}/jobs`, {
          method: "POST", body: formData,
          signal: AbortSignal.any([signal, AbortSignal.timeout(125_000)]),
        })
        const result = await readResponse(response, "The billing service could not accept this upload.")
        if (!isJobId(result.id)) throw new Error("The billing service returned an invalid batch ID.")
        id = result.id
        setActiveJob(id)
      }
      if (!id) break
      let part: DownloadPart
      try {
        part = await trackJob(id, prefix, AbortSignal.any([signal, AbortSignal.timeout(270_000)]))
        setMessage(prefix + "Saving Excel ZIP...")
        let saved: boolean
        try {
          saved = await rememberArchive(id, signal)
        } catch (error) {
          signal.throwIfAborted()
          throw new Error("Could not retrieve the finished ZIP. Resume the batch to try again.", { cause: error })
        }
        if (!saved) throw new MissingJob("The server no longer has this ZIP.")
      } catch (error) {
        if (!(error instanceof MissingJob)) throw error
        setActiveJob(null)
        if (pending && batch && retriedPart !== pending.next) {
          retriedPart = pending.next
          setMessage(prefix + "The server lost this part. Retrying it...")
          await new Promise(resolve => window.setTimeout(resolve, 1500))
          continue
        }
        throw new Error(batch
          ? "This part was lost again. Process the remaining posters to retry."
          : "This batch is no longer on the server. Select its posters again to retry.")
      }
      signal.throwIfAborted()
      saveDownloads([...completed.current.filter(previous => previous.id !== part.id), part])
      results.push(part)
      setActiveJob(null)
      if (pending) pending.next++
      if (batch && part.skipped === 0) {
        const exported = new Set(batch)
        setFiles(current => current.filter(file => !exported.has(file)))
      }
    }
    queue.current = null
    const count = results.reduce((sum, part) => sum + part.total - part.skipped, 0)
    const skipped = results.reduce((sum, part) => sum + part.skipped, 0)
    const review = results.reduce((sum, part) => sum + part.review, 0)
    setMessage(skipped || review
      ? `${count} posters exported. ${skipped} skipped, ${review} need review. See processing-report.txt in the ZIPs.`
      : count === 1 ? "1 poster exported." : `All ${count} posters exported.`)
    setStatus("success")
  }, [rememberArchive, saveDownloads, setActiveJob, trackJob])

  const run = useCallback(async () => {
    if (uploadController.current) return
    const controller = new AbortController()
    uploadController.current = controller
    setElapsed(0)
    setStatus("processing")
    try {
      await processQueue(controller.signal)
    } catch (error) {
      if (uploadController.current !== controller || controller.signal.reason === "cancel") return
      if (controller.signal.reason === "pause") {
        setStatus("paused")
        setMessage("Tracking paused. Resume to continue this selection.")
      } else {
        if (!activeJob.current) queue.current = null
        setStatus("error")
        setMessage(error instanceof DOMException && error.name === "TimeoutError"
          ? activeJob.current ? "Waiting timed out. Resume the batch to check its result." : "Upload timed out. Please try again."
          : error instanceof Error && error.message !== "Failed to fetch"
            ? error.message : "Could not connect to the billing service. Check that the backend is running.")
      }
    } finally {
      if (uploadController.current === controller) uploadController.current = null
    }
  }, [processQueue])

  useEffect(() => {
    const restoreController = new AbortController()
    const urls = archiveUrls.current
    const restore = window.setTimeout(() => {
      const oldDownloads = readDownloads()
      void pruneSavedArchives().catch(() => undefined)
      void (async () => {
        const available: DownloadPart[] = []
        let expired = 0
        const unchecked: DownloadPart[] = []
        for (const part of oldDownloads) {
          if (restoreController.signal.aborted) return
          try {
            if (await rememberArchive(part.id, restoreController.signal)) available.push(part)
            else expired++
          } catch {
            unchecked.push(part)
          }
        }
        if (restoreController.signal.aborted) return
        uncheckedDownloads.current = unchecked
        const merged = new Map([...available, ...completed.current].map(part => [part.id, part]))
        saveDownloads([...merged.values()])
        setDownloadNotice([
          expired ? "Expired download links were removed." : "",
          unchecked.length ? "Some downloads could not be checked. Refresh to retry." : "",
        ].filter(Boolean).join(" "))
      })()
      const id = readStorage(jobKey)
      if (isJobId(id)) {
        setActiveJob(id)
        setMessage("Checking your previous batch...")
        void run()
      }
    }, 0)
    return () => {
      window.clearTimeout(restore)
      restoreController.abort()
      for (const url of urls.values()) URL.revokeObjectURL(url)
      urls.clear()
      const controller = uploadController.current
      uploadController.current = null
      controller?.abort()
    }
  }, [rememberArchive, run, saveDownloads, setActiveJob])

  const handleUpload = () => {
    if (!files.length || uploadController.current || activeJob.current) return
    queue.current = { batches: splitUploads(files), next: 0, results: [] }
    void run()
  }

  const resume = () => {
    if (!activeJob.current && !queue.current) return
    setMessage("Checking your batch...")
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
        if (!response.ok && response.status !== 404) {
          throw new Error("Could not cancel this batch.")
        }
      }
      queue.current = null
      setActiveJob(null)
      setStatus("idle")
      setMessage("")
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
                  isProcessing={status === "processing" || status === "paused" || jobId !== null}
                />
              </div>

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

              {downloadNotice && <p role="status" className="text-sm text-neutral-400">{downloadNotice}</p>}

              {downloads.length > 0 && (
                <ul aria-label="Completed downloads" className="max-h-64 space-y-2 overflow-y-auto">
                  {downloads.map((part, index) => (
                    <li key={part.id}>
                      <Button asChild size="lg" className="w-full bg-white text-black hover:bg-neutral-200">
                        <a href={downloadLinks[part.id]} download={`billing_${part.id.slice(0, 8)}.zip`}>
                          <Download className="mr-2 h-4 w-4 shrink-0" />
                          {downloads.length === 1 ? "Download Excel ZIP" : `Download ZIP ${index + 1}`}
                        </a>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap justify-end gap-3 pt-4">
                {status === "processing" && jobId && (
                  <Button variant="outline" onClick={() => uploadController.current?.abort("pause")} disabled={cancelPending}>
                    Pause tracking
                  </Button>
                )}
                {(status === "processing" || status === "paused" || (jobId && status === "error")) && (
                  <Button variant="outline" onClick={cancel} disabled={cancelPending}>
                    <X className="mr-2 h-4 w-4" />
                    Cancel batch
                  </Button>
                )}
                {(status === "paused" || (jobId && status === "error")) && (
                  <Button variant="outline" onClick={resume} disabled={cancelPending}>Resume batch</Button>
                )}
                <Button
                  size="lg"
                  onClick={handleUpload}
                  disabled={files.length === 0 || status === "processing" || status === "paused" || cancelPending || jobId !== null}
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
