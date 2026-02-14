"use client"

import { useState, useRef, useEffect } from "react"
import { FileUpload } from "@/components/file-upload"
import { Button } from "@/components/ui/button"
import { Loader2, Download, CheckCircle, AlertCircle, Sparkles, LogOut } from "lucide-react"
import { motion, useScroll, useTransform } from "framer-motion"
import { BackgroundBeams } from "@/components/ui/background-beams"
import { TiltCard } from "@/components/ui/tilt-card"
import { createClient } from "@/utils/supabase/client"
import { useRouter } from "next/navigation"

export default function Dashboard() {
  const [files, setFiles] = useState<File[]>([])
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState("")
  const [user, setUser] = useState<any>(null)
  const [loadingAuth, setLoadingAuth] = useState(true)

  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
      } else {
        setUser(user)
      }
      setLoadingAuth(false)
    }
    checkUser()
  }, [router, supabase])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const targetRef = useRef(null)
  const { scrollYProgress } = useScroll({
    target: targetRef,
    offset: ["start start", "end start"],
  })

  const opacity = useTransform(scrollYProgress, [0, 0.5], [1, 0])
  const scale = useTransform(scrollYProgress, [0, 0.5], [1, 0.8])
  const y = useTransform(scrollYProgress, [0, 0.5], [0, -50])

  const handleUpload = async () => {
    if (files.length === 0) return

    setStatus('processing')
    setMessage("Analyzing posters with AI...")

    const formData = new FormData()
    files.forEach((file) => {
      formData.append("files", file)
    })

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

      // Get session for token
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      const response = await fetch(`${apiUrl}/process-bills`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`
        },
        body: formData,
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`Server Error: ${response.status} ${errorText}`)
      }

      // Download the ZIP file
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `billing_files_${new Date().getTime()}.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)

      setStatus('success')
      setMessage("Files processed and downloaded!")
      setFiles([]) // Reset
    } catch (error: any) {
      console.error(error)
      setStatus('error')
      setMessage(error.message || "An error occurred during processing.")
    }
  }

  if (loadingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-white">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    )
  }

  if (!user) return null

  return (
    <div ref={targetRef} className="relative min-h-screen w-full overflow-hidden bg-neutral-950 text-white selection:bg-purple-500 selection:text-white">
      <BackgroundBeams />

      <div className="absolute top-4 right-4 z-50">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSignOut}
          className="text-neutral-400 hover:text-white hover:bg-white/10"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      </div>

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-8">
        <motion.div
          style={{ opacity, scale, y }}
          className="mb-12 text-center space-y-4"
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <h1 className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-6xl font-bold tracking-tight text-transparent md:text-8xl">
              ClubBill AI
            </h1>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.4, duration: 0.8 }}
            className="text-lg text-neutral-400 md:text-xl max-w-2xl mx-auto"
          >
            Experience the next dimension of automated billing.
            Drag, drop, and let the AI handle the rest.
          </motion.p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, scale: 0.9, rotateX: 20 }}
          animate={{ opacity: 1, scale: 1, rotateX: 0 }}
          transition={{ delay: 0.2, duration: 0.8, type: "spring" }}
          className="w-full max-w-4xl [perspective:1000px]"
        >
          <TiltCard className="group">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-semibold text-white">Upload Posters</h2>
                  <p className="text-sm text-neutral-400">Support for JPG, PNG, WEBP & ZIP</p>
                </div>
                <Sparkles className="h-6 w-6 text-purple-400 animate-pulse" />
              </div>

              <div className="bg-neutral-900/50 rounded-lg p-1 border border-white/5">
                <FileUpload
                  onFilesSelected={setFiles}
                  isProcessing={status === 'processing'}
                />
              </div>

              {status === 'error' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="p-4 rounded-md bg-red-500/10 border border-red-500/20 text-red-200 flex items-center gap-2"
                >
                  <AlertCircle className="w-5 h-5" />
                  <p>{message}</p>
                </motion.div>
              )}

              {status === 'success' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="p-4 rounded-md bg-green-500/10 border border-green-500/20 text-green-200 flex items-center gap-2"
                >
                  <CheckCircle className="w-5 h-5" />
                  <p>{message}</p>
                </motion.div>
              )}

              <div className="flex justify-end pt-4">
                <Button
                  size="lg"
                  onClick={handleUpload}
                  disabled={files.length === 0 || status === 'processing'}
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
                      Process & Download
                    </>
                  )}
                </Button>
              </div>
            </div>
          </TiltCard>
        </motion.div>
      </div>
    </div>
  )
}
