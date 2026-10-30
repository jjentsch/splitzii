"use client";

import { useEffect, useState } from "react";
import type { OAuthAuthorizationDetails } from "@supabase/supabase-js";

export default function Consent() {
  const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const id = new URLSearchParams(window.location.search).get("authorization_id") || "";
    fetch(`/api/oauth/authorization?authorization_id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || "Please connect again from your agent.");
        if (!active) return;
        if (result.data.sign_in_url) window.location.assign(result.data.sign_in_url);
        else if (result.data.redirect_url) window.location.assign(result.data.redirect_url);
        else setDetails(result.data);
      }).catch(problem => { if (active) setError(problem.message); });
    return () => { active = false; };
  }, []);
  return <main className="consent-shell"><section className="panel agent-card">
    <a className="brand" href="/">splitzii<span>✳</span></a>
    <h1>Connect your agent.</h1>
    {error ? <p role="alert">{error}</p> : details ? <>
      <p><strong>{details.client.name || "Your agent"}</strong> wants to access your Splitzii ledger as {details.user.email}.</p>
      <p>It can view and update your owned and shared groups, manage your private friends list, add people to groups, and record expenses and repayments. No money is transferred.</p>
      {details.scope ? <p className="muted">Account permissions: {details.scope.split(" ").join(", ")}.</p> : null}
      <p className="muted">Return to {new URL(details.redirect_uri).hostname} after connecting.</p>
      <form action="/api/oauth/authorization" method="post">
        <input type="hidden" name="authorization_id" value={details.authorization_id} />
        <div className="button-row"><button className="button primary" name="action" value="approve">Connect</button><button className="button secondary" name="action" value="deny">Cancel</button></div>
      </form>
    </> : <p role="status">Opening your connection…</p>}
  </section></main>;
}
