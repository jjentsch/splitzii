"use client";

import { useEffect, useId, useState } from "react";
import { api } from "@/lib/browser-api";
import type { ActivityPage, Friend, PersonReference } from "@/lib/ledger";

type Match = { name: string; email?: string; user_id?: string; friend_id?: string; match_score: number };
export function PersonPicker({ label, onChange, required = true }: { label: string; onChange: (person: PersonReference) => void; required?: boolean }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState(false);
  const [matches, setMatches] = useState<Match[]>([]);
  useEffect(() => {
    if (chosen || query.trim().length < 2) return;
    let active = true;
    const timer = setTimeout(() => {
      api<Match[]>(`/api/v1/users/resolve?query=${encodeURIComponent(query.trim())}`).then(result => { if (active) setMatches(result.slice(0, 6)); }).catch(() => { if (active) setMatches([]); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, chosen]);
  return <div className="field person-picker"><label htmlFor={id}>{label}</label><input id={id} value={query} required={required} maxLength={254} autoComplete="off" placeholder="Name or email address" onChange={event => { const value = event.target.value; setQuery(value); setChosen(false); setMatches([]); onChange(value); }} />
    {!chosen && matches.length ? <div className="person-matches" aria-label="Matching people">{matches.map((match, i) => <button type="button" key={match.user_id || match.friend_id || i} onClick={() => { setChosen(true); setMatches([]); setQuery(match.name); const { match_score: _, ...person } = match; void _; onChange(person); }}><strong>{match.name}</strong><small>{match.email || "Saved contact"}{match.friend_id ? " · Friend" : ""}</small></button>)}</div> : null}
  </div>;
}

type PanelProps = { pending: boolean; onRun: (work: () => Promise<void>) => Promise<void>; onError: (message: string) => void };
export function FriendsPanel({ pending, onRun, onError }: PanelProps) {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [person, setPerson] = useState<PersonReference>("");
  const [revision, setRevision] = useState(0);
  useEffect(() => { let active = true; api<Friend[]>("/api/v1/friends").then(result => { if (active) setFriends(result); }).catch(error => { if (active) onError(error.message); }); return () => { active = false; }; }, [onError]);
  return <><div className="page-heading"><div><p className="eyebrow">THE PEOPLE YOU SHARE WITH</p><h1>Your friends.</h1><p>Save people once. Find them quickly next time.</p></div></div><div className="agent-grid"><section className="panel agent-card"><h2>Add a friend</h2><form onSubmit={event => { event.preventDefault(); void onRun(async () => { await api("/api/v1/friends", "POST", { request_id: crypto.randomUUID(), person }); setFriends(await api<Friend[]>("/api/v1/friends")); setPerson(""); setRevision(v => v + 1); }); }}><PersonPicker key={revision} label="Friend name or email" onChange={setPerson} /><p>A friend is a private saved contact. Groups are shared only when you add them to one.</p><button className="button primary small" disabled={pending}>Save friend</button></form></section><section className="panel agent-card"><h2>Saved friends</h2>{friends.length ? friends.map(friend => <div className="token-row" key={friend.id}><span>{friend.name}<small>{friend.email || "Name only"}</small></span><button className="text-button muted" disabled={pending} aria-label={`Remove friend ${friend.name}`} onClick={() => onRun(async () => { await api(`/api/v1/friends/${friend.id}`, "DELETE"); setFriends(await api<Friend[]>("/api/v1/friends")); })}>Remove</button></div>) : <p>No friends saved yet.</p>}</section></div></>;
}

export function ActivityPanel({ pending, onRun, onError }: PanelProps) {
  const [page, setPage] = useState<ActivityPage>({ events: [], next_cursor: "0", has_more: false });
  useEffect(() => { let active = true; api<ActivityPage>("/api/v1/activity").then(result => { if (active) setPage(result); }).catch(error => { if (active) onError(error.message); }); return () => { active = false; }; }, [onError]);
  return <><div className="page-heading"><div><p className="eyebrow">WHAT’S BEEN SHARED</p><h1>Group activity.</h1><p>Expenses, corrections, repayments, and new people.</p></div><button className="button secondary small" disabled={pending} onClick={() => onRun(async () => { setPage(await api<ActivityPage>("/api/v1/activity")); })}>Refresh activity</button></div><section className="panel activity-list">{page.events.length ? page.events.map(event => <article className="activity-row" key={event.cursor}><div><strong>{event.group_name}</strong><small>{event.actor_name}{event.is_me ? " (you)" : ""} · {new Date(event.occurred_at).toLocaleString()}</small></div>{event.changes.map((change, i) => <p key={i}>{change.type.replaceAll("_", " ")}{change.description ? ` · ${change.description}` : ""}</p>)}</article>) : <p className="muted">Changes to your groups will appear here.</p>}{page.has_more ? <button className="button secondary small" disabled={pending} onClick={() => onRun(async () => { const next = await api<ActivityPage>(`/api/v1/activity?cursor=${page.next_cursor}`); setPage({ ...next, events: [...page.events, ...next.events] }); })}>More activity</button> : null}</section></>;
}
