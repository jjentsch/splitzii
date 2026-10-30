"use client";

import { Children, cloneElement, isValidElement, useEffect, useId, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { api } from "@/lib/browser-api";
import { PersonPicker, FriendsPanel, ActivityPanel } from "./people-ui";
import type { Expense, GroupSummary, PersonReference } from "@/lib/ledger";

type Session = { configured: boolean; user: { id: string; email: string } | null };
type GroupItem = { id: string; name: string; currency: string; participant_count: number; total_expenses_minor: number };

const money = (value: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(value / 100);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
function minor(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) throw new Error("Enter an amount with up to two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Enter a positive amount.");
  return amount;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  const fieldId = useId();
  return <div className="field"><label htmlFor={fieldId}>{label}</label>{Children.map(children, child => isValidElement(child) && ["input", "select", "textarea"].includes(String(child.type)) ? cloneElement(child as ReactElement<{ id?: string }>, { id: fieldId }) : child)}</div>;
}

export default function LedgerApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [group, setGroup] = useState<GroupSummary | null>(null);
  const [view, setView] = useState<"ledger" | "agent" | "friends" | "activity">("ledger");
  const [newGroup, setNewGroup] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function refreshGroups() { setGroups(await api<GroupItem[]>("/api/v1/groups")); }
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const identity = await api<Session>("/api/session");
        if (!active) return;
        setSession(identity);
        if (new URLSearchParams(window.location.search).has("auth_error")) setError("Google sign-in did not finish. Please try again.");
        if (identity.user) {
          const items = await api<GroupItem[]>("/api/v1/groups");
          if (!active) return;
          setGroups(items);
          if (items[0]) {
            const detail = await api<GroupSummary>(`/api/v1/groups/${items[0].id}`);
            if (active) setGroup(detail);
          }
        }
      } catch (problem) { if (active) setError((problem as Error).message); }
    })();
    return () => { active = false; };
  }, []);

  async function run(work: () => Promise<void>) {
    setError(""); setPending(true);
    try { await work(); } catch (problem) { setError((problem as Error).message); } finally { setPending(false); }
  }
  async function selectGroup(id: string) {
    await run(async () => { setGroup(await api<GroupSummary>(`/api/v1/groups/${id}`)); setNewGroup(false); setView("ledger"); });
  }
  async function change(path: string, method: string, body?: object) {
    const detail = await api<GroupSummary>(path, method, body);
    setGroup(detail); await refreshGroups();
  }

  if (!session || !session.user) return <div className="welcome">
    <header className="welcome-header"><a href="/" className="brand"><img className="brand-logo" src="/splitzii-logo.png" alt="SPLITZii" width="2079" height="756" /></a><span className="eyebrow">A LITTLE LESS KEEPING TRACK</span></header>
    <main className="welcome-main">
      <div className="pill"><span className="status-dot" /> A personal ledger, made for you and your agent</div>
      <h1>Shared costs.<br /><em>Clear heads.</em></h1>
      <p>Dinner with friends. A weekend away. Everyday things.<br className="desktop" /> Keep a simple record of who owes what, then get on with your day.</p>
      {session?.configured ? <a className="button primary google" href="/auth/login"><span aria-hidden="true">G</span> Continue with Google <span aria-hidden="true">↗</span></a> : <p className="setup-note">{session ? "Your ledger is being set up. Sign-in will be available soon." : "Opening your ledger…"}</p>}
      {error ? <p className="error" role="alert">{error}</p> : null}
      <div className="welcome-details"><span>01 <strong>Log a shared expense</strong></span><span>02 <strong>See who owes what</strong></span><span>03 <strong>Carry on</strong></span></div>
    </main>
    <footer className="welcome-footer"><span>Just the record. Money stays with you.</span><span>Agent first. Human friendly.</span></footer>
  </div>;

  return <div className="app-shell">
    <aside className="sidebar">
      <a href="/" className="brand"><img className="brand-logo" src="/splitzii-logo.png" alt="SPLITZii" width="2079" height="756" /></a>
      <p className="sidebar-label">YOUR SPACE</p>
      <button className={`nav-item ${view === "ledger" ? "active" : ""}`} onClick={() => setView("ledger")}><span aria-hidden="true">▤</span> Your ledger</button>
      <button className={`nav-item ${view === "agent" ? "active" : ""}`} onClick={() => setView("agent")}><span aria-hidden="true">✳</span> Agent connection</button>
      <button className={`nav-item ${view === "friends" ? "active" : ""}`} onClick={() => setView("friends")}><span aria-hidden="true">♧</span> Friends</button>
      <button className={`nav-item ${view === "activity" ? "active" : ""}`} onClick={() => setView("activity")}><span aria-hidden="true">↻</span> Activity</button>
      <div className="sidebar-label group-label">GROUPS <button className="icon-button" aria-label="Create a group" onClick={() => { setNewGroup(true); setView("ledger"); }}>+</button></div>
      <div className="group-nav">{groups.map(item => <button key={item.id} className={`group-link ${group?.id === item.id && view === "ledger" && !newGroup ? "selected" : ""}`} disabled={pending} onClick={() => selectGroup(item.id)}><span className="group-initial">{item.name[0].toUpperCase()}</span>{item.name}<span className="arrow">↗</span></button>)}</div>
      <div className="sidebar-bottom"><div className="ledger-note"><span className="status-dot" /> A ledger, simply.<p>Repayments are recorded here.<br />Money is handled elsewhere.</p></div><div className="account"><span className="avatar">{session.user.email?.[0]?.toUpperCase() || "Y"}</span><span className="account-email">{session.user.email}</span><form method="post" action="/auth/logout"><button className="text-button" title="Sign out" aria-label="Sign out">↪</button></form></div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><span>YOUR SHARED LEDGER</span><span className="private-badge"><span className="status-dot" /> Shared with group members</span><form className="mobile-signout" method="post" action="/auth/logout"><button className="text-button">Sign out</button></form></header>
      {error ? <div className="error banner" role="alert">{error}<button className="text-button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div> : null}
      {view === "agent" ? <AgentConnection /> : view === "friends" ? <FriendsPanel pending={pending} onRun={run} onError={setError} /> : view === "activity" ? <ActivityPanel pending={pending} onRun={run} onError={setError} /> : <>
        <div className="page-heading"><div><p className="eyebrow">A PLACE FOR THE SHARED THINGS</p><h1>{newGroup ? "Something together." : group?.name || "Your ledger."}</h1><p>{newGroup ? "Give it a name and add the people sharing the costs." : group ? `${group.participants.length} people · ${group.currency} · Equal splits, easy does it.` : "Start a group for a trip, a household, or just dinner."}</p></div><button className="button secondary" onClick={() => setNewGroup(!newGroup)}>{newGroup ? "Back to ledger" : "+ New group"}</button></div>
        {newGroup ? <NewGroupForm pending={pending} onSubmit={data => run(async () => { setGroup(await api<GroupSummary>("/api/v1/groups", "POST", data)); await refreshGroups(); setNewGroup(false); })} /> : group ? <GroupDetail key={group.id} group={group} pending={pending} onRun={run} onChange={change} onConnect={() => setView("agent")} /> : <div className="empty-state"><span className="empty-symbol" aria-hidden="true">÷</span><h2>Good things are shared.</h2><p>Your groups and shared expenses will live here.</p><button className="button primary" onClick={() => setNewGroup(true)}>Create your first group <span aria-hidden="true">↗</span></button></div>}
      </>}
      <footer className="content-footer">Keep the memories. We’ll keep the numbers.<span>splitzii / personal ledger</span></footer>
    </main>
  </div>;
}

