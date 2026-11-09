"use client";

import { Children, cloneElement, isValidElement, useEffect, useId, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { api } from "@/lib/browser-api";
import { PersonPicker, FriendsPanel, ActivityPanel } from "./people-ui";
import type { Expense, GroupSummary, PersonReference } from "@/lib/ledger";
import MobileChrome, { type GroupItem, type ShellSheet, type View } from "./mobile-chrome";
import { Description, EntryPanel, Icon, LoadingRows, Sheet, useMediaQuery } from "./mobile-ui";

type Session = { configured: boolean; user: { id: string; email: string } | null };

const money = (value: number, currency: string) => new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(value / 100);
const shortDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).formatToParts(new Date(`${iso}T00:00:00Z`));
const datePart = (iso: string, type: "month" | "day") => shortDate(iso).find(part => part.type === type)?.value.replace(".", "") || "";
const tone = (amount: number) => amount > 0 ? "owed" : amount < 0 ? "owe" : "square";
const Logo = () => <img className="brand-logo" src="/splitzii-logo.png" alt="SPLITZii" width="2079" height="756" />;
// The one answer people open the app for: where do I stand?
function Standing({ amount, currency, children }: { amount: number; currency: string; children?: ReactNode }) {
  return <div className="standing"><p className="standing-label">{amount > 0 ? "You are owed" : amount < 0 ? "You owe" : "You’re all square"}</p><strong className={`standing-amount ${tone(amount)}`}>{money(Math.abs(amount), currency)}</strong>{children}</div>;
}
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

