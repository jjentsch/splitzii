"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState<boolean | null>(null);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

const paths = {
  ledger: "M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5",
  friends: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  agent: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z",
  search: "M21 21l-5-5 M18 10a8 8 0 1 0-16 0 8 8 0 0 0 16 0",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  back: "m15 18-6-6 6-6",
  down: "m6 9 6 6 6-6",
  close: "m6 6 12 12 M6 18 18 6",
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 4 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function Sheet({ title, onClose, children, closeLabel = "Close sheet" }: { title: string; onClose: () => void; children: ReactNode; closeLabel?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = overflow; if (opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className="bottom-sheet" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="sheet-content"><span className="sheet-grabber" aria-hidden="true" /><div className="sheet-heading"><h2 id={titleId}>{title}</h2><button type="button" className="round-button" aria-label={closeLabel} onClick={onClose} autoFocus><Icon name="close" /></button></div>{children}</div>
  </dialog>;
}

export function EntryPanel({ title, onClose, children, compact }: { title: string; onClose: () => void; children: ReactNode; compact: boolean | null }) {
  if (compact) return <Sheet title={title} onClose={onClose} closeLabel="Close form">{children}</Sheet>;
  return <div className="panel entry-panel"><div className="section-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label="Close form" onClick={onClose}>×</button></div>{children}</div>;
}

export function Description({ children, lines = 2 }: { children: string; lines?: number }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [cut, setCut] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  useEffect(() => {
    const element = ref.current!;
    const observer = new ResizeObserver(() => { if (!expanded) setCut(element.scrollHeight > element.clientHeight + 1); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, children]);
  return <><p ref={ref} id={id} className="page-description" data-expanded={expanded} style={{ "--description-lines": lines } as CSSProperties}>{children}</p>{cut ? <button type="button" className="description-toggle" aria-controls={id} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show less" : lines === 1 ? "More" : "Read more"}</button> : null}</>;
}

export function LoadingRows() {
  return <div className="loading-rows" role="status" aria-label="Loading your ledger"><span className="sr-only">Loading…</span><div className="skeleton-controls" />{[0, 1, 2].map(index => <div className="skeleton-row" key={index}><i /><span><b /><b /></span><b /></div>)}</div>;
}
