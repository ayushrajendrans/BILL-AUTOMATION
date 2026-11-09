"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { FileUpload } from "@/components/file-upload"
import { Button } from "@/components/ui/button"
import { Loader2, Download, CheckCircle, AlertCircle, Sparkles, X } from "lucide-react"
import { motion } from "framer-motion"
import { BackgroundBeams } from "@/components/ui/background-beams"

const apiUrl = "/api"
const jobKey = "billing_job"
type Status = "idle" | "processing" | "success" | "error" | "paused"

function savedJob(id?: string | null) {
  try {
    if (id === undefined) {
      const saved = sessionStorage.getItem(jobKey)
      return saved && /^[a-f0-9]{32}$/.test(saved) ? saved : null
    }
    if (id) sessionStorage.setItem(jobKey, id)
    else sessionStorage.removeItem(jobKey)
  } catch {
    // Storage can be disabled without preventing uploads.
  }
  return null
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
  const [downloadUrl, setDownloadUrl] = useState("")
  const [cancelPending, setCancelPending] = useState(false)
  const uploadController = useRef<AbortController | null>(null)

  useEffect(() => {
    if (status !== "processing") return
    const started = Date.now()
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [status])

  const trackJob = useCallback(async (id: string, signal: AbortSignal) => {
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
        setMessage("Connection interrupted. Reconnecting...")
      } else {
        if (response.status === 404) {
          savedJob(null)
          setJobId(null)
        }
        const job = await readResponse(response, "Unable to check this batch.")
        failures = 0
        if (job.status === "error" || job.status === "cancelled") {
          savedJob(null)
          setJobId(null)
          throw new Error(job.message || "This batch did not finish.")
        }
        if (job.status === "ready") {
          const skipped = Number(job.failed) || 0
          const review = Number(job.review) || 0
          setDownloadUrl(`${apiUrl}/jobs/${id}/download`)
          setMessage(skipped || review
            ? `ZIP ready. ${job.total - skipped} of ${job.total} exported. ${skipped} skipped, ${review} need review. See processing-report.txt.`
            : `Your Excel ZIP is ready. All ${job.total} posters exported.`)
          setStatus("success")
          return
        }
        setMessage(`${job.stage}: ${job.completed} of ${job.total} posters checked.`)
      }
      await new Promise(resolve => window.setTimeout(resolve, 1000))
    }
    signal.throwIfAborted()
  }, [])

  const run = useCallback(async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (uploadController.current) return
    const controller = new AbortController()
    uploadController.current = controller
    const timeout = window.setTimeout(() => controller.abort("timeout"), 270_000)
    setElapsed(0)
    setStatus("processing")
    try {
      await operation(controller.signal)
    } catch (error) {
      if (uploadController.current !== controller || controller.signal.reason === "cancel") return
      if (controller.signal.reason === "pause") {
        setStatus("paused")
        setMessage("Tracking paused. Resume to check this batch.")
      } else {
        setStatus("error")
        setMessage(controller.signal.reason === "timeout"
          ? "Waiting timed out. Resume the batch to check its result."
          : error instanceof Error && error.message !== "Failed to fetch"
            ? error.message : "Could not connect to the billing service. Check that the backend is running.")
      }
    } finally {
      window.clearTimeout(timeout)
      if (uploadController.current === controller) uploadController.current = null
    }
  }, [])

  useEffect(() => {
    const restore = window.setTimeout(() => {
      const id = savedJob()
      if (id) {
        setJobId(id)
        setMessage("Checking your previous batch...")
        void run(signal => trackJob(id, signal))
      }
    }, 0)
    return () => {
      window.clearTimeout(restore)
      const controller = uploadController.current
      uploadController.current = null
      controller?.abort()
    }
  }, [run, trackJob])

  const handleUpload = () => {
    if (!files.length || uploadController.current) return
    if (files.length > 50 || files.reduce((total, file) => total + file.size, 0) > 95 * 1024 * 1024) {
      setStatus("error")
      setMessage("Select at most 50 posters and keep each batch under 95 MB.")
      return
    }
    setMessage("Uploading posters...")
    setJobId(null)
    void run(async signal => {
      const formData = new FormData()
      files.forEach(file => formData.append("files", file))
      const response = await fetch(`${apiUrl}/jobs`, { method: "POST", body: formData, signal })
      const result = await readResponse(response, "The billing service could not accept this upload.")
      if (typeof result.id !== "string" || !/^[a-f0-9]{32}$/.test(result.id)) {
        throw new Error("The billing service returned an invalid batch ID.")
      }
      savedJob(result.id)
      setJobId(result.id)
      await trackJob(result.id, signal)
    })
  }

  const resume = () => {
    if (!jobId) return
    setMessage("Checking your batch...")
    void run(signal => trackJob(jobId, signal))
  }

  const cancel = async () => {
    setCancelPending(true)
    try {
      if (jobId) {
        const response = await fetch(`${apiUrl}/jobs/${jobId}`, {
          method: "DELETE", signal: AbortSignal.timeout(12_000),
        })
        if (!response.ok && response.status !== 404) {
          throw new Error("Could not cancel this batch. Try again.")
        }
      }
      uploadController.current?.abort("cancel")
      savedJob(null)
      setJobId(null)
      setStatus("idle")
      setMessage("")
    } catch {
      setMessage("Could not cancel the batch. It may still be running.")
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
                  isProcessing={status === 'processing'}
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

              {downloadUrl && (
                <Button asChild size="lg" className="w-full bg-white text-black hover:bg-neutral-200">
                  <a href={downloadUrl}>
                    <Download className="mr-2 h-4 w-4" />
                    {status === "success" ? "Download Excel ZIP" : "Download last Excel ZIP"}
                  </a>
                </Button>
              )}

              <div className="flex flex-wrap justify-end gap-3 pt-4">
                {status === "processing" && jobId && (
                  <Button variant="outline" onClick={() => uploadController.current?.abort("pause")} disabled={cancelPending}>
                    Pause tracking
                  </Button>
                )}
                {(status === "processing" || (jobId && (status === "paused" || status === "error"))) && (
                  <Button variant="outline" onClick={cancel} disabled={cancelPending}>
                    <X className="mr-2 h-4 w-4" />
                    Cancel batch
                  </Button>
                )}
                {jobId && (status === "paused" || status === "error") && (
                  <Button variant="outline" onClick={resume} disabled={cancelPending}>Resume batch</Button>
                )}
                <Button
                  size="lg"
                  onClick={handleUpload}
                  disabled={files.length === 0 || status === "processing" || cancelPending || (jobId !== null && status !== "success")}
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
