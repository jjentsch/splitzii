import { z } from "zod";

export const currency = process.env.NEXT_PUBLIC_LEDGER_CURRENCY || "CAD";
const id = z.uuid();
const name = z.string().trim().min(1).max(120);
const amount = z.number().int().positive().max(100_000_000_000);
const date = z.iso.date();

export const schemas = {
  list_groups: z.object({}),
  create_group: z.object({ request_id: id, name, participant_names: z.array(name).min(1).max(50) }),
  get_group: z.object({ group_id: id }),
  add_participant: z.object({ request_id: id, group_id: id, name }),
  add_expense: z.object({ request_id: id, group_id: id, description: name, amount_minor: amount, paid_by_participant_id: id, split_between_participant_ids: z.array(id).min(1).max(50), date }),
  update_expense: z.object({ group_id: id, expense_id: id, description: name.optional(), amount_minor: amount.optional(), paid_by_participant_id: id.optional(), split_between_participant_ids: z.array(id).min(1).max(50).optional(), date: date.optional() }),
  delete_expense: z.object({ group_id: id, expense_id: id }),
  record_repayment: z.object({ request_id: id, group_id: id, from_participant_id: id, to_participant_id: id, amount_minor: amount, date, note: z.string().trim().max(240).default("") }),
  delete_repayment: z.object({ group_id: id, repayment_id: id }),
} satisfies Record<string, z.ZodObject>;

export type Action = keyof typeof schemas;
export type Participant = { id: string; name: string };
export type Expense = { id: string; description: string; amount_minor: number; paid_by_participant_id: string; split_between_participant_ids: string[]; shares: { participant_id: string; amount_minor: number }[]; date: string };
export type Repayment = { id: string; from_participant_id: string; to_participant_id: string; amount_minor: number; date: string; note: string };
export type Group = { id: string; name: string; currency: string; participants: Participant[]; expenses: Expense[]; repayments: Repayment[]; created_at: string };
export type StoredGroup = { data: Group; version: number };
export interface LedgerStore {
  read(groupId?: string): Promise<StoredGroup[]>;
  write(data: Group, expectedVersion: number | null): Promise<StoredGroup>;
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

export async function execute(store: LedgerStore, action: Action, input: unknown): Promise<unknown> {
  // Each action owns its schema; all transports use this same validation.
  const args = schemas[action].parse(input);
  if (action === "list_groups") {
    return (await store.read()).map(({ data }) => ({ id: data.id, name: data.name, currency: data.currency, participant_count: data.participants.length, total_expenses_minor: summarize(data).total_expenses_minor }));
  }
  if (action === "create_group") {
    const data = args as z.infer<typeof schemas.create_group>;
    const previous = (await store.read(data.request_id))[0];
    if (previous) {
      if (previous.data.name !== data.name || JSON.stringify(previous.data.participants.slice(0, data.participant_names.length).map(p => p.name)) !== JSON.stringify(data.participant_names)) throw new LedgerError("REQUEST_CONFLICT", "This request_id was already used for a different group.", 409);
      return summarize(previous.data);
    }
    const group: Group = { id: data.request_id, name: data.name, currency, participants: data.participant_names.map(personName => ({ id: crypto.randomUUID(), name: personName })), expenses: [], repayments: [], created_at: new Date().toISOString() };
    return summarize((await store.write(group, null)).data);
  }
  const groupId = (args as { group_id: string }).group_id;
  for (let attempt = 0; attempt < 3; attempt++) {
    const stored = (await store.read(groupId))[0];
    if (!stored) throw new LedgerError("NOT_FOUND", "Group not found.", 404);
    const group = structuredClone(stored.data);
    if (action === "get_group") return summarize(group);
    switch (action) {
      case "add_participant": {
        const data = args as z.infer<typeof schemas.add_participant>;
        const candidate = { id: data.request_id, name: data.name };
        const previous = group.participants.find(p => p.id === candidate.id);
        if (previous) { sameCreate(previous, candidate); return summarize(group); }
        if (group.participants.length >= 50) throw new LedgerError("GROUP_FULL", "A group can have up to 50 participants.");
        group.participants.push(candidate);
        break;
      }
      case "add_expense": {
        const data = args as z.infer<typeof schemas.add_expense>;
        const candidate = expenseWithShares(group, { id: data.request_id, description: data.description, amount_minor: data.amount_minor, paid_by_participant_id: data.paid_by_participant_id, split_between_participant_ids: data.split_between_participant_ids, date: data.date });
        const previous = group.expenses.find(e => e.id === candidate.id);
        if (previous) { sameCreate(previous, candidate); return summarize(group); }
        group.expenses.push(candidate);
        break;
      }
      case "update_expense": {
        const { expense_id, group_id: _groupId, ...changes } = args as z.infer<typeof schemas.update_expense>;
        void _groupId;
        const index = group.expenses.findIndex(e => e.id === expense_id);
        if (index < 0) throw new LedgerError("NOT_FOUND", "Expense not found.", 404);
        group.expenses[index] = expenseWithShares(group, { ...group.expenses[index], ...changes });
        break;
      }
      case "delete_expense": {
        const data = args as z.infer<typeof schemas.delete_expense>;
        group.expenses = group.expenses.filter(e => e.id !== data.expense_id);
        break;
      }
      case "record_repayment": {
        const data = args as z.infer<typeof schemas.record_repayment>;
        requirePerson(group, data.from_participant_id);
        requirePerson(group, data.to_participant_id);
        if (data.from_participant_id === data.to_participant_id) throw new LedgerError("INVALID_REPAYMENT", "Choose two different participants.");
        const candidate: Repayment = { id: data.request_id, from_participant_id: data.from_participant_id, to_participant_id: data.to_participant_id, amount_minor: data.amount_minor, date: data.date, note: data.note };
        const previous = group.repayments.find(r => r.id === candidate.id);
        if (previous) { sameCreate(previous, candidate); return summarize(group); }
        group.repayments.push(candidate);
        break;
      }
      case "delete_repayment": {
        const data = args as z.infer<typeof schemas.delete_repayment>;
        group.repayments = group.repayments.filter(r => r.id !== data.repayment_id);
        break;
      }
    }
    try { return summarize((await store.write(group, stored.version)).data); }
    catch (error) { if (!(error instanceof LedgerError) || error.code !== "VERSION_CONFLICT" || attempt === 2) throw error; }
  }
  throw new LedgerError("VERSION_CONFLICT", "The group changed. Please try again.", 409);
}
