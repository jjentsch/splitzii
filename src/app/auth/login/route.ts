import { configured, sessionClient } from "@/lib/supabase";

export async function GET(request: Request) {
  const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  if (!configured()) return Response.redirect(`${origin}/?auth_error=setup`);
  const client = await sessionClient();
  const { data, error } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${origin}/auth/callback` } });
  if (error || !data.url) return Response.redirect(`${origin}/?auth_error=google`);
  return Response.redirect(data.url);
}
