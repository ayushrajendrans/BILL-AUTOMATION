
'use client'

import { createClient } from '@/utils/supabase/client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function LoginPage() {
    const router = useRouter()
    const supabase = createClient()
    const [loading, setLoading] = useState(false)
    const [message, setMessage] = useState('')

    const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setLoading(true)
        setMessage('')

        const formData = new FormData(e.currentTarget)
        const email = formData.get('email') as string
        const password = formData.get('password') as string

        if (!email || !password) {
            setMessage('Please fill in all fields')
            setLoading(false)
            return
        }

        // Try Login
        const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
        })

        if (error) {
            // If login fails, try signup automatically (Optional UX choice, or separate buttons)
            // For simplicity, let's just show error. User can use Signup if we add a tab.
            // Let's make this a "Sign In / Sign Up" dual form for simplicity?
            // Actually, let's just use Sign In and show error.
            setMessage(error.message)
        } else {
            router.push('/')
            router.refresh()
        }
        setLoading(false)
    }

    const handleGoogleLogin = async () => {
        setLoading(true)
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        })
        if (error) setMessage(error.message)
        setLoading(false)
    }

    const handleSignUp = async (e: React.FormEvent<HTMLFormElement>) => {
        // Logic for signup
        // For now let's just use login.
        // Supabase supports magic links too.
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 font-sans text-zinc-100">
            <div className="w-full max-w-md space-y-8 rounded-2xl bg-zinc-900 p-8 shadow-xl border border-zinc-800">
                <div className="text-center">
                    <h2 className="mt-6 text-3xl font-extrabold text-white">ClubBill AI</h2>
                    <p className="mt-2 text-sm text-zinc-400">Sign in to your account</p>
                </div>

                <div className="space-y-4">
                    <button
                        onClick={handleGoogleLogin}
                        className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-4 py-3 text-black transition hover:bg-zinc-200 disabled:opacity-50"
                        disabled={loading}
                    >
                        {loading ? <Loader2 className="animate-spin" /> : (
                            <svg className="h-5 w-5" viewBox="0 0 24 24">
                                <path
                                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                    fill="#4285F4"
                                />
                                <path
                                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                    fill="#34A853"
                                />
                                <path
                                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                    fill="#FBBC05"
                                />
                                <path
                                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                    fill="#EA4335"
                                />
                            </svg>
                        )}
                        <span className="font-medium">Continue with Google</span>
                    </button>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-zinc-700" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-zinc-900 px-2 text-zinc-400">Or continue with email</span>
                        </div>
                    </div>

                    <form className="mt-8 space-y-6" onSubmit={handleLogin}>
                        <div className="-space-y-px rounded-md shadow-sm">
                            <div>
                                <label htmlFor="email-address" className="sr-only">Email address</label>
                                <input
                                    id="email-address"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    className="relative block w-full rounded-t-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-white placeholder-zinc-400 focus:z-10 focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm"
                                    placeholder="Email address"
                                />
                            </div>
                            <div>
                                <label htmlFor="password" className="sr-only">Password</label>
                                <input
                                    id="password"
                                    name="password"
                                    type="password"
                                    autoComplete="current-password"
                                    required
                                    className="relative block w-full rounded-b-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-white placeholder-zinc-400 focus:z-10 focus:border-indigo-500 focus:outline-none focus:ring-indigo-500 sm:text-sm"
                                    placeholder="Password"
                                />
                            </div>
                        </div>

                        {message && (
                            <div className="text-red-400 text-sm text-center bg-red-900/20 p-2 rounded">
                                {message}
                            </div>
                        )}

                        <div>
                            <button
                                type="submit"
                                disabled={loading}
                                className="group relative flex w-full justify-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
                            >
                                {loading ? <Loader2 className="animate-spin h-5 w-5" /> : "Sign in"}
                            </button>
                        </div>
                        <p className="text-center text-xs text-zinc-500">
                            Don't have an account? Sign up is automatic on first login (if enabled) or ask admin.
                        </p>
                    </form>
                </div>
            </div>
        </div>
    )
}
