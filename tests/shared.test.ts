import assert from "node:assert/strict";
import { test } from "node:test";
import { execute, type GroupSummary, type ActivityPage, type Friend, type User } from "../src/lib/ledger";
import { database, databaseStore, ownerId, users } from "./support";
import { dispatchRest } from "../src/lib/rest";

const samId = users.find(user => user.name === "Sam")!.user_id;
const taylorId = users.find(user => user.name === "Taylor")!.user_id;

test("friends, registered shared users, search, activity cursors, and undo", async () => {
  const db = await database();
  const store = databaseStore(db);
  const signIn = async (id: string) => { await db.exec(`reset role; select set_config('request.jwt.claim.sub','${id}',false); set role authenticated;`); };
  try {
    await signIn(ownerId);
    const friend = await execute(store, "add_friend", { request_id: crypto.randomUUID(), email: "SAM@example.com", name: "Sam" }) as Friend;
    assert.equal(friend.user_id, samId);
    const found = await execute(store, "resolve_user", { query: "Sam" }) as { user_id: string; friend_id?: string }[];
    assert.equal(found[0].friend_id, friend.id);
    let group = await execute(store, "create_group", { request_id: crypto.randomUUID(), name: "Cottage weekend", participants: ["Me", { friend_id: friend.id }, "Alex"] }) as GroupSummary;
    assert.deepEqual(group.participants.slice(0, 2).map(p => p.user_id), [ownerId, samId]);
    const groupId = group.id;
    const resolved = await execute(store, "resolve_group", { query: "cottage" }) as { id: string }[];
    assert.equal(resolved[0].id, groupId);
    // A second authenticated user sees and updates the same ledger.
    await signIn(samId);
    assert.equal((await execute(store, "get_current_user", {}) as User).user_id, samId);
    assert.equal((await execute(store, "get_group", { group_id: groupId }) as GroupSummary).name, "Cottage weekend");
    const own = await execute(store, "resolve_participant", { group_id: groupId, query: "me" }) as { user_id: string }[];
    assert.equal(own[0].user_id, samId);
    const expenseId = crypto.randomUUID();
    group = await execute(store, "add_expense", { request_id: expenseId, group_id: groupId, description: "Cottage dinner", amount_minor: 9000, paid_by: "me", split_between: ["me", "hobby@example.com", "taylor@example.com"], date: "2026-10-30" }) as GroupSummary;
    assert.equal(group.expenses[0].paid_by_participant_id, group.participants.find(p => p.user_id === samId)!.id);
    const taylor = group.participants.find(p => p.email === "taylor@example.com")!;
    assert.equal(taylor.user_id, taylorId);
    const page = await execute(store, "list_expenses", { group_id: groupId, date_from: "2026-10-01", date_to: "2026-10-31", participant: "sam@example.com", query: "dinner", limit: 1 }) as { expenses: { id: string }[]; total: number };
    assert.equal(page.expenses[0].id, expenseId); assert.equal(page.total, 1);
    const response = await dispatchRest(new Request(`https://splitzii.example/api/v1/expenses?group_id=${groupId}&query=dinner&limit=1`), store, ["expenses"]);
    assert.equal((await response.json()).data.expenses[0].id, expenseId);
    let activity = await execute(store, "get_activity", { limit: 1 }) as ActivityPage;
    assert.equal(activity.has_more, true);
    activity = await execute(store, "get_activity", { cursor: activity.next_cursor }) as ActivityPage;
    assert.equal(activity.events[0].changes.some(c => c.type === "expense_added"), true);
    const cursor = activity.next_cursor;
    await signIn(ownerId);
    group = await execute(store, "delete_expense", { group_id: groupId, expense_id: expenseId }) as GroupSummary;
    assert.equal(group.total_expenses_minor, 0);
    assert.equal(group.deleted_expenses![0].id, expenseId);
    group = await execute(store, "restore_expense", { group_id: groupId, expense_id: expenseId }) as GroupSummary;
    assert.equal(group.total_expenses_minor, 9000);
    const tail = await execute(store, "get_activity", { cursor }) as ActivityPage;
    assert.deepEqual(tail.events.flatMap(e => e.changes.map(c => c.type)), ["expense_deleted", "expense_restored"]);
    const loaded = await execute(store, "get_expense", { group_id: groupId, expense_id: expenseId }) as { shares: { amount_minor: number }[]; deleted: boolean };
    assert.deepEqual(loaded.shares.map(s => s.amount_minor), [3000, 3000, 3000]); assert.equal(loaded.deleted, false);
    // An existing user added during an expense can access the shared ledger.
    await signIn(taylorId);
    group = await execute(store, "get_group", { group_id: groupId }) as GroupSummary;
    assert.equal(group.participants.find(p => p.id === taylor.id)!.user_id, taylorId);
    await signIn(ownerId);
    assert.equal((await execute(store, "list_friends", { query: "Sam" }) as Friend[]).length, 1);
    await execute(store, "remove_friend", { friend_id: friend.id });
    assert.equal((await execute(store, "list_friends", {}) as Friend[]).length, 0);
  } finally { await db.close(); }
});

test("a ledger with only its owner has no other users to add", async () => {
  const db = await database([users[0]]);
  try {
    const store = databaseStore(db);
    assert.deepEqual(await execute(store, "resolve_user", { query: "sam@example.com" }), []);
    assert.deepEqual(await execute(store, "list_friends", {}), []);
    const group = await execute(store, "create_group", { request_id: crypto.randomUUID(), name: "My ledger", participants: ["Me"] }) as GroupSummary;
    assert.deepEqual(group.participants.map(person => person.user_id), [ownerId]);
  } finally { await db.close(); }
});

test("historical unlinked people keep their shares and can link to registered users", async () => {
  const db = await database();
  try {
    const store = databaseStore(db);
    const group = await execute(store, "create_group", { request_id: crypto.randomUUID(), name: "Old ledger", participants: ["Me"] }) as GroupSummary;
    const stored = (await store.read(group.id))[0];
    const legacyId = crypto.randomUUID();
    stored.data.participants.push({ id: legacyId, name: "Old contact" });
    // Seed a ledger from before the registered-user restriction.
    await db.exec("reset role; alter table public.ledger_groups disable trigger require_registered_participants;");
    await store.write(stored.data, stored.version);
    await db.exec("alter table public.ledger_groups enable trigger require_registered_participants; set role authenticated;");
    const updated = await execute(store, "add_expense", { request_id: crypto.randomUUID(), group_id: group.id, description: "Dinner", amount_minor: 1000, paid_by_participant_id: group.participants[0].id, split_between_participant_ids: [group.participants[0].id, legacyId], date: "2026-10-30" }) as GroupSummary;
    const linked = await execute(store, "link_participant", { group_id: group.id, participant_id: legacyId, person: "alex@example.com" }) as GroupSummary;
    assert.equal(linked.participants.find(person => person.id === legacyId)!.user_id, users.find(user => user.name === "Alex")!.user_id);
    assert.deepEqual(linked.expenses[0].shares, updated.expenses[0].shares);
  } finally { await db.close(); }
});
