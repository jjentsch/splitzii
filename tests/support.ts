import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { databaseError } from "../src/lib/database-errors";
import { LedgerError, type Group, type LedgerStore, type StoredGroup, type User } from "../src/lib/ledger";

export const ownerId = "11111111-1111-4111-8111-111111111111";
export async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('${ownerId}','hobby@example.com',now(),'{"full_name":"Owner"}');`);
  for (const name of (await readdir(new URL("../supabase/migrations/", import.meta.url))).filter(n => n.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8"));
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${ownerId}', false);`);
  return db;
}

export function databaseStore(db: PGlite, token: string | null = null): LedgerStore {
  return {
    async people(action, args = {}) {
      try { return (await db.query<{ data: unknown }>("select public.splitzii_people($1,$2,$3) as data", [action,args,token])).rows[0].data; } catch (error) { databaseError(error as { code: string; message: string }); }
    },
    async activity(args) {
      return (await db.query<{ data: import("../src/lib/ledger").ActivityPage }>("select public.splitzii_activity($1,$2,$3,$4) as data", [args.cursor,args.group_id || null,args.limit,token])).rows[0].data;
    },
    async read(groupId?: string) {
      const result = await db.query<{ data: StoredGroup[] }>("select public.splitzii_read($1, $2) as data", [groupId || null, token]);
      return result.rows[0].data;
    },
    async write(data, expectedVersion) {
      try {
        const result = await db.query<{ data: StoredGroup }>("select public.splitzii_write($1, $2, $3, $4) as data", [data.id, data, expectedVersion, token]);
        return result.rows[0].data;
      } catch (error) { databaseError(error as { code: string; message: string }); }
    },
  };
}

export function memoryStore(): LedgerStore {
  const groups = new Map<string, StoredGroup>();
  const friends: import("../src/lib/ledger").Friend[] = [];
  const user: User = { user_id: ownerId, name: "Owner", email: "hobby@example.com" };
  return {
    async people(action, input = {}) {
      const args = input as Record<string, string>;
      if (action === "get_current_user") return user;
      if (action === "list_friends") return friends;
      if (action === "search_users") return args.user_id === user.user_id || args.query === user.email || args.query === user.name ? [user] : [];
      if (action === "add_friend") { const friend = { id: args.request_id, name: args.name, email: args.email, user_id: args.user_id, created_at: new Date().toISOString() }; friends.push(friend); return friend; }
      return { removed: true };
    },
    async activity(args) { return { events: [], next_cursor: args.cursor, has_more: false }; },
    async read(id) { return structuredClone(id ? [...groups.values()].filter(g => g.data.id === id) : [...groups.values()]); },
    async write(data: Group, expectedVersion) {
      const previous = groups.get(data.id);
      if (previous && previous.version !== expectedVersion) throw new LedgerError("VERSION_CONFLICT", "Changed", 409);
      const stored = { data: structuredClone(data), version: (previous?.version || 0) + 1 };
      groups.set(data.id, stored); return structuredClone(stored);
    },
  };
}
