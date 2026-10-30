import { sessionClient } from "@/lib/supabase";
import { errorResponse, redirect } from "@/lib/http";
import { LedgerError } from "@/lib/ledger";

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new LedgerError("FORBIDDEN", "Open the app to sign out.", 403);
    const client = await sessionClient();
    await client.auth.signOut();
    return redirect(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin, 303);
  } catch (error) { return errorResponse(error); }
}