export default function LedgerApp({ signedIn = false }: { signedIn?: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [group, setGroup] = useState<GroupSummary | null>(null);
  const [view, setView] = useState<View>("ledger");
  const [newGroup, setNewGroup] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [sheet, setSheet] = useState<ShellSheet>(null);
  const compact = useMediaQuery("(width < 1024px)");

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
      } catch (problem) { if (active) setError((problem as Error).message); } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  async function run(work: () => Promise<void>) {
    setError(""); setPending(true);
    try { await work(); } catch (problem) { setError((problem as Error).message); } finally { setPending(false); }
  }
  async function selectGroup(id: string) {
    await run(async () => { setGroup(await api<GroupSummary>(`/api/v1/groups/${id}`)); setNewGroup(false); setMobileDetail(true); setView("ledger"); window.scrollTo(0, 0); });
  }
  async function leaveGroup(id: string) {
    await run(async () => {
      await api(`/api/v1/groups/${id}/leave`, "POST", {});
      const items = await api<GroupItem[]>("/api/v1/groups");
      setGroups(items); setGroup(items[0] ? await api<GroupSummary>(`/api/v1/groups/${items[0].id}`) : null); setMobileDetail(false); window.scrollTo(0, 0);
    });
  }
  async function change(path: string, method: string, body?: object) {
    const detail = await api<GroupSummary>(path, method, body);
    setGroup(detail); await refreshGroups();
  }

  function navigate(next: View) { setView(next); setNewGroup(false); setMobileDetail(false); window.scrollTo(0, 0); }
  function createGroup() { setNewGroup(true); setView("ledger"); window.scrollTo(0, 0); }
  const showGroupList = compact === true && !mobileDetail && !newGroup;
  const detail = view === "ledger" && (newGroup || (!showGroupList && Boolean(group)));
  const overall = groups.reduce((sum, item) => sum + (item.your_balance_minor || 0), 0);
  const title = view === "agent" ? "Meet your agent." : view === "friends" ? "Your friends." : view === "activity" ? "Group activity." : newGroup ? "Something together." : showGroupList ? "Your ledger." : group?.name || "Your ledger.";

  // The server saw a session cookie: skip the welcome page while the ledger loads.
  if (!session && signedIn && loading) return <div className="app-shell" aria-busy="true">
    <aside className="sidebar"><a href="/" className="brand"><Logo /></a></aside>
    <header className="mobile-topbar"><a className="mobile-brand" href="/" aria-label="Splitzii home"><Logo /></a></header>
    <main className="main-content"><header className="topbar"><span>YOUR SHARED LEDGER</span></header><div className="page-heading"><div><p className="eyebrow">A PLACE FOR THE SHARED THINGS</p><h1>Your ledger.</h1></div></div><LoadingRows /></main>
  </div>;

  if (!session || !session.user) return <div className="app-shell welcome" aria-busy={!session}>
    <aside className="sidebar">
      <a href="/" className="brand"><Logo /></a>
      <p className="sidebar-label">HOW IT WORKS</p>
      {["Log a shared expense", "See who owes what", "Carry on"].map((step, index) => <p className="nav-item" key={step}><span aria-hidden="true">0{index + 1}</span> {step}</p>)}
      <div className="sidebar-bottom"><div className="ledger-note"><span className="status-dot" /> A ledger, simply.<p>Repayments are recorded here.<br />Money is handled elsewhere.</p></div></div>
    </aside>
    <header className="mobile-topbar"><a className="mobile-brand" href="/" aria-label="Splitzii home"><Logo /></a></header>
    <main className="main-content">
      <header className="topbar"><span>A LITTLE LESS KEEPING TRACK</span><span className="private-badge"><span className="status-dot" /> Made for you and your agent</span></header>
      <div className="welcome-grid">
        <div className="welcome-copy">
          <p className="eyebrow">A PLACE FOR THE SHARED THINGS</p>
          <h1>Shared costs.<br />Clear heads.</h1>
          <p className="page-description">Dinner with friends. A weekend away. Everyday things. Keep a simple record of who owes what, then get on with your day.</p>
          {session?.configured ? <a className="button primary google" href="/auth/login"><span aria-hidden="true">G</span> Continue with Google</a> : <p className="setup-note" role="status">{session ? "Your ledger is being set up. Sign-in will be available soon." : "Opening your ledger…"}</p>}
          {error ? <p className="error" role="alert">{error}</p> : null}
          <p className="welcome-note">Just the record. Money stays with you.</p>
        </div>
        <section className="panel welcome-preview" aria-label="An example ledger">
          <p className="eyebrow">FOR EXAMPLE · WEEKEND AWAY</p>
          <Standing amount={16783} currency="CAD"><ul className="debts"><li><span className="avatar">S</span><span>Sam owes you</span><strong className="owed">{money(1316, "CAD")}</strong></li><li><span className="avatar">A</span><span>Alex owes you</span><strong className="owed">{money(15467, "CAD")}</strong></li></ul></Standing>
          <ExpenseLine date="2026-11-01" title="Gas" detail={`Alex paid ${money(6000, "CAD")}`} label="you borrowed" amount={money(3000, "CAD")} tone="owe" />
          <ExpenseLine date="2026-10-30" title="Cabin rental" detail={`You paid ${money(42000, "CAD")}`} label="you lent" amount={money(28000, "CAD")} tone="owed" />
        </section>
      </div>
      <footer className="content-footer">Keep the memories. We’ll keep the numbers.<span>Agent first. Human friendly.</span></footer>
    </main>
  </div>;

  return <div className="app-shell">
    {compact !== true ? <aside className="sidebar">
      <a href="/" className="brand"><Logo /></a>
      <p className="sidebar-label">YOUR SPACE</p>
      <button className={`nav-item ${view === "ledger" ? "active" : ""}`} onClick={() => setView("ledger")}><span aria-hidden="true">▤</span> Your ledger</button>
      <button className={`nav-item ${view === "agent" ? "active" : ""}`} onClick={() => setView("agent")}><span aria-hidden="true">✳</span> Agent connection</button>
      <button className={`nav-item ${view === "friends" ? "active" : ""}`} onClick={() => setView("friends")}><span aria-hidden="true">♧</span> Friends</button>
      <button className={`nav-item ${view === "activity" ? "active" : ""}`} onClick={() => setView("activity")}><span aria-hidden="true">↻</span> Activity</button>
      <div className="sidebar-label group-label">GROUPS <button className="icon-button" aria-label="Create a group" onClick={() => { setNewGroup(true); setView("ledger"); }}>+</button></div>
      <div className="group-nav">{groups.map(item => <button key={item.id} className={`group-link ${group?.id === item.id && view === "ledger" && !newGroup ? "selected" : ""}`} disabled={pending} onClick={() => selectGroup(item.id)}><span className="group-initial">{item.name[0].toUpperCase()}</span><span className="group-name">{item.name}</span>{item.your_balance_minor ? <span className={`group-balance ${tone(item.your_balance_minor)}`}>{item.your_balance_minor > 0 ? "+" : "−"}{money(Math.abs(item.your_balance_minor), item.currency)}</span> : null}</button>)}</div>
      {groups.length > 1 ? <p className="group-overall">Overall <span className={tone(overall)}>{overall ? `${overall > 0 ? "you are owed" : "you owe"} ${money(Math.abs(overall), groups[0].currency)}` : "all square"}</span></p> : null}
      <div className="sidebar-bottom"><div className="ledger-note"><span className="status-dot" /> A ledger, simply.<p>Repayments are recorded here.<br />Money is handled elsewhere.</p></div><div className="account"><span className="avatar">{session.user.email?.[0]?.toUpperCase() || "Y"}</span><span className="account-email">{session.user.email}</span><form method="post" action="/auth/logout"><button className="text-button" title="Sign out" aria-label="Sign out">↪</button></form></div></div>
    </aside> : null}
    {compact !== false ? <MobileChrome view={view} title={title} detail={detail} email={session.user.email} groups={groups} selectedId={group?.id} sheet={sheet} onSheet={setSheet} onNavigate={navigate} onBack={() => navigate("ledger")} onGroup={id => void selectGroup(id)} onNewGroup={createGroup} /> : null}
    <main className={`main-content ${detail ? "is-detail" : ""}`} aria-busy={loading || pending}>
      <header className="topbar"><span>YOUR SHARED LEDGER</span><span className="private-badge"><span className="status-dot" /> Shared with group members</span></header>
      {error ? <div className="error banner" role="alert">{error}<button className="text-button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div> : null}
      {view === "agent" ? <AgentConnection /> : view === "friends" ? <FriendsPanel pending={pending} onRun={run} onError={setError} /> : view === "activity" ? <ActivityPanel pending={pending} onRun={run} onError={setError} /> : <>
        <div className="page-heading"><div><p className="eyebrow">A PLACE FOR THE SHARED THINGS</p><h1 aria-label={title}><span className="standard-title">{title}</span>{!newGroup && groups.length ? <button className="title-picker" onClick={() => setSheet("groups")} aria-label="Switch group">{title}<Icon name="down" /></button> : null}</h1><Description key={title} lines={detail ? 1 : 2}>{newGroup ? "Give it a name and add the people sharing the costs." : !showGroupList && group ? `${group.participants.length} people · ${group.currency} · Equal splits, easy does it.` : showGroupList ? "A trip, a household, or just dinner. All your shared things." : "Start a group for a trip, a household, or just dinner."}</Description></div><button className={`button secondary ${detail || (showGroupList && groups.length) ? "detail-new-group" : ""}`} onClick={() => setNewGroup(!newGroup)}>{newGroup ? "Back to ledger" : "+ New group"}</button></div>
        {loading ? <LoadingRows /> : newGroup ? <NewGroupForm pending={pending} onSubmit={data => run(async () => { setGroup(await api<GroupSummary>("/api/v1/groups", "POST", data)); await refreshGroups(); setNewGroup(false); setMobileDetail(true); window.scrollTo(0, 0); })} /> : showGroupList && groups.length ? <><section className="panel balance-hero" aria-label="Your overall balance"><Standing amount={overall} currency={groups[0].currency}><small className="standing-meta">Across {groups.length} {groups.length === 1 ? "group" : "groups"}</small></Standing></section><section className="panel group-list" aria-label="Your groups">{groups.map(item => <button className="group-list-row" key={item.id} disabled={pending} onClick={() => selectGroup(item.id)}><span className="group-initial">{item.name[0].toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.participant_count} people · {money(item.total_expenses_minor, item.currency)} shared</small></span>{item.your_balance_minor ? <span className={`group-list-amount ${tone(item.your_balance_minor)}`}><small>{item.your_balance_minor > 0 ? "you are owed" : "you owe"}</small>{money(Math.abs(item.your_balance_minor), item.currency)}</span> : <span className="group-list-amount square"><small>{item.your_balance_minor === 0 ? "all square" : "not in the split"}</small></span>}</button>)}</section><button className="button secondary list-new-group" onClick={createGroup}>+ New group</button></> : group && !showGroupList ? <GroupDetail key={group.id} group={group} userId={session.user.id} pending={pending} onRun={run} onChange={change} onConnect={() => navigate("agent")} onNewGroup={createGroup} onLeave={() => leaveGroup(group.id)} /> : <div className="empty-state"><span className="empty-symbol" aria-hidden="true">÷</span><h2>Good things are shared.</h2><p>Your groups and shared expenses will live here.</p><button className="button primary" onClick={createGroup}>Create your first group <span aria-hidden="true">↗</span></button></div>}
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

type DetailProps = { group: GroupSummary; userId: string; pending: boolean; onRun: (work: () => Promise<void>) => Promise<void>; onChange: (path: string, method: string, body?: object) => Promise<void>; onConnect: () => void; onNewGroup: () => void; onLeave: () => Promise<void> };
type Suggestion = GroupSummary["suggested_repayments"][number];
function ExpenseLine({ date, title, detail, label, amount, tone, children }: { date: string; title: string; detail: string; label: string; amount?: string; tone: string; children?: ReactNode }) {
  return <article className="expense-row"><time className="expense-date" dateTime={date}><span>{datePart(date, "month")}</span><b>{datePart(date, "day")}</b></time><div className="expense-info"><h3>{title}</h3><p>{detail}</p></div><div className="expense-amount"><span className={`expense-share ${tone}`}><small>{label}</small>{amount ? <strong>{amount}</strong> : null}</span>{children}</div></article>;
}

function GroupDetail({ group, userId, pending, onRun, onChange, onConnect, onNewGroup, onLeave }: DetailProps) {
  const [form, setForm] = useState<"expense" | "repayment" | "person" | null>(null);
  const [editing, setEditing] = useState<Expense | undefined>();
  const [preset, setPreset] = useState<Suggestion | undefined>();
  const [personToAdd, setPersonToAdd] = useState<PersonReference>("");
  const [linkId, setLinkId] = useState("");
  const [actions, setActions] = useState(false);
  const compact = useMediaQuery("(width < 1024px)");
  const heroActions = useRef<HTMLDivElement>(null);
  const [floatAdd, setFloatAdd] = useState(false);
  // On phones, keep adding an expense one tap away once the top buttons scroll off.
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setFloatAdd(!entry.isIntersecting));
    observer.observe(heroActions.current!);
    return () => observer.disconnect();
  }, []);
  const me = group.participants.find(p => p.user_id === userId)?.id;
  const person = (id: string) => group.participants.find(p => p.id === id)?.name || "Participant";
  const left = (id: string) => Boolean(group.participants.find(p => p.id === id)?.left_at);
  const who = (id: string, start = true) => id === me ? (start ? "You" : "you") : person(id);
  const cash = (value: number) => money(value, group.currency);
  const base = `/api/v1/groups/${group.id}`;
  const mine = group.suggested_repayments.filter(r => r.from_participant_id === me || r.to_participant_id === me);
  const balance = group.balances.find(b => b.participant_id === me)?.amount_minor || 0;
  const outstanding = group.balances.reduce((sum, b) => sum + Math.max(0, b.amount_minor), 0);
  const count = `${group.expenses.length} ${group.expenses.length === 1 ? "expense" : "expenses"}`;
  async function save(path: string, method: string, data: object) { await onChange(path, method, data); setForm(null); setEditing(undefined); }
  function repay(suggestion?: Suggestion) { setPreset(suggestion); setEditing(undefined); setForm("repayment"); }
  function share(expense: Expense) {
    const own = expense.shares.find(s => s.participant_id === me)?.amount_minor || 0;
    if (!me) return { label: "total", amount: cash(expense.amount_minor), tone: "square" };
    if (expense.paid_by_participant_id === me) return expense.amount_minor > own ? { label: "you lent", amount: cash(expense.amount_minor - own), tone: "owed" } : { label: "just yours", tone: "square" };
    return own ? { label: "you borrowed", amount: cash(own), tone: "owe" } : { label: "not involved", tone: "square" };
  }
  return <>
    <section className="panel balance-hero" aria-label="Your balance">
      {me ? <Standing amount={balance} currency={group.currency}>
        {mine.length ? <ul className="debts">{mine.map(r => { const other = r.from_participant_id === me ? r.to_participant_id : r.from_participant_id; return <li key={other}><span className="avatar">{person(other)[0].toUpperCase()}</span><span>{r.from_participant_id === me ? `You owe ${person(other)}` : `${person(other)} owes you`}</span><strong className={r.from_participant_id === me ? "owe" : "owed"}>{cash(r.amount_minor)}</strong><button className="text-button" aria-label={`Record this repayment ${r.from_participant_id === me ? "to" : "from"} ${person(other)}`} onClick={() => repay(r)}>Record</button></li>; })}</ul> : null}
      </Standing> : <div className="standing"><p className="standing-label">Still to square up</p><strong className="standing-amount">{cash(outstanding)}</strong></div>}
      <div className="hero-actions" ref={heroActions}><button className="button primary" onClick={() => { setForm("expense"); setEditing(undefined); }}>+ Add expense</button><button className="button secondary" onClick={() => repay(mine[0])}>Record repayment</button></div>
      <p className="hero-meta">{cash(group.total_expenses_minor)} shared across {count} · {group.participants.map(p => who(p.id)).join(", ")} <button className="text-button hero-add-person" onClick={() => setForm("person")}>Add a person</button> <button className="text-button muted hero-add-person" disabled={pending} onClick={() => void onLeave()}>Leave group</button></p>
    </section>
    {floatAdd && !form ? <button className="float-add" aria-label="Add another expense" onClick={() => { setForm("expense"); setEditing(undefined); }}><span aria-hidden="true">+</span></button> : null}
    {actions ? <Sheet title="Group actions" onClose={() => setActions(false)}><div className="sheet-group"><button className="sheet-row" onClick={() => { setActions(false); setForm("person"); }}>Add a person</button><button className="sheet-row" onClick={() => { setActions(false); onNewGroup(); }}>+ New group</button><button className="sheet-row" disabled={pending} onClick={() => { setActions(false); void onLeave(); }}>Leave group</button></div></Sheet> : null}
    {form ? <EntryPanel compact={compact} title={form === "person" ? "One more person" : form === "repayment" ? "Record a repayment" : editing ? "Edit expense" : "Add an expense"} onClose={() => { setForm(null); setEditing(undefined); }}>
      {form === "expense" ? <ExpenseForm key={editing?.id || "new"} group={group} userId={userId} expense={editing} pending={pending} onSubmit={data => onRun(() => save(`${base}/expenses${editing ? `/${editing.id}` : ""}`, editing ? "PATCH" : "POST", data))} /> : form === "repayment" ? <RepaymentForm key={preset ? `${preset.from_participant_id}${preset.to_participant_id}` : "any"} group={group} suggestion={preset || group.suggested_repayments[0]} pending={pending} onSubmit={data => onRun(() => save(`${base}/repayments`, "POST", data))} /> : <form onSubmit={event => { event.preventDefault(); void onRun(() => save(linkId ? `${base}/participants/${linkId}` : `${base}/participants`, linkId ? "PATCH" : "POST", { ...(linkId ? {} : { request_id: crypto.randomUUID() }), person: personToAdd })); }}><Field label="Add or link a person"><select value={linkId} onChange={event => setLinkId(event.target.value)}><option value="">Add someone new</option>{group.participants.filter(p => !p.user_id && !p.left_at).map(p => <option key={p.id} value={p.id}>Link {p.name} to an account</option>)}</select></Field><PersonPicker key={linkId} label="Person name or email" onChange={setPersonToAdd} /><p className="muted">Choose an existing Splitzii user. They can view and edit this whole group.</p><button className="button primary small" disabled={pending}>{linkId ? "Link person" : "Add person"}</button></form>}
    </EntryPanel> : null}
    <div className="section-heading"><h2>The shared things <span>{group.expenses.length}</span></h2><button className="round-button group-actions" aria-label="More group actions" onClick={() => setActions(true)}><Icon name="more" /></button></div>
    <div className="detail-grid"><section className="panel expense-list" aria-label="Expenses">
      {group.expenses.length ? [...group.expenses].sort((a, b) => b.date.localeCompare(a.date)).map(expense => <ExpenseLine key={expense.id} date={expense.date} title={expense.description} detail={`${who(expense.paid_by_participant_id)} paid ${cash(expense.amount_minor)} · split ${expense.split_between_participant_ids.length} ${expense.split_between_participant_ids.length === 1 ? "way" : "ways"}`} {...share(expense)}><div><button className="text-button" aria-label={`Edit ${expense.description}`} onClick={() => { setEditing(expense); setForm("expense"); }}>Edit</button><button className="text-button muted" aria-label={`Delete ${expense.description}`} disabled={pending} onClick={() => onRun(() => onChange(`${base}/expenses/${expense.id}`, "DELETE"))}>Delete</button></div></ExpenseLine>) : <div className="list-empty"><span aria-hidden="true">÷</span><h3>Start with the first expense.</h3><p>Paid for something together? Add it here.</p></div>}
      {group.deleted_expenses?.length ? <div className="repayments"><h3>Deleted expenses</h3>{group.deleted_expenses.map(expense => <div className="repayment-row" key={expense.id}><strong>{expense.description}</strong><button className="text-button" aria-label={`Restore ${expense.description}`} disabled={pending} onClick={() => onRun(() => onChange(`${base}/expenses/${expense.id}/restore`, "POST", {}))}>Restore</button></div>)}</div> : null}
      {group.repayments.length ? <div className="repayments"><h3>Recorded repayments</h3>{group.repayments.map(repayment => <div className="repayment-row" key={repayment.id}><div><strong>{who(repayment.from_participant_id)} paid {who(repayment.to_participant_id, false)}</strong><p>{datePart(repayment.date, "month")} {datePart(repayment.date, "day")}{repayment.note ? ` · ${repayment.note}` : ""}</p></div><div><strong>{cash(repayment.amount_minor)}</strong><button className="text-button muted" aria-label={`Delete repayment from ${person(repayment.from_participant_id)}`} disabled={pending} onClick={() => onRun(() => onChange(`${base}/repayments/${repayment.id}`, "DELETE"))}>Delete</button></div></div>)}</div> : null}
    </section><details className="balance-panel" open={compact !== true}><summary className="balance-summary"><h2>Balances & repayments</h2><Icon name="down" /></summary><div className="panel"><h2>Where everyone stands</h2><p className="muted intro">After expenses and repayments.</p>{group.balances.map(item => <div className="balance-row" key={item.participant_id}><span>{item.name}{item.participant_id === me ? " (you)" : left(item.participant_id) ? " (left)" : ""}</span><div><strong className={tone(item.amount_minor)}>{cash(Math.abs(item.amount_minor))}</strong><small>{item.amount_minor > 0 ? "is owed" : item.amount_minor < 0 ? "owes" : "all square"}</small></div></div>)}<div className="square-up"><h3>{group.suggested_repayments.length ? "A way to square up" : "Everyone’s all square"}</h3>{group.suggested_repayments.map((repayment, i) => <p key={i}>{who(repayment.from_participant_id)} <span aria-hidden="true">→</span> {who(repayment.to_participant_id, false)}<strong>{cash(repayment.amount_minor)}</strong></p>)}<small>Suggestions only. Settle up however you like.</small></div></div><p className="side-note">Have your agent add an expense or explain a balance. <button className="text-button" onClick={onConnect}>Connect your agent ↗</button></p></details></div>
  </>;
}