function NewGroupForm({ pending, onSubmit }: { pending: boolean; onSubmit: (data: object) => Promise<void> }) {
  return <form className="panel form-panel" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void onSubmit({ request_id: crypto.randomUUID(), name: data.get("name"), participants: String(data.get("people")).split(",").map(n => n.trim()).filter(Boolean) }); }}>
    <h2>A new group</h2><Field label="Group name"><input name="name" placeholder="The weekend away" required maxLength={120} autoFocus /></Field>
    <Field label="People, separated by commas"><input name="people" placeholder="Me" required /><small>Use existing Splitzii users’ names or email addresses. “Me” links your account. Everyone added can view and edit this group.</small></Field>
    <button className="button primary" disabled={pending}>{pending ? "Creating…" : "Create group"}<span aria-hidden="true">↗</span></button>
  </form>;
}

type DetailProps = { group: GroupSummary; pending: boolean; onRun: (work: () => Promise<void>) => Promise<void>; onChange: (path: string, method: string, body?: object) => Promise<void>; onConnect: () => void };
function GroupDetail({ group, pending, onRun, onChange, onConnect }: DetailProps) {
  const [form, setForm] = useState<"expense" | "repayment" | "person" | null>(null);
  const [editing, setEditing] = useState<Expense | undefined>();
  const [personToAdd, setPersonToAdd] = useState<PersonReference>("");
  const [linkId, setLinkId] = useState("");
  const person = (id: string) => group.participants.find(p => p.id === id)?.name || "Participant";
  const base = `/api/v1/groups/${group.id}`;
  async function save(path: string, method: string, data: object) { await onChange(path, method, data); setForm(null); setEditing(undefined); }
  return <>
    <div className="stats"><div className="stat"><span>SHARED SO FAR</span><strong>{money(group.total_expenses_minor, group.currency)}</strong><small>Across {group.expenses.length} {group.expenses.length === 1 ? "expense" : "expenses"}</small></div><div className="stat"><span>STILL TO SQUARE UP</span><strong>{money(group.balances.reduce((sum, b) => sum + Math.max(0, b.amount_minor), 0), group.currency)}</strong><small>Recorded repayments included</small></div><div className="stat stat-people"><span>THE PEOPLE</span><div className="avatar-stack">{group.participants.slice(0, 6).map((p, i) => <span className={`avatar color-${i % 4}`} key={p.id} title={p.name}>{p.name[0].toUpperCase()}</span>)}<button className="avatar add-avatar" title="Add a person" aria-label="Add a person" onClick={() => setForm("person")}>+</button></div><small>{group.participants.map(p => p.name).join(", ")}</small></div></div>
    <div className="section-heading"><h2>The shared things <span>{group.expenses.length}</span></h2><div className="button-row"><button className="button secondary small" onClick={() => { setForm("repayment"); setEditing(undefined); }}>Record repayment</button><button className="button primary small" onClick={() => { setForm("expense"); setEditing(undefined); }}>+ Add expense</button></div></div>
    {form ? <div className="panel entry-panel"><div className="section-heading"><h2>{form === "person" ? "One more person" : form === "repayment" ? "Record a repayment" : editing ? "Edit expense" : "Add an expense"}</h2><button className="icon-button" aria-label="Close form" onClick={() => { setForm(null); setEditing(undefined); }}>×</button></div>
      {form === "expense" ? <ExpenseForm key={editing?.id || "new"} group={group} expense={editing} pending={pending} onSubmit={data => onRun(() => save(`${base}/expenses${editing ? `/${editing.id}` : ""}`, editing ? "PATCH" : "POST", data))} /> : form === "repayment" ? <RepaymentForm group={group} pending={pending} onSubmit={data => onRun(() => save(`${base}/repayments`, "POST", data))} /> : <form onSubmit={event => { event.preventDefault(); void onRun(() => save(linkId ? `${base}/participants/${linkId}` : `${base}/participants`, linkId ? "PATCH" : "POST", { ...(linkId ? {} : { request_id: crypto.randomUUID() }), person: personToAdd })); }}><Field label="Add or link a person"><select value={linkId} onChange={event => setLinkId(event.target.value)}><option value="">Add someone new</option>{group.participants.filter(p => !p.user_id).map(p => <option key={p.id} value={p.id}>Link {p.name} to an account</option>)}</select></Field><PersonPicker key={linkId} label="Person name or email" onChange={setPersonToAdd} /><p className="muted">Choose an existing Splitzii user. They can view and edit this whole group.</p><button className="button primary small" disabled={pending}>{linkId ? "Link person" : "Add person"}</button></form>}
    </div> : null}
    <div className="detail-grid"><section className="panel expense-list" aria-label="Expenses">
      {group.expenses.length ? [...group.expenses].sort((a, b) => b.date.localeCompare(a.date)).map(expense => <article className="expense-row" key={expense.id}><span className="expense-icon" aria-hidden="true">↗</span><div className="expense-info"><h3>{expense.description}</h3><p>{person(expense.paid_by_participant_id)} paid · Split {expense.split_between_participant_ids.length} ways · {expense.date}</p></div><div className="expense-amount"><strong>{money(expense.amount_minor, group.currency)}</strong><div><button className="text-button" aria-label={`Edit ${expense.description}`} onClick={() => { setEditing(expense); setForm("expense"); }}>Edit</button><button className="text-button muted" aria-label={`Delete ${expense.description}`} disabled={pending} onClick={() => onRun(() => onChange(`${base}/expenses/${expense.id}`, "DELETE"))}>Delete</button></div></div></article>) : <div className="list-empty"><span aria-hidden="true">↗</span><h3>Start with the first expense.</h3><p>Paid for something together? Add it here.</p></div>}
      {group.deleted_expenses?.length ? <div className="repayments"><h3>Deleted expenses</h3>{group.deleted_expenses.map(expense => <div className="repayment-row" key={expense.id}><strong>{expense.description}</strong><button className="text-button" aria-label={`Restore ${expense.description}`} disabled={pending} onClick={() => onRun(() => onChange(`${base}/expenses/${expense.id}/restore`, "POST", {}))}>Restore</button></div>)}</div> : null}
      {group.repayments.length ? <div className="repayments"><h3>Recorded repayments</h3>{group.repayments.map(repayment => <div className="repayment-row" key={repayment.id}><div><strong>{person(repayment.from_participant_id)} → {person(repayment.to_participant_id)}</strong><p>{repayment.date}{repayment.note ? ` · ${repayment.note}` : ""}</p></div><div><strong>{money(repayment.amount_minor, group.currency)}</strong><button className="text-button muted" aria-label={`Delete repayment from ${person(repayment.from_participant_id)}`} disabled={pending} onClick={() => onRun(() => onChange(`${base}/repayments/${repayment.id}`, "DELETE"))}>Delete</button></div></div>)}</div> : null}
    </section><aside className="balance-panel"><div className="panel"><h2>Where things stand</h2><p className="muted intro">After expenses and repayments.</p>{group.balances.map(balance => <div className="balance-row" key={balance.participant_id}><span>{balance.name}</span><div><strong className={balance.amount_minor > 0 ? "positive" : ""}>{money(Math.abs(balance.amount_minor), group.currency)}</strong><small>{balance.amount_minor > 0 ? "is owed" : balance.amount_minor < 0 ? "owes" : "all square"}</small></div></div>)}<div className="square-up"><h3>{group.suggested_repayments.length ? "A way to square up" : "Everyone’s all square"}</h3>{group.suggested_repayments.map((repayment, i) => <p key={i}>{person(repayment.from_participant_id)} <span aria-hidden="true">→</span> {person(repayment.to_participant_id)}<strong>{money(repayment.amount_minor, group.currency)}</strong></p>)}<small>Suggestions only. Settle up however you like.</small></div></div><p className="side-note">Have your agent add an expense or explain a balance. <button className="text-button" onClick={onConnect}>Connect your agent ↗</button></p></aside></div>
  </>;
}

