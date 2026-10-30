import { configured, sessionClient } from "@/lib/supabase";
import { errorResponse, json } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function GET() {
  if (!configured()) return json({ configured: false, user: null });
  try {
    const client = await sessionClient();
    const { data, error } = await client.auth.getClaims();
    if (error || !data?.claims?.sub) return json({ configured: true, user: null });
    return json({ configured: true, user: { id: data.claims.sub, email: data.claims.email } });
  } catch (error) { return errorResponse(error); }
}
