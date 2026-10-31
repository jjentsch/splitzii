"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Icon, Sheet, useMediaQuery } from "./mobile-ui";

export type View = "ledger" | "friends" | "activity" | "agent";
export type GroupItem = { id: string; name: string; currency: string; participant_count: number; total_expenses_minor: number };
export type ShellSheet = "account" | "groups" | "search" | null;
const tabs = [{ view: "ledger", label: "Your ledger", short: "Ledger" }, { view: "friends", label: "Friends", short: "Friends" }, { view: "activity", label: "Activity", short: "Activity" }, { view: "agent", label: "Agent connection", short: "Agent" }] as const;

export default function MobileChrome({ view, title, detail, email, groups, selectedId, sheet, onSheet, onNavigate, onBack, onGroup, onNewGroup }: {
  view: View; title: string; detail: boolean; email: string; groups: GroupItem[]; selectedId?: string; sheet: ShellSheet;
  onSheet: (sheet: ShellSheet) => void; onNavigate: (view: View) => void; onBack: () => void; onGroup: (id: string) => void; onNewGroup: () => void;
}) {
  const phone = useMediaQuery("(width < 640px)");
  const bar = useRef<HTMLElement>(null);
  const chips = useRef<HTMLElement>(null);
  const [titleVisible, setTitleVisible] = useState(false);
  const [compact, setCompact] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let previousY = window.scrollY;
    let frame = 0;
    const update = () => {
      const y = window.scrollY;
      const heading = document.querySelector("main h1");
      setTitleVisible(Boolean(heading && heading.getBoundingClientRect().bottom <= (bar.current?.offsetHeight || 44)));
      if (y < 80 || window.innerHeight + y >= document.documentElement.scrollHeight - 80) setCompact(false);
      else if (Math.abs(y - previousY) > 6) setCompact(y > previousY);
      previousY = y;
      frame = 0;
    };
    const scroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", scroll);
    return () => { window.removeEventListener("scroll", scroll); window.removeEventListener("resize", scroll); cancelAnimationFrame(frame); };
  }, [title]);
  useEffect(() => { const row = chips.current;
    const selected = row?.querySelector<HTMLElement>("[aria-current]");
    if (row && selected) row.scrollLeft = selected.offsetLeft - (row.clientWidth - selected.offsetWidth) / 2; }, [selectedId, view, detail]);
  const active = sheet === "account" || sheet === "search" ? 4 : tabs.findIndex(tab => tab.view === view);
  const matchingGroups = groups.filter(group => group.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <header ref={bar} className="mobile-topbar" data-title-visible={titleVisible}>
      {detail ? <button type="button" className="mobile-back" onClick={onBack} aria-label="Back to ledger"><Icon name="back" /><span>Ledger</span></button> : <a className="mobile-brand" href="/" aria-label="Splitzii home"><img src="/splitzii-logo.png" alt="SPLITZii" width="2079" height="756" /></a>}
      <span className="mobile-small-title" aria-hidden="true">{title}</span>
      {phone !== false ? <button className="account-button phone-only" aria-label="Open account" onClick={() => onSheet("account")}><span className="avatar">{email[0]?.toUpperCase() || "Y"}</span></button> : null}
    </header>
    {!detail && view === "ledger" && groups.length ? <nav ref={chips} className="tablet-sections" aria-label="Groups">{groups.map(group => <button key={group.id} aria-current={selectedId === group.id ? "page" : undefined} onClick={() => onGroup(group.id)}>{group.name}</button>)}</nav> : null}
    <nav className="bottom-tabs" aria-label="Main navigation" data-compact={compact} style={{ "--active-tab": active } as CSSProperties} onFocusCapture={event => { if (event.target.matches(":focus-visible")) setCompact(false); }}>
      <span className="tab-highlight" aria-hidden="true" />
      {tabs.map(tab => <button key={tab.view} aria-label={tab.label} aria-current={view === tab.view ? "page" : undefined} onClick={() => { onSheet(null); onNavigate(tab.view); }}><Icon name={tab.view} /><span>{tab.short}</span></button>)}
      <button aria-label={phone === false ? "More" : "Search"} aria-expanded={sheet === "account" || sheet === "search"} onClick={() => { setQuery(""); onSheet(phone === false ? "account" : "search"); }}><Icon name={phone === false ? "more" : "search"} /><span>{phone === false ? "More" : "Search"}</span></button>
    </nav>
    {sheet ? <Sheet title={sheet === "account" ? "Your account" : sheet === "search" ? "Find a group" : "Your groups"} onClose={() => onSheet(null)}>
      {sheet === "account" ? <>
        <section className="sheet-group account-identity"><span className="avatar">{email[0]?.toUpperCase() || "Y"}</span><div><strong>Signed in with Google</strong><p>{email}</p></div></section>
        <section className="sheet-group"><h3>Your personal ledger</h3><p>Share expenses with your groups. Repayments record money already handled elsewhere.</p></section>
        <form action="/auth/logout" method="post" className="sheet-group"><button className="sheet-row" type="submit">Sign out <span aria-hidden="true">↗</span></button></form>
      </> : <>
        {sheet === "search" ? <div className="field"><label htmlFor="group-search">Search your groups</label><input id="group-search" type="search" placeholder="A trip, dinner, a household…" value={query} onChange={event => setQuery(event.target.value)} /></div> : null}
        <div className="sheet-group">{matchingGroups.length ? matchingGroups.map(group => <button className="sheet-row" key={group.id} aria-current={selectedId === group.id ? "page" : undefined} onClick={() => { onSheet(null); onGroup(group.id); }}><span>{group.name}<small>{group.participant_count} people · {group.currency}</small></span><Icon name="back" /></button>) : <p className="sheet-empty">{query ? "No matching groups." : "Your first shared thing starts here."}</p>}</div>
        <button className="button primary sheet-primary" onClick={() => { onSheet(null); onNewGroup(); }}>+ New group</button>
      </>}
    </Sheet> : null}
  </>;
}