function ExpenseForm({ group, expense, pending, onSubmit }: { group: GroupSummary; expense?: Expense; pending: boolean; onSubmit: (data: object) => Promise<void> }) {
  const [error, setError] = useState("");
  const [extraPerson, setExtraPerson] = useState<PersonReference>("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const ids = form.getAll("split") as string[];
      if (!ids.length && !extraPerson) throw new Error("Choose at least one person to share this expense.");
      void onSubmit({ ...(expense ? {} : { request_id: crypto.randomUUID() }), description: form.get("description"), amount_minor: minor(String(form.get("amount"))), paid_by_participant_id: form.get("payer"), ...(extraPerson ? { split_between: [...ids.map(participant_id => ({ participant_id })), extraPerson] } : { split_between_participant_ids: ids }), date: form.get("date") });
    } catch (problem) { setError((problem as Error).message); }
  }
  return <form onSubmit={submit}><div className="form-grid"><Field label="Description"><input name="description" placeholder="Dinner, groceries, the cabin…" defaultValue={expense?.description} maxLength={120} required autoFocus /></Field><Field label={`Amount (${group.currency})`}><input name="amount" inputMode="decimal" placeholder="0.00" defaultValue={expense ? (expense.amount_minor / 100).toFixed(2) : ""} required /></Field><Field label="Paid by"><select name="payer" defaultValue={expense?.paid_by_participant_id || group.participants[0].id}>{group.participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Date"><input type="date" name="date" defaultValue={expense?.date || today()} required /></Field></div><fieldset><legend>Split equally between</legend><div className="checkboxes">{group.participants.map(p => <label key={p.id}><input type="checkbox" name="split" value={p.id} defaultChecked={!expense || expense.split_between_participant_ids.includes(p.id)} />{p.name}</label>)}</div></fieldset><PersonPicker label="Add someone to this expense (optional)" required={false} onChange={setExtraPerson} /><p className="muted">Search for an existing Splitzii user or saved friend. They also join this group.</p>{error ? <p className="error" role="alert">{error}</p> : null}<button className="button primary small" disabled={pending}>{pending ? "Saving…" : expense ? "Save changes" : "Save expense"}</button></form>;
}

