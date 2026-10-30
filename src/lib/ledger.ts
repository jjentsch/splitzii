import { z } from "zod";

export const currency = process.env.NEXT_PUBLIC_LEDGER_CURRENCY || "CAD";
const id = z.uuid();
const name = z.string().trim().min(1).max(120);
const amount = z.number().int().positive().max(100_000_000_000);
const date = z.iso.date();

const email = z.email().trim().toLowerCase().max(254);
export const personReference = z.union([z.string().trim().min(1).max(254), z.object({
  participant_id: id.optional(), friend_id: id.optional(), user_id: id.optional(),
  name: name.optional(), email: email.optional(),
})]);
export type PersonReference = z.infer<typeof personReference>;
const people = z.array(personReference).min(1).max(50);
const query = z.string().trim().min(1).max(254);
const limit = z.coerce.number().int().min(1).max(100).default(50);
const expenseFields = {
  paid_by_participant_id: id.optional(), split_between_participant_ids: z.array(id).min(1).max(50).optional(),
  paid_by: personReference.optional(), split_between: people.optional(),
};
export const schemas = {
  list_groups: z.object({}),
  create_group: z.object({ request_id: id, name, participant_names: z.array(name).min(1).max(50).optional(), participants: people.optional() }),
  get_group: z.object({ group_id: id }),
  add_participant: z.object({ request_id: id, group_id: id, person: personReference.optional(), name: name.optional(), email: email.optional(), user_id: id.optional(), friend_id: id.optional() }),
  link_participant: z.object({ group_id: id, participant_id: id, person: personReference }),
  add_expense: z.object({ request_id: id, group_id: id, description: name, amount_minor: amount, ...expenseFields, date }),
  update_expense: z.object({ group_id: id, expense_id: id, description: name.optional(), amount_minor: amount.optional(), ...expenseFields, date: date.optional() }),
  delete_expense: z.object({ group_id: id, expense_id: id }),
  restore_expense: z.object({ group_id: id, expense_id: id }),
  record_repayment: z.object({ request_id: id, group_id: id, from_participant_id: id, to_participant_id: id, amount_minor: amount, date, note: z.string().trim().max(240).default("") }),
  delete_repayment: z.object({ group_id: id, repayment_id: id }),
  get_current_user: z.object({}),
  resolve_user: z.object({ query }),
  resolve_group: z.object({ query }),
  resolve_participant: z.object({ group_id: id, query }),
  list_friends: z.object({ query: query.optional() }),
  add_friend: z.object({ request_id: id, person: personReference.optional(), name: name.optional(), email: email.optional(), user_id: id.optional() }),
  remove_friend: z.object({ friend_id: id }),
  list_expenses: z.object({ group_id: id.optional(), date_from: date.optional(), date_to: date.optional(), participant: personReference.optional(), query: query.optional(), limit, offset: z.coerce.number().int().min(0).default(0), include_deleted: z.enum(["true", "false"]).transform(v => v === "true").or(z.boolean()).default(false) }),
  get_expense: z.object({ group_id: id, expense_id: id }),
  get_activity: z.object({ cursor: z.string().regex(/^\d{1,18}$/).default("0"), group_id: id.optional(), limit }),
} satisfies Record<string, z.ZodObject>;

export type Action = keyof typeof schemas;
export type Participant = { id: string; name: string; email?: string; user_id?: string };
export type User = { user_id: string; name: string; email: string | null };
export type Friend = { id: string; name: string; email?: string | null; user_id?: string | null; created_at: string };
export type ActivityEvent = { cursor: string; group_id: string; group_name: string; actor_id: string | null; actor_name: string; is_me: boolean; changes: { type: string; entity_id: string; description: string }[]; occurred_at: string };
export type ActivityPage = { events: ActivityEvent[]; next_cursor: string; has_more: boolean };
export type PeopleAction = "get_current_user" | "search_users" | "list_friends" | "add_friend" | "remove_friend";
export type Expense = { id: string; description: string; amount_minor: number; paid_by_participant_id: string; split_between_participant_ids: string[]; shares: { participant_id: string; amount_minor: number }[]; date: string };
export type Repayment = { id: string; from_participant_id: string; to_participant_id: string; amount_minor: number; date: string; note: string };
export type Group = { id: string; name: string; currency: string; participants: Participant[]; expenses: Expense[]; deleted_expenses?: Expense[]; repayments: Repayment[]; created_at: string; owner_user_id?: string; creation_people?: PersonReference[] };
export type StoredGroup = { data: Group; version: number };
export interface LedgerStore {
  read(groupId?: string): Promise<StoredGroup[]>;
  write(data: Group, expectedVersion: number | null): Promise<StoredGroup>;
  people(action: PeopleAction, args?: object): Promise<unknown>;
  activity(args: z.infer<typeof schemas.get_activity>): Promise<ActivityPage>;
}

