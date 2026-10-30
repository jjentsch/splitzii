import { configured, sessionClient } from "@/lib/supabase";
import { redirect } from "@/lib/http";

export async function GET(request: Request) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  if (!configured()) return redirect(`${origin}/?auth_error=setup`);
  const client = await sessionClient();
  const { data, error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/auth/callback` } });
  if (error || !data.url) return redirect(`${origin}/?auth_error=google`);
  return redirect(data.url);
}
