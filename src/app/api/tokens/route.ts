import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { LedgerError } from "@/lib/ledger";
import { configured, sessionClient } from "@/lib/supabase";
import { databaseError } from "@/lib/store";
import { errorResponse, json } from "@/lib/http";

export const dynamic = "force-dynamic";
async function handle(request: Request) {
  try {
    if (!configured()) throw new LedgerError("NOT_CONFIGURED", "Supabase is not configured.", 503);
    if (request.method !== "GET" && request.headers.get("origin") !== new URL(request.url).origin) throw new LedgerError("FORBIDDEN", "Manage tokens from the app.", 403);
    const client = await sessionClient();
    const { data: identity, error: identityError } = await client.auth.getClaims();
    if (identityError || !identity?.claims.sub) throw new LedgerError("UNAUTHENTICATED", "Sign in to manage agent tokens.", 401);
    if (request.method === "POST") {
      const input = z.object({ name: z.string().trim().min(1).max(120) }).parse(await request.json());
      const token = `splitzii_${randomBytes(32).toString("base64url")}`;
      const hash = createHash("sha256").update(token).digest("hex");
      const { data, error } = await client.rpc("splitzii_tokens", { p_action: "create", p_name: input.name, p_hash: hash });
      if (error) databaseError(error);
      return json({ ...data, token });
    }
    const tokenId = request.method === "DELETE" ? z.uuid().parse(new URL(request.url).searchParams.get("id")) : undefined;
    const { data, error } = await client.rpc("splitzii_tokens", { p_action: request.method === "DELETE" ? "delete" : "list", p_id: tokenId });
    if (error) databaseError(error);
    return json(data);
  } catch (error) { return errorResponse(error); }
}
export { handle as GET, handle as POST, handle as DELETE };
