import { configured, sessionClient } from "@/lib/supabase";
import { redirect } from "@/lib/http";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin).origin;
  // Start PKCE on the callback's host so the verifier cookie returns with it.
  if (requestUrl.origin !== origin) return redirect(`${origin}/auth/login`);
  if (!configured()) return redirect(`${origin}/?auth_error=setup`);
  const client = await sessionClient();
  const { data, error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/auth/callback` } });
  if (error || !data.url) return redirect(`${origin}/?auth_error=google`);
  return redirect(data.url);
}