function ExpenseForm({ group, userId, expense, pending, onSubmit }: { group: GroupSummary; userId: string; expense?: Expense; pending: boolean; onSubmit: (data: object) => Promise<void> }) {
  const [error, setError] = useState("");
  const [extraPerson, setExtraPerson] = useState<PersonReference>("");
  const people = group.participants.filter(p => !p.left_at || p.id === expense?.paid_by_participant_id || expense?.split_between_participant_ids.includes(p.id));
  const [payer, setPayer] = useState(expense?.paid_by_participant_id || group.participants.find(p => p.user_id === userId)?.id || people[0].id);
  const [date, setDate] = useState(expense?.date || today());
  const [splits, setSplits] = useState(expense?.split_between_participant_ids || people.map(p => p.id));
  const payerPerson = group.participants.find(p => p.id === payer);
  const splitSummary = splits.length === people.length ? "everyone" : people.filter(p => splits.includes(p.id)).map(p => p.user_id === userId ? "you" : p.name).join(", ") || "no one yet";
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    try {
      if (!splits.length && !extraPerson) throw new Error("Choose at least one person to share this expense.");
      void onSubmit({ ...(expense ? {} : { request_id: crypto.randomUUID() }), description: form.get("description"), amount_minor: minor(String(form.get("amount"))), paid_by_participant_id: payer, ...(extraPerson ? { split_between: [...splits.map(participant_id => ({ participant_id })), extraPerson] } : { split_between_participant_ids: splits }), date });
    } catch (problem) { setError((problem as Error).message); }
  }
  return <form className="quick-entry" onSubmit={submit}>
    <p className="entry-context">With <strong>{group.name}</strong></p>
    <div className="entry-essentials">
      <Field label="Description"><input name="description" placeholder="What was it for?" defaultValue={expense?.description} maxLength={120} required autoFocus /></Field>
      <Field label={`Amount (${group.currency})`}><input name="amount" inputMode="decimal" placeholder="0.00" defaultValue={expense ? (expense.amount_minor / 100).toFixed(2) : ""} required /></Field>
    </div>
    <p className="entry-summary">Paid by {payerPerson?.user_id === userId ? "you" : payerPerson?.name} · Split equally with {splitSummary}{extraPerson ? " + one person" : ""} · {date === today() ? "Today" : date}</p>
    <details className="entry-options" onInvalidCapture={event => { event.currentTarget.open = true; }}>
      <summary>Change details</summary>
      <div className="entry-options-content">
        <div className="form-grid">
          <Field label="Paid by"><select name="payer" value={payer} onChange={event => setPayer(event.target.value)}>{people.map(p => <option key={p.id} value={p.id}>{p.name}{p.user_id === userId ? " (you)" : ""}</option>)}</select></Field>
          <Field label="Date"><input type="date" name="date" value={date} onChange={event => setDate(event.target.value)} required /></Field>
        </div>
        <fieldset><legend>Split equally between</legend><div className="checkboxes">{people.map(p => <label key={p.id}><input type="checkbox" name="split" value={p.id} checked={splits.includes(p.id)} onChange={event => setSplits(event.target.checked ? [...splits, p.id] : splits.filter(id => id !== p.id))} />{p.name}</label>)}</div></fieldset>
        <PersonPicker label="Add someone to this expense (optional)" required={false} onChange={setExtraPerson} />
        <p className="muted">Choose an existing Splitzii user or saved friend. They also join this group.</p>
      </div>
    </details>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <button className="button primary" disabled={pending}>{pending ? "Saving…" : expense ? "Save changes" : "Save expense"}</button>
  </form>;
}

