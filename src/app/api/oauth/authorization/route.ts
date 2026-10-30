import { z } from "zod";
import { sessionClient } from "@/lib/supabase";
import { authorizationId, consentReturnPath } from "@/lib/oauth";
import { errorResponse, json, redirect } from "@/lib/http";
import { LedgerError } from "@/lib/ledger";

export async function GET(request: Request) {
  try {
    const id = authorizationId(new URL(request.url).searchParams.get("authorization_id"));
    const client = await sessionClient();
    const { data: user, error: userError } = await client.auth.getClaims();
    if (userError || !user?.claims?.sub) {
      const next = consentReturnPath(`/oauth/consent?authorization_id=${id}`);
      return json({ sign_in_url: `/auth/login?next=${encodeURIComponent(next)}` });
    }
    const { data, error } = await client.auth.oauth.getAuthorizationDetails(id);
    if (error || !data) throw new LedgerError("OAUTH_ERROR", "This connection could not be opened. Please connect again from your agent.", 400);
    return json(data);
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) throw new LedgerError("FORBIDDEN", "Open the connection screen to continue.", 403);
    const form = await request.formData();
    const id = authorizationId(form.get("authorization_id"));
    const action = z.enum(["approve", "deny"]).parse(form.get("action"));
    const client = await sessionClient();
    const { data: user, error: userError } = await client.auth.getClaims();
    if (userError || !user?.claims?.sub) throw new LedgerError("UNAUTHENTICATED", "Sign in with Google to continue.", 401);
    const { data, error } = action === "approve"
      ? await client.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })
      : await client.auth.oauth.denyAuthorization(id, { skipBrowserRedirect: true });
    if (error || !data?.redirect_url) throw new LedgerError("OAUTH_ERROR", "Please connect again from your agent.", 400);
    // Supabase validates the client's registered callback and carries PKCE/state.
    return redirect(data.redirect_url, 303);
  } catch (error) { return errorResponse(error); }
}
