import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { LedgerError, type Group, type LedgerStore, type StoredGroup } from "../src/lib/ledger";

export const ownerId = "11111111-1111-4111-8111-111111111111";
export async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    insert into auth.users(id) values ('${ownerId}');`);
  await db.exec(await readFile(new URL("../supabase/migrations/20261030135023_initial_ledger.sql", import.meta.url), "utf8"));
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${ownerId}', false);`);
  return db;
}

export function databaseStore(db: PGlite, token: string | null = null): LedgerStore {
  return {
    async read(groupId?: string) {
      const result = await db.query<{ data: StoredGroup[] }>("select public.splitzii_read($1, $2) as data", [groupId || null, token]);
      return result.rows[0].data;
    },
    async write(data, expectedVersion) {
      try {
        const result = await db.query<{ data: StoredGroup }>("select public.splitzii_write($1, $2, $3, $4) as data", [data.id, data, expectedVersion, token]);
        return result.rows[0].data;
      } catch (error) {
        if ((error as { code: string }).code === "40001") throw new LedgerError("VERSION_CONFLICT", "Changed", 409);
        throw error;
      }
    },
  };
}

export function memoryStore(): LedgerStore {
  const groups = new Map<string, StoredGroup>();
  return {
    async read(id) { return structuredClone(id ? [...groups.values()].filter(g => g.data.id === id) : [...groups.values()]); },
    async write(data: Group, expectedVersion) {
      const previous = groups.get(data.id);
      if (previous && previous.version !== expectedVersion) throw new LedgerError("VERSION_CONFLICT", "Changed", 409);
      const stored = { data: structuredClone(data), version: (previous?.version || 0) + 1 };
      groups.set(data.id, stored); return structuredClone(stored);
    },
  };
}
