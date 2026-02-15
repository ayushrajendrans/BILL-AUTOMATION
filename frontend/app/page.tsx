"use client"

import { useState, useEffect } from "react"
import { FileUpload } from "@/components/file-upload"
import { Button } from "@/components/ui/button"
import { Loader2, Download, CheckCircle, AlertCircle, Sparkles, LogOut } from "lucide-react"
import { motion } from "framer-motion"
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

  const notifyLogin = async (user: any) => {
    // Prevent duplicate notifications in the same session
    // DEBUG: Commented out to force testing email on every refresh
    // if (sessionStorage.getItem("login_notified")) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      if (!apiUrl) {
        const msg = "NEXT_PUBLIC_API_URL is missing! Check Vercel Env Vars.";
        console.error(msg);
        alert(msg);
        return;
      }
      const response = await fetch(`${apiUrl}/notify-login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: user.user_metadata?.full_name || "Unknown User",
          email: user.email,
        }),
      });

      const result = await response.json();

      if (result.status === 'failed') {
        console.error("Login notification failed:", result.message);
        // PROD TODO: Remove this alert after debugging
        alert(`Debug: Email Notification Failed\nReason: ${result.message}`);
      } else {
        sessionStorage.setItem("login_notified", "true");
        console.log("Login notification sent successfully.");
        alert("Debug: Email Notification Sent Successfully!");
      }
    } catch (error) {
      console.error("Failed to send login notification:", error);
      alert(`Debug: Email Notification Network Error\n${error}`);
    }
  }

  useEffect(() => {
    console.log("Dashboard mounted, initiating auth check...");

    // Check if env vars are loaded
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error("CRITICAL: Supabase environment variables are missing!");
      setMessage("Error: Supabase configuration missing. Check .env.local");
      setStatus('error');
      setLoadingAuth(false);
      return;
    }

    const checkUser = async () => {
      try {
        console.log("Calling supabase.auth.getSession()...");
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          console.error("Supabase auth error:", error);
          throw error;
        }

        if (!data.session?.user) {
          console.log("No active session, redirecting to /login...");
          router.push('/login')
        } else {
          console.log("Session found:", data.session.user.email);
          setUser(data.session.user)
          notifyLogin(data.session.user)
        }
      } catch (e) {
        console.error("Error in checkUser (caught):", e);
        console.log("Redirecting to /login due to error...");
        router.push('/login');
      } finally {
        setLoadingAuth(false)
      }
    }



    checkUser()
  }, [])

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    sessionStorage.removeItem("login_notified")
    router.push('/login')
  }

  const handleUpload = async () => {
    if (files.length === 0) return

    setStatus('processing')
    setMessage("Analyzing posters with AI...")

    const formData = new FormData()
    files.forEach((file) => {
      formData.append("files", file)
    })

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      if (!apiUrl) throw new Error("NEXT_PUBLIC_API_URL is not set");

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
    <div className="relative min-h-screen w-full overflow-hidden bg-neutral-950 text-white selection:bg-purple-500 selection:text-white">
      <BackgroundBeams />

      <div className="absolute top-4 right-4 z-50">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSignOut}
          className="bg-red-500/10 border-red-500/50 text-red-200 hover:bg-red-500/20 hover:text-red-100 transition-colors"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (user) notifyLogin(user);
            else alert("No user found to test email with.");
          }}
          className="ml-2 bg-blue-500/10 border-blue-500/50 text-blue-200 hover:bg-blue-500/20 hover:text-blue-100 transition-colors"
        >
          Test Email
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            if (user) notifyLogin(user);
            else alert("No user found to test email with.");
          }}
          className="ml-2 bg-blue-500/10 border-blue-500/50 text-blue-200 hover:bg-blue-500/20 hover:text-blue-100 transition-colors"
        >
          Test Email
        </Button>
      </div>

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center p-8">
        <motion.div
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

          {user && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.8 }}
              className="flex flex-col items-center gap-2"
            >
              <div className="flex items-center gap-2 bg-white/10 px-4 py-2 rounded-full border border-white/5">
                {user.user_metadata?.avatar_url && (
                  <img src={user.user_metadata.avatar_url} alt="Profile" className="w-6 h-6 rounded-full" />
                )}
                <span className="text-sm font-medium text-white">
                  Welcome, {user.user_metadata?.full_name || user.email}
                </span>
              </div>
              <span className="text-xs text-neutral-500">{user.email}</span>
            </motion.div>
          )}

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
