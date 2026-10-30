import { sessionClient } from "@/lib/supabase";
import { redirect } from "@/lib/http";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const code = url.searchParams.get("code");
  if (code) {
    const client = await sessionClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return redirect(origin);
  }
  return redirect(`${origin}/?auth_error=google`);
}
