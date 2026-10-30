import { configured, sessionClient } from "@/lib/supabase";
import { redirect } from "@/lib/http";
import { consentReturnPath } from "@/lib/oauth";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin).origin;
  const next = consentReturnPath(requestUrl.searchParams.get("next"));
  // Start PKCE on the callback's host so the verifier cookie returns with it.
  if (requestUrl.origin !== origin) return redirect(`${origin}/auth/login?next=${encodeURIComponent(next)}`);
  if (!configured()) return redirect(`${origin}/?auth_error=setup`);
  const client = await sessionClient();
  (await cookies()).set("splitzii_auth_next", next, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/auth", maxAge: 600 });
  const { data, error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/auth/callback` } });
  if (error || !data.url) return redirect(`${origin}/?auth_error=google`);
  return redirect(data.url);
}
