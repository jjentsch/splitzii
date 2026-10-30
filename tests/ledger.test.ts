import assert from "node:assert/strict";
import { test } from "node:test";
import { execute, type GroupSummary } from "../src/lib/ledger";
import { memoryStore } from "./support";
import { serveMcp } from "../src/lib/mcp-http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("shared dinner, external repayment, corrections, and exact cent splitting", async () => {
  const store = memoryStore();
  let group = await execute(store, "create_group", { request_id: crypto.randomUUID(), name: "Weekend", participant_names: ["Me", "Sam", "Alex"] }) as GroupSummary;
  const [me, sam, alex] = group.participants;
  const requestId = crypto.randomUUID();
  group = await execute(store, "add_expense", { request_id: requestId, group_id: group.id, description: "Dinner", amount_minor: 9000, paid_by_participant_id: me.id, split_between_participant_ids: [me.id, sam.id, alex.id], date: "2026-10-30" }) as GroupSummary;
  assert.deepEqual(group.balances.map(b => b.amount_minor), [6000, -3000, -3000]);
  group = await execute(store, "record_repayment", { request_id: crypto.randomUUID(), group_id: group.id, from_participant_id: sam.id, to_participant_id: me.id, amount_minor: 3000, date: "2026-10-30" }) as GroupSummary;
  assert.deepEqual(group.balances.map(b => b.amount_minor), [3000, 0, -3000]);
  assert.deepEqual(group.suggested_repayments, [{ from_participant_id: alex.id, to_participant_id: me.id, amount_minor: 3000 }]);
  const snackId = crypto.randomUUID();
  group = await execute(store, "add_expense", { request_id: snackId, group_id: group.id, description: "Snacks", amount_minor: 1000, paid_by_participant_id: alex.id, split_between_participant_ids: [me.id, sam.id, alex.id], date: "2026-10-30" }) as GroupSummary;
  assert.equal(group.expenses[1].shares.reduce((sum, share) => sum + share.amount_minor, 0), 1000);
  assert.deepEqual(group.expenses[1].shares.map(s => s.amount_minor), [334, 333, 333]);
  group = await execute(store, "update_expense", { group_id: group.id, expense_id: snackId, amount_minor: 1200, description: "Road snacks" }) as GroupSummary;
  assert.equal(group.total_expenses_minor, 10200);
  group = await execute(store, "delete_expense", { group_id: group.id, expense_id: snackId }) as GroupSummary;
  assert.equal(group.expenses.length, 1);
  assert.deepEqual(group.balances.map(b => b.amount_minor), [3000, 0, -3000]);
  group = await execute(store, "delete_repayment", { group_id: group.id, repayment_id: group.repayments[0].id }) as GroupSummary;
  assert.deepEqual(group.balances.map(b => b.amount_minor), [6000, -3000, -3000]);
  group = await execute(store, "add_participant", { request_id: crypto.randomUUID(), group_id: group.id, name: "Jo" }) as GroupSummary;
  assert.equal(group.balances[3].amount_minor, 0);
  assert.equal((await execute(store, "list_groups", {}) as object[]).length, 1);
});

test("MCP client discovers tools and records and reads an expense", async () => {
  const store = memoryStore();
  const client = new Client({ name: "muse-smoke", version: "1.0.0" });
  const clientTransport = new StreamableHTTPClientTransport(new URL("https://splitzii.example/mcp"), { fetch: async (url, init) => serveMcp(new Request(url, init), store) });
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 9);
    const created = await client.callTool({ name: "create_group", arguments: { request_id: crypto.randomUUID(), name: "MCP dinner", participant_names: ["Me", "Sam"] } });
    const group = (created.structuredContent as { data: GroupSummary }).data;
    const added = await client.callTool({ name: "add_expense", arguments: { request_id: crypto.randomUUID(), group_id: group.id, description: "Dinner", amount_minor: 4000, paid_by_participant_id: group.participants[0].id, split_between_participant_ids: group.participants.map(p => p.id), date: "2026-10-30" } });
    assert.equal(added.isError, undefined);
    const read = await client.callTool({ name: "get_group", arguments: { group_id: group.id } });
    assert.deepEqual((read.structuredContent as { data: GroupSummary }).data.balances.map(b => b.amount_minor), [2000, -2000]);
  } finally { await client.close(); }
});
