import type { SupabaseClient } from "@supabase/supabase-js";
import { LedgerError, type Group, type LedgerStore, type StoredGroup } from "./ledger";
import { configured, publicClient, sessionClient } from "./supabase";

export function databaseError(error: { code?: string; message: string }): never {
  if (error.code === "28000") throw new LedgerError("UNAUTHENTICATED", "Sign in or connect a valid agent token.", 401);
  if (error.code === "40001") throw new LedgerError("VERSION_CONFLICT", "The group changed. Please try again.", 409);
  if (error.code === "42501") throw new LedgerError("FORBIDDEN", "You do not have access to this ledger.", 403);
  if (error.code === "P0002") throw new LedgerError("NOT_FOUND", "Group not found.", 404);
  console.error("Supabase operation failed", { code: error.code });
  throw new LedgerError("STORAGE_ERROR", "Could not save or load the ledger. Please try again.", 503);
}

export class SupabaseStore implements LedgerStore {
  constructor(private client: SupabaseClient, private token: string | null = null) {}
  async read(groupId?: string): Promise<StoredGroup[]> {
    const { data, error } = await this.client.rpc("splitzii_read", { p_group_id: groupId || null, p_token: this.token });
    if (error) databaseError(error);
    return data as StoredGroup[];
  }
  async write(group: Group, expectedVersion: number | null): Promise<StoredGroup> {
    const { data, error } = await this.client.rpc("splitzii_write", { p_group_id: group.id, p_data: group, p_expected_version: expectedVersion, p_token: this.token });
    if (error) databaseError(error);
    return data as StoredGroup;
  }
}

export async function requestStore(request: Request, requireAgent = false) {
  if (!configured()) throw new LedgerError("NOT_CONFIGURED", "Supabase connection is not configured yet.", 503);
  const authorization = request.headers.get("authorization");
  if (authorization) {
    if (!authorization.startsWith("Bearer splitzii_")) throw new LedgerError("UNAUTHENTICATED", "Use a Splitzii agent token from Settings.", 401);
    const store = new SupabaseStore(publicClient(), authorization.slice(7));
    // Validate the credential even for MCP initialize and tools/list.
    await store.read("00000000-0000-4000-8000-000000000000");
    return store;
  }
  if (requireAgent) throw new LedgerError("UNAUTHENTICATED", "Connect using a Splitzii agent token from Settings.", 401);
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== new URL(request.url).origin) throw new LedgerError("FORBIDDEN", "Open the app to make this change.", 403);
  const client = await sessionClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) throw new LedgerError("UNAUTHENTICATED", "Sign in with Google to continue.", 401);
  return new SupabaseStore(client);
}
