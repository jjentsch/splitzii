import type { SupabaseClient } from "@supabase/supabase-js";
import { LedgerError, type Group, type LedgerStore, type StoredGroup, type PeopleAction, type ActivityPage } from "./ledger";
import { configured, publicClient, sessionClient } from "./supabase";
import { databaseError } from "./database-errors";
import { validAgentClaims } from "./oauth";

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
  async people(action: PeopleAction, args: object = {}) {
    const { data, error } = await this.client.rpc("splitzii_people", { p_action: action, p_args: args, p_token: this.token });
    if (error) databaseError(error);
    return data;
  }
  async activity(args: { cursor: string; group_id?: string; limit: number }): Promise<ActivityPage> {
    const { data, error } = await this.client.rpc("splitzii_activity", { p_cursor: args.cursor, p_group_id: args.group_id || null, p_limit: args.limit, p_token: this.token });
    if (error) databaseError(error);
    return data;
  }
}

export async function requestStore(request: Request, requireAgent = false) {
  if (!configured()) throw new LedgerError("NOT_CONFIGURED", "Supabase connection is not configured yet.", 503);
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const token = /^Bearer (\S+)$/i.exec(authorization)?.[1];
    if (!token) throw new LedgerError("UNAUTHENTICATED", "Sign in with Google to connect your agent.", 401);
    // Keep already-issued personal tokens working; new connections use OAuth.
    if (token.startsWith("splitzii_")) {
      const store = new SupabaseStore(publicClient(), token);
      await store.read("00000000-0000-4000-8000-000000000000");
      return store;
    }
    const client = publicClient(token);
    const { data, error } = await client.auth.getClaims(token);
    if (error || !data?.claims || !validAgentClaims(data.claims)) throw new LedgerError("UNAUTHENTICATED", "Reconnect your agent with Google.", 401);
    return new SupabaseStore(client);
  }
  if (requireAgent) throw new LedgerError("UNAUTHENTICATED", "Sign in with Google to connect your agent.", 401);
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== new URL(request.url).origin) throw new LedgerError("FORBIDDEN", "Open the app to make this change.", 403);
  const client = await sessionClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) throw new LedgerError("UNAUTHENTICATED", "Sign in with Google to continue.", 401);
  return new SupabaseStore(client);
}