export class LedgerError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

export function summarize(group: Group) {
  const amounts = new Map(group.participants.map(person => [person.id, 0]));
  const change = (person: string, value: number) => amounts.set(person, (amounts.get(person) || 0) + value);
  for (const expense of group.expenses) {
    change(expense.paid_by_participant_id, expense.amount_minor);
    for (const share of expense.shares) change(share.participant_id, -share.amount_minor);
  }
  for (const repayment of group.repayments) {
    change(repayment.from_participant_id, repayment.amount_minor);
    change(repayment.to_participant_id, -repayment.amount_minor);
  }
  const balances = group.participants.map(person => ({ participant_id: person.id, name: person.name, amount_minor: amounts.get(person.id)! }));
  const creditors = balances.filter(b => b.amount_minor > 0).map(b => ({ ...b }));
  const debtors = balances.filter(b => b.amount_minor < 0).map(b => ({ ...b, amount_minor: -b.amount_minor }));
  const suggested_repayments: { from_participant_id: string; to_participant_id: string; amount_minor: number }[] = [];
  let c = 0, d = 0;
  while (c < creditors.length && d < debtors.length) {
    const value = Math.min(creditors[c].amount_minor, debtors[d].amount_minor);
    suggested_repayments.push({ from_participant_id: debtors[d].participant_id, to_participant_id: creditors[c].participant_id, amount_minor: value });
    creditors[c].amount_minor -= value;
    debtors[d].amount_minor -= value;
    if (!creditors[c].amount_minor) c++;
    if (!debtors[d].amount_minor) d++;
  }
  return { ...group, balances, suggested_repayments, total_expenses_minor: group.expenses.reduce((total, e) => total + e.amount_minor, 0) };
}
export type GroupSummary = ReturnType<typeof summarize>;

function requirePerson(group: Group, personId: string) {
  if (!group.participants.some(p => p.id === personId)) throw new LedgerError("INVALID_PARTICIPANT", "Choose a participant from this group.");
}

function expenseWithShares(group: Group, expense: Omit<Expense, "shares">): Expense {
  requirePerson(group, expense.paid_by_participant_id);
  const ids = [...new Set(expense.split_between_participant_ids)].sort();
  for (const personId of ids) requirePerson(group, personId);
  const base = Math.floor(expense.amount_minor / ids.length);
  const remainder = expense.amount_minor % ids.length;
  return { ...expense, split_between_participant_ids: ids, shares: ids.map((participant_id, index) => ({ participant_id, amount_minor: base + (index < remainder ? 1 : 0) })) };
}

function sameCreate(existing: object, candidate: object) {
  if (JSON.stringify(existing) !== JSON.stringify(candidate)) throw new LedgerError("REQUEST_CONFLICT", "This request_id was already used for a different entry.", 409);
}

