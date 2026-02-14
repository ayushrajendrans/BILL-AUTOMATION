
import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
    // The `/auth/callback` route is required for the server-side auth flow to work properly.
    // The Auth Helpers package exchanges an auth code for the user's session.
    // https://supabase.com/docs/guides/auth/auth-helpers/nextjs#managing-session-with-middleware
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get("code");
    const origin = requestUrl.origin;
    const redirectTo = requestUrl.searchParams.get("redirect_to")?.toString();

    if (code) {
        console.log("Auth Callback: Received code", code);
        const supabase = await createClient();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
            console.error("Auth Callback: Code exchange failed", error);
            return NextResponse.redirect(`${origin}/login?error=auth_code_error`);
        }
        console.log("Auth Callback: Session exchanged successfully");
    } else {
        console.log("Auth Callback: No code received");
    }

    if (redirectTo) {
        return NextResponse.redirect(`${origin}${redirectTo}`);
    }

    // URL to redirect to after sign in process completes
    return NextResponse.redirect(`${origin}/`);
}