function RepaymentForm({ group, pending, onSubmit }: { group: GroupSummary; pending: boolean; onSubmit: (data: object) => Promise<void> }) {
  const [error, setError] = useState("");
  const suggestion = group.suggested_repayments[0];
  return <form onSubmit={event => {
    event.preventDefault(); setError(""); const form = new FormData(event.currentTarget);
    try { if (form.get("from") === form.get("to")) throw new Error("Choose two different people."); void onSubmit({ request_id: crypto.randomUUID(), from_participant_id: form.get("from"), to_participant_id: form.get("to"), amount_minor: minor(String(form.get("amount"))), date: form.get("date"), note: form.get("note") }); } catch (problem) { setError((problem as Error).message); }
  }}><p className="muted">Record money already repaid elsewhere. This updates your ledger.</p><div className="form-grid"><Field label="From"><select name="from" defaultValue={suggestion?.from_participant_id || group.participants[0].id}>{group.participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="To"><select name="to" defaultValue={suggestion?.to_participant_id || group.participants[1]?.id}>{group.participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label={`Amount (${group.currency})`}><input name="amount" inputMode="decimal" placeholder="0.00" defaultValue={suggestion ? (suggestion.amount_minor / 100).toFixed(2) : ""} required /></Field><Field label="Date"><input name="date" type="date" defaultValue={today()} required /></Field></div><Field label="Note (optional)"><input name="note" maxLength={240} placeholder="Paid by e-transfer" /></Field>{error ? <p className="error" role="alert">{error}</p> : null}<button className="button primary small" disabled={pending}>{pending ? "Saving…" : "Record repayment"}</button></form>;
}

function AgentConnection() {
  const [endpoint, setEndpoint] = useState("");
  useEffect(() => { setEndpoint(`${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/mcp`); }, []);
  return <><div className="page-heading"><div><p className="eyebrow">A LITTLE HELP KEEPING TRACK</p><h1>Meet your agent.</h1><p>Your ledger, wherever you like to chat.</p></div><span className="connection-symbol" aria-hidden="true">✳</span></div><div className="agent-grid"><section className="panel agent-card"><span className="step">01 / CONNECT</span><h2>Add Splitzii to Muse.</h2><p>Add this URL as a remote MCP connector.</p><Field label="MCP endpoint"><input value={endpoint} readOnly onFocus={event => event.target.select()} /></Field><a className="button secondary small" href="/api/plugin">Download plugin + skills ↗</a><p className="muted fine-print">For hosts that accept plugin packages. You can also connect the MCP URL directly.</p></section><section className="panel agent-card"><span className="step">02 / SIGN IN</span><h2>Continue with Google.</h2><p>Muse opens Splitzii in your browser. Sign in with Google and choose Connect once, then return to your agent.</p><p>Your agent remembers the connection. You can start recording expenses straight away.</p></section></div><div className="agent-example"><span className="eyebrow">THEN, JUST ASK</span><p>“Add dinner to the weekend group. I paid $90, split between me, Sam, and Alex.”</p><small>Your agent handles the record. You handle the good company.</small></div></>;
}
