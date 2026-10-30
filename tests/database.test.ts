import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { execute, type GroupSummary } from "../src/lib/ledger";
import { database, databaseStore } from "./support";

test("SQL migration persists a ledger and a personal token can read and update its owner's group", async () => {
  const db = await database();
  try {
    const store = databaseStore(db);
    const group = await execute(store, "create_group", { request_id: crypto.randomUUID(), name: "Database dinner", participant_names: ["Me", "Sam", "Alex"] }) as GroupSummary;
    const loaded = await execute(store, "get_group", { group_id: group.id }) as GroupSummary;
    assert.equal(loaded.name, "Database dinner");
    const token = `splitzii_${crypto.randomUUID()}`;
    const hash = createHash("sha256").update(token).digest("hex");
    const created = await db.query<{ data: { id: string } }>("select public.splitzii_tokens('create', 'Muse', $1) as data", [hash]);
    const tokenId = created.rows[0].data.id;
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;");
    const agent = databaseStore(db, token);
    const updated = await execute(agent, "add_expense", { request_id: crypto.randomUUID(), group_id: group.id, description: "Dinner", amount_minor: 9000, paid_by_participant_id: group.participants[0].id, split_between_participant_ids: group.participants.map(p => p.id), date: "2026-10-30" }) as GroupSummary;
    assert.deepEqual(updated.balances.map(b => b.amount_minor), [6000, -3000, -3000]);
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false); set role authenticated;`);
    assert.equal((await execute(store, "get_group", { group_id: group.id }) as GroupSummary).expenses[0].description, "Dinner");
    const revoked = await db.query<{ data: { deleted: boolean } }>("select public.splitzii_tokens('delete', null, null, $1) as data", [tokenId]);
    assert.equal(revoked.rows[0].data.deleted, true);
  } finally { await db.close(); }
});
