import { sessionClient } from "@/lib/supabase";
import { redirect } from "@/lib/http";
import { consentReturnPath } from "@/lib/oauth";
import { cookies } from "next/headers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const code = url.searchParams.get("code");
  const jar = await cookies();
  const next = consentReturnPath(jar.get("splitzii_auth_next")?.value);
  jar.set("splitzii_auth_next", "", { path: "/auth", maxAge: 0 });
  if (code) {
    const client = await sessionClient();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) return redirect(`${new URL(origin).origin}${next}`);
  }
  return redirect(`${origin}/?auth_error=google`);
}