function RepaymentForm({ group, suggestion, pending, onSubmit }: { group: GroupSummary; suggestion?: Suggestion; pending: boolean; onSubmit: (data: object) => Promise<void> }) {
  const [error, setError] = useState("");
  const [from, setFrom] = useState(suggestion?.from_participant_id || group.participants[0].id);
  const [to, setTo] = useState(suggestion?.to_participant_id || group.participants[1]?.id || group.participants[0].id);
  const [date, setDate] = useState(today());
  const person = (id: string) => group.participants.find(p => p.id === id)?.name;
  return <form className="quick-entry" onSubmit={event => {
    event.preventDefault(); setError(""); const form = new FormData(event.currentTarget);
    try { if (from === to) throw new Error("Choose two different people."); void onSubmit({ request_id: crypto.randomUUID(), from_participant_id: from, to_participant_id: to, amount_minor: minor(String(form.get("amount"))), date, note: form.get("note") }); } catch (problem) { setError((problem as Error).message); }
  }}>
    <p className="muted">Record money already repaid elsewhere.</p>
    <div className="entry-essentials repayment-essentials"><Field label={`Amount (${group.currency})`}><input name="amount" inputMode="decimal" placeholder="0.00" defaultValue={suggestion ? (suggestion.amount_minor / 100).toFixed(2) : ""} required autoFocus /></Field></div>
    <p className="entry-summary">{person(from)} → {person(to)} · {date === today() ? "Today" : date}</p>
    <details className="entry-options" onInvalidCapture={event => { event.currentTarget.open = true; }}>
      <summary>Change details</summary>
      <div className="entry-options-content">
        <div className="form-grid">
          <Field label="From"><select name="from" value={from} onChange={event => setFrom(event.target.value)}>{group.participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="To"><select name="to" value={to} onChange={event => setTo(event.target.value)}>{group.participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Date"><input name="date" type="date" value={date} onChange={event => setDate(event.target.value)} required /></Field>
        </div>
        <Field label="Note (optional)"><input name="note" maxLength={240} placeholder="Paid by e-transfer" /></Field>
      </div>
    </details>
    {error ? <p className="error" role="alert">{error}</p> : null}
    <button className="button primary" disabled={pending}>{pending ? "Saving…" : "Record repayment"}</button>
  </form>;
}

function AgentConnection() {
  const [endpoint, setEndpoint] = useState("");
  useEffect(() => { setEndpoint(`${process.env.NEXT_PUBLIC_APP_URL || window.location.origin}/mcp`); }, []);
  return <><div className="page-heading"><div><p className="eyebrow">A LITTLE HELP KEEPING TRACK</p><h1>Meet your agent.</h1><Description>Your ledger, wherever you like to chat.</Description></div><span className="connection-symbol" aria-hidden="true">✳</span></div><div className="agent-grid"><section className="panel agent-card"><span className="step">01 / CONNECT</span><h2>Add Splitzii to Muse.</h2><p>Add this URL as a remote MCP connector.</p><Field label="MCP endpoint"><input value={endpoint} readOnly onFocus={event => event.target.select()} /></Field><a className="button secondary small" href="/api/plugin">Download plugin + skills ↗</a><p className="muted fine-print">For hosts that accept plugin packages. You can also connect the MCP URL directly.</p></section><section className="panel agent-card"><span className="step">02 / SIGN IN</span><h2>Continue with Google.</h2><p>Muse opens Splitzii in your browser. Sign in with Google and choose Connect once, then return to your agent.</p><p>Your agent remembers the connection. You can start recording expenses straight away.</p></section></div><div className="agent-example"><span className="eyebrow">THEN, JUST ASK</span><p>“Add dinner to the weekend group. I paid $90, split between me, Sam, and Alex.”</p><small>Your agent handles the record. You handle the good company.</small></div></>;
}