const normalized = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim();
function scoreName(query: string, value: string) {
  const a = normalized(query), b = normalized(value);
  if (a === b) return 100;
  if (b.startsWith(a)) return 90;
  if (b.includes(a)) return 80;
  // Small dependency-free edit distance, also comparing each word for first names.
  return Math.max(...[b, ...b.split(/\s+/)].map(word => {
    let row = Array.from({ length: word.length + 1 }, (_, i) => i);
    for (let i = 0; i < a.length; i++) {
      const next = [i + 1];
      for (let j = 0; j < word.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + (a[i] === word[j] ? 0 : 1)));
      row = next;
    }
    return Math.round(100 * (1 - row[word.length] / Math.max(a.length, word.length)));
  }));
}
export function ranked<T extends { name: string; email?: string | null }>(items: T[], query: string) {
  return items.map(item => ({ ...item, match_score: item.email && normalized(item.email) === normalized(query) ? 100 : query.includes("@") ? 0 : scoreName(query, item.name) }))
    .filter(item => item.match_score >= 65).sort((a, b) => b.match_score - a.match_score || a.name.localeCompare(b.name));
}
function choose<T extends { name: string; match_score: number }>(matches: T[]): T | undefined {
  const exact = matches.filter(m => m.match_score === 100);
  const choices = exact.length ? exact : matches;
  if (choices.length > 1) throw new LedgerError("AMBIGUOUS_PERSON", `Choose a specific person: ${choices.map(p => p.name).join(", ")}. Use resolve_user or resolve_participant and supply their ID.`, 409);
  return choices[0];
}
type PersonMatch = { user_id?: string; friend_id?: string; email?: string; name: string; match_score: number };
export async function resolveUsers(store: LedgerStore, query: string): Promise<PersonMatch[]> {
  if (["me", "myself"].includes(normalized(query))) {
    const user = await store.people("get_current_user") as User;
    return [{ ...user, email: user.email || undefined, match_score: 100 }];
  }
  const [friends, users] = await Promise.all([store.people("list_friends") as Promise<Friend[]>, store.people("search_users", { query }) as Promise<User[]>]);
  const matches = new Map<string, { user_id?: string; friend_id?: string; email?: string; name: string; match_score: number }>();
  for (const item of ranked(users, query)) matches.set(item.user_id, { ...item, email: item.email || undefined });
  for (const item of ranked(friends, query)) {
    const key = item.user_id || item.email || item.id;
    const previous = matches.get(key);
    if (!previous || item.match_score >= previous.match_score) matches.set(key, { name: item.name, email: item.email || undefined, user_id: item.user_id || undefined, friend_id: item.id, match_score: item.match_score });
  }
  return [...matches.values()].sort((a, b) => b.match_score - a.match_score || a.name.localeCompare(b.name));
}
async function personIdentity(store: LedgerStore, reference: PersonReference): Promise<Omit<Participant, "id">> {
  const ref: Exclude<PersonReference, string> = typeof reference === "string" ? (reference.includes("@") ? { email: email.parse(reference) } : { name: reference }) : reference;
  if (ref.friend_id) {
    const friend = (await store.people("list_friends") as Friend[]).find(f => f.id === ref.friend_id);
    if (!friend) throw new LedgerError("NOT_FOUND", "Friend not found.", 404);
    return { name: ref.name || friend.name, ...(friend.email ? { email: friend.email } : {}), ...(friend.user_id ? { user_id: friend.user_id } : {}) };
  }
  if (ref.user_id) {
    const user = (await store.people("search_users", { user_id: ref.user_id }) as User[])[0];
    if (!user) throw new LedgerError("NOT_FOUND", "User not found.", 404);
    return { name: ref.name || user.name, user_id: user.user_id, ...(user.email ? { email: user.email } : {}) };
  }
  if (!ref.email && ref.name && ["me", "myself"].includes(normalized(ref.name))) {
    const user = await store.people("get_current_user") as User;
    return { name: user.name, user_id: user.user_id, ...(user.email ? { email: user.email } : {}) };
  }
  const query = ref.email || ref.name;
  if (!query) throw new LedgerError("INVALID_PERSON", "Provide a name, email, friend ID, or user ID.");
  const match = choose(await resolveUsers(store, query));
  return { name: name.parse(ref.name || match?.name || query.split("@")[0]),
    ...(match?.user_id ? { user_id: match.user_id } : {}),
    ...(ref.email || match?.email ? { email: ref.email || match?.email } : {}) };
}
async function groupPerson(store: LedgerStore, group: Group, reference: PersonReference, newId = crypto.randomUUID()) {
  const ref = typeof reference === "string" ? reference : reference.participant_id || reference.user_id || reference.email || reference.name || "";
  if (["me", "myself"].includes(normalized(ref))) {
    const user = await store.people("get_current_user") as User;
    const own = group.participants.find(p => p.user_id === user.user_id || (user.email && p.email === user.email));
    if (own) return own;
    if (group.participants.length >= 50) throw new LedgerError("GROUP_FULL", "A group can have up to 50 participants.");
    const participant = { id: newId, name: user.name, user_id: user.user_id, ...(user.email ? { email: user.email } : {}) };
    group.participants.push(participant);
    return participant;
  }
  const direct = group.participants.find(p => p.id === ref || p.user_id === ref || (p.email && normalized(p.email) === normalized(ref)));
  if (direct) return direct;
  if (typeof reference === "string" || !(reference.user_id || reference.email || reference.friend_id)) {
    const query = typeof reference === "string" ? reference : reference.name;
    if (query) {
      const matches = ranked(group.participants, query);
      const match = choose(matches);
      if (match) return group.participants.find(p => p.id === match.id)!;
    }
  }
  const identity = await personIdentity(store, reference);
  const existing = group.participants.find(p => (identity.user_id && p.user_id === identity.user_id) || (identity.email && p.email === identity.email));
  if (existing) return existing;
  if (group.participants.length >= 50) throw new LedgerError("GROUP_FULL", "A group can have up to 50 participants.");
  const participant = { id: newId, ...identity };
  group.participants.push(participant);
  return participant;
}
function groupList(groups: StoredGroup[]) {
  return groups.map(({ data }) => ({ id: data.id, name: data.name, currency: data.currency, participant_count: data.participants.length, total_expenses_minor: summarize(data).total_expenses_minor }));
}

export async function execute(store: LedgerStore, action: Action, input: unknown): Promise<unknown> {
  const args = schemas[action].parse(input);
  if (action === "get_current_user") {
    const user = await store.people("get_current_user") as User;
    return { ...user, currency, participant_links: (await store.read()).flatMap(({ data }) => data.participants.filter(p => p.user_id === user.user_id || (user.email && p.email === user.email)).map(p => ({ group_id: data.id, participant_id: p.id }))) };
  }
  if (action === "resolve_user") return resolveUsers(store, (args as z.infer<typeof schemas.resolve_user>).query);
  if (action === "list_friends") {
    const friends = await store.people("list_friends") as Friend[];
    const { query } = args as z.infer<typeof schemas.list_friends>;
    return query ? ranked(friends, query) : friends;
  }
  if (action === "add_friend") {
    const data = args as z.infer<typeof schemas.add_friend>;
    const identity = await personIdentity(store, data.person || data);
    return store.people("add_friend", { request_id: data.request_id, ...identity });
  }
  if (action === "remove_friend") return store.people("remove_friend", args);
  if (action === "get_activity") return store.activity(args as z.infer<typeof schemas.get_activity>);
  if (action === "list_groups" || action === "resolve_group") {
    const groups = groupList(await store.read());
    return action === "resolve_group" ? ranked(groups, (args as z.infer<typeof schemas.resolve_group>).query) : groups;
  }
  if (action === "list_expenses") {
    const data = args as z.infer<typeof schemas.list_expenses>;
    if (data.date_from && data.date_to && data.date_from > data.date_to) throw new LedgerError("INVALID_DATE_RANGE", "The start date must come before the end date.");
    const groups = await store.read(data.group_id);
    const items = [];
    for (const { data: group } of groups) {
      let ids: string[] | null = null;
      if (data.participant) {
        const ref = data.participant;
        const term = typeof ref === "string" ? ref : ref.participant_id || ref.user_id || ref.email || ref.name || "";
        if (ref && typeof ref !== "string" && ref.friend_id) {
          const identity = await personIdentity(store, ref);
          ids = group.participants.filter(p => p.user_id && p.user_id === identity.user_id || p.email && p.email === identity.email || normalized(p.name) === normalized(identity.name)).map(p => p.id);
        } else if (["me", "myself"].includes(normalized(term))) {
          const user = await store.people("get_current_user") as User;
          ids = group.participants.filter(p => p.user_id === user.user_id).map(p => p.id);
        } else ids = group.participants.filter(p => p.id === term || p.user_id === term || p.email === normalized(term) || scoreName(term, p.name) >= 65).map(p => p.id);
      }
      for (const expense of [...group.expenses, ...(data.include_deleted ? group.deleted_expenses || [] : [])]) {
        if (data.date_from && expense.date < data.date_from || data.date_to && expense.date > data.date_to) continue;
        if (data.query && !normalized(expense.description).includes(normalized(data.query))) continue;
        if (ids && !ids.some(id => expense.paid_by_participant_id === id || expense.split_between_participant_ids.includes(id))) continue;
        items.push({ ...expense, group_id: group.id, group_name: group.name, currency: group.currency, deleted: !group.expenses.some(e => e.id === expense.id) });
      }
    }
    items.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    return { expenses: items.slice(data.offset, data.offset + data.limit), total: items.length, next_offset: data.offset + data.limit < items.length ? data.offset + data.limit : null };
  }
  if (action === "create_group") {
    const data = args as z.infer<typeof schemas.create_group>;
    const previous = (await store.read(data.request_id))[0];
    if (previous) {
      if (previous.data.name !== data.name || (previous.data.creation_people && JSON.stringify(previous.data.creation_people) !== JSON.stringify(data.participants || data.participant_names))) throw new LedgerError("REQUEST_CONFLICT", "This request_id already belongs to a different group.", 409);
      return summarize(previous.data);
    }
    const references = data.participants || data.participant_names;
    if (!references?.length) throw new LedgerError("INVALID_PERSON", "Add at least one person.");
    const group: Group = { id: data.request_id, name: data.name, currency, participants: [], expenses: [], repayments: [], created_at: new Date().toISOString(), creation_people: references };
    for (const ref of references) await groupPerson(store, group, ref);
    return summarize((await store.write(group, null)).data);
  }
  const groupId = (args as { group_id: string }).group_id;
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = (await store.read(groupId))[0];
    if (!stored) throw new LedgerError("NOT_FOUND", "Group not found.", 404);
    const group = structuredClone(stored.data);
    if (action === "get_group") return summarize(group);
    if (action === "resolve_participant") {
      const { query } = args as z.infer<typeof schemas.resolve_participant>;
      if (["me", "myself"].includes(normalized(query))) {
        const user = await store.people("get_current_user") as User;
        return group.participants.filter(p => p.user_id === user.user_id).map(p => ({ ...p, match_score: 100 }));
      }
      return ranked(group.participants, query);
    }
    if (action === "get_expense") {
      const { expense_id } = args as z.infer<typeof schemas.get_expense>;
      const expense = group.expenses.find(e => e.id === expense_id) || group.deleted_expenses?.find(e => e.id === expense_id);
      if (!expense) throw new LedgerError("NOT_FOUND", "Expense not found.", 404);
      return { ...expense, group_id: group.id, group_name: group.name, currency: group.currency, participants: group.participants.filter(p => p.id === expense.paid_by_participant_id || expense.split_between_participant_ids.includes(p.id)), deleted: !group.expenses.some(e => e.id === expense_id) };
    }
    switch (action) {
      case "add_participant": {
        const data = args as z.infer<typeof schemas.add_participant>;
        const previous = group.participants.find(p => p.id === data.request_id);
        if (previous) {
          const identity = await personIdentity(store, data.person || data);
          const same = identity.user_id ? previous.user_id === identity.user_id || Boolean(identity.email && previous.email === identity.email)
            : identity.email ? previous.email === identity.email : previous.name === identity.name;
          if (!same) throw new LedgerError("REQUEST_CONFLICT", "This request_id already belongs to a different person.", 409);
          return summarize(group);
        }
        await groupPerson(store, group, data.person || data, data.request_id);
        break;
      }
      case "link_participant": {
        const data = args as z.infer<typeof schemas.link_participant>;
        const participant = group.participants.find(p => p.id === data.participant_id);
        if (!participant) throw new LedgerError("NOT_FOUND", "Participant not found.", 404);
        const identity = await personIdentity(store, data.person);
        if (!identity.user_id && !identity.email) throw new LedgerError("INVALID_PERSON", "Link using a registered user or an email address.");
        if (participant.user_id && participant.user_id !== identity.user_id) throw new LedgerError("ALREADY_LINKED", "This person is already linked to an account.");
        if (group.participants.some(p => p.id !== participant.id && (identity.user_id && p.user_id === identity.user_id || identity.email && p.email === identity.email))) throw new LedgerError("ALREADY_LINKED", "That person is already a different participant in this group.");
        Object.assign(participant, identity, { name: participant.name });
        break;
      }
      case "add_expense":
      case "update_expense": {
        const data = args as z.infer<typeof schemas.add_expense> & z.infer<typeof schemas.update_expense>;
        const existing = action === "update_expense" ? group.expenses.find(e => e.id === data.expense_id) : undefined;
        if (action === "update_expense" && !existing) throw new LedgerError("NOT_FOUND", "Expense not found.", 404);
        const payerId = data.paid_by ? (await groupPerson(store, group, data.paid_by)).id : data.paid_by_participant_id || existing?.paid_by_participant_id;
        const splitIds = data.split_between ? await Promise.resolve(data.split_between).then(async refs => { const ids = []; for (const ref of refs) ids.push((await groupPerson(store, group, ref)).id); return ids; }) : data.split_between_participant_ids || existing?.split_between_participant_ids;
        if (!payerId || !splitIds?.length) throw new LedgerError("INVALID_PERSON", "Provide the payer and people sharing this expense.");
        const candidate = expenseWithShares(group, { id: existing?.id || data.request_id, description: data.description ?? existing!.description, amount_minor: data.amount_minor ?? existing!.amount_minor, date: data.date ?? existing!.date, paid_by_participant_id: payerId, split_between_participant_ids: splitIds });
        if (existing) group.expenses[group.expenses.indexOf(existing)] = candidate;
        else {
          const previous = [...group.expenses, ...(group.deleted_expenses || [])].find(e => e.id === candidate.id);
          if (previous) { sameCreate(previous, candidate); return summarize(group); }
          group.expenses.push(candidate);
        }
        break;
      }
      case "delete_expense": {
        const { expense_id } = args as z.infer<typeof schemas.delete_expense>;
        const expense = group.expenses.find(e => e.id === expense_id);
        if (expense) { group.deleted_expenses = [...(group.deleted_expenses || []), expense]; group.expenses = group.expenses.filter(e => e.id !== expense_id); }
        break;
      }
      case "restore_expense": {
        const { expense_id } = args as z.infer<typeof schemas.restore_expense>;
        if (group.expenses.some(e => e.id === expense_id)) return summarize(group);
        const expense = group.deleted_expenses?.find(e => e.id === expense_id);
        if (!expense) throw new LedgerError("NOT_FOUND", "Deleted expense not found.", 404);
        group.expenses.push(expense); group.deleted_expenses = group.deleted_expenses!.filter(e => e.id !== expense_id);
        break;
      }
      case "record_repayment": {
        const data = args as z.infer<typeof schemas.record_repayment>;
        requirePerson(group, data.from_participant_id); requirePerson(group, data.to_participant_id);
        if (data.from_participant_id === data.to_participant_id) throw new LedgerError("INVALID_REPAYMENT", "Choose two different participants.");
        const candidate: Repayment = { id: data.request_id, from_participant_id: data.from_participant_id, to_participant_id: data.to_participant_id, amount_minor: data.amount_minor, date: data.date, note: data.note };
        const previous = group.repayments.find(r => r.id === candidate.id);
        if (previous) { sameCreate(previous, candidate); return summarize(group); }
        group.repayments.push(candidate); break;
      }
      case "delete_repayment": {
        const data = args as z.infer<typeof schemas.delete_repayment>;
        group.repayments = group.repayments.filter(r => r.id !== data.repayment_id); break;
      }
      default: throw new LedgerError("INVALID_ACTION", "Unknown ledger action.");
    }
    try { return summarize((await store.write(group, stored.version)).data); }
    catch (error) { if (!(error instanceof LedgerError) || error.code !== "VERSION_CONFLICT" || attempt === 2) throw error; }
  }
  throw new LedgerError("VERSION_CONFLICT", "The group changed. Please try again.", 409);
}
