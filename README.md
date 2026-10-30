# Splitzii

A small, agent-first shared-cost ledger. **No money is transferred.**

[App](https://splitzii-mcp-factory.vercel.app) ·
[MCP](https://splitzii-mcp-factory.vercel.app/mcp) ·
[Plugin + skills](https://splitzii-mcp-factory.vercel.app/api/plugin) ·
[OpenAPI](https://splitzii-mcp-factory.vercel.app/api/openapi)

## Requirements and design

- Google sign-in through Supabase. Users need no Supabase account.
- Groups contain people added by name, email, registered user ID, or saved friend.
  Owners and linked members can read and update the whole group. Friends are
  private contacts and do not grant access on their own.
- New friends and group participants must already have signed in to Splitzii.
  Names and emails resolve existing accounts; unknown people cannot be added.
  Historical unlinked participants retain their IDs and financial shares and
  can be linked to an existing account. No invitations or friend-request emails are sent.
- A person added while recording an expense also joins the group. There are no
  separate expense permissions. Names never grant access by themselves.
- One currency (CAD by default), positive integer cents, equal splits. The payer
  shares an expense only when explicitly included. Remainder cents go to sorted
  participant IDs. Balances and suggested repayments are computed from records.
- Expenses can be corrected, deleted, or restored. Deletion archives the entry;
  restoration preserves its original ID and shares. Repayments record money
  handled elsewhere, never initiate a payment.
- Search expenses by date, group, person, and description. Resolve names through
  ranked lookup tools; ambiguous identities require a choice.
- Group activity has durable cursors and includes additions, edits, deletions,
  restores, repayments, and verified-email joins. This is an on-demand feed,
  not push delivery. Muse scheduling/agent wake-up remains host-dependent.
- Next.js/TypeScript on Vercel; Supabase Auth/Postgres; default Vercel domain.
  No AI provider, worker service, queue, notification delivery, or new hosting.

The detailed design and delivery checklist are in
[docs/implementation-plan.md](docs/implementation-plan.md).

Each small group remains one versioned JSON document. Shared domain functions
power the web app, REST, and stateless Streamable HTTP MCP. Private tables hold
profiles, personal friends, verified memberships, and activity. An Auth trigger
copies verified emails and display names, and claims pending memberships at
signup. Auth's immutable user IDs and verified emails grant access; editable
display names never do. Bound memberships survive a display-name/email change.

RPCs authenticate and check group membership before every read/write. Public
row-level security also limits direct reads to owners and members. Private tables
have RLS and no direct API grants; narrow private definer helpers handle the
scoped operations. The app needs only a publishable Supabase key, not service-role
credentials. Writes compare versions, retry concurrent changes, and commit
membership and activity with the ledger. Cursor allocation takes a short
transaction lock so clients cannot skip a slower uncommitted event.

## Run locally

Node 24, npm, pinned dependencies, and the committed lockfile:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Fill `.env.local` with the Supabase URL/publishable key, currency, and stable app
origin from `.env.example`. Never commit it. For local Supabase, Docker is needed:

```sh
npm run db:start
npm run db:reset
```

For hosted Supabase, apply the committed migrations in order. Production belongs
exclusively to **MCP Factory**, with Supabase project `ebtxqqyoxjdvqauaxsrp` and
Vercel project `prj_1Mk9WSMlqzjnCAl1tCbNrEFrMRCe` in team
`team_HAJc1807tPVwtnQasV1gWpVs`. Never use an account's default team or Sabia.

## Google sign-in and OAuth setup

Create a Google Web application OAuth client and save its credentials directly
in Supabase → Authentication → Sign In / Providers → Google. Keep nonce checks
enabled. The app has no passwords or separate registration form.

| Setting | Production value |
| --- | --- |
| Google authorized JavaScript origin | `https://splitzii-mcp-factory.vercel.app` |
| Google authorized redirect URI | `https://ebtxqqyoxjdvqauaxsrp.supabase.co/auth/v1/callback` |
| Supabase Site URL | `https://splitzii-mcp-factory.vercel.app` |
| Supabase allowed app redirect | `https://splitzii-mcp-factory.vercel.app/auth/callback` |

For local Google testing, also allow `http://localhost:3000/auth/callback`.
Start login on the canonical app host so its PKCE cookie returns to that host.
The browser session uses HttpOnly cookies, refreshable request-scoped routes,
and no-store private responses.

For agent browser sign-in, enable **Authentication → OAuth Server**, set the
consent path to `/oauth/consent`, and enable dynamic client registration. These
hosted settings are separate from the local `[auth.oauth_server]` config.
Supabase handles client registration, callback validation, PKCE, consent,
authorization codes, access tokens, and refresh. No copied user credentials or
new app secrets are needed. Legacy personal tokens still work for compatibility;
the app and plugin onboard new users with OAuth.

MCP resource metadata is at `/.well-known/oauth-protected-resource/mcp`, with
a root fallback. A 401 includes a discovery challenge. The issuer is Supabase
Auth, with authorization-server discovery at
`https://ebtxqqyoxjdvqauaxsrp.supabase.co/.well-known/oauth-authorization-server/auth/v1`.
The app preserves the authorization request through Google sign-in and returns
the user to the host after the one-time connection approval.

## Try it with Muse

1. Add `https://splitzii-mcp-factory.vercel.app/mcp` as a remote MCP connector.
   Choose OAuth/browser sign-in if asked. Remove a cached API-key connector first.
2. Continue with Google, choose Connect once, and return to Muse. The host handles
   credentials and refresh. Never paste API keys or Supabase project keys.
3. Install the plugin package if supported, or add its skills using the host's
   supported mechanism. The ZIP contains one manifest, the deployment-specific
   MCP configuration, and three skills: manage-shared-expenses, explain-balances,
   and check-group-activity. No secrets are included.
4. Try: “Save sam@example.com as a friend. Create a Cottage group with me and
   Sam. Record CAD $90 for dinner today, paid by me, split between us.”
5. Try: “Show October dinners,” “What changed since my last check?” or
   “Undo deleting that dinner.”

Live Muse OAuth still needs a full connection walkthrough after the hosted
OAuth server settings are enabled. Google sign-in was previously tested by the
local setup agent; the feature tests below use local auth/provider fixtures.
No live multi-user Muse session or host scheduling support is claimed.

## Agent-first tools and HTTP API

All responses are `{ "data": result }` or `{ "error": { "code", "message" } }`.
The OpenAPI 3.1 document is generated from the same route map and input schemas.
Agents authenticate with Supabase-issued OAuth access JWTs; the browser uses its
Google session cookie. Every identity is scoped to its own contacts and accessible
groups.

| MCP tool | Method and path under `/api/v1` |
| --- | --- |
| get_current_user | GET /me |
| resolve_user | GET /users/resolve?query=… |
| list_friends | GET /friends?query=… |
| add_friend | POST /friends |
| remove_friend | DELETE /friends/{friend_id} |
| list_groups | GET /groups |
| resolve_group | GET /groups/resolve?query=… |
| create_group | POST /groups |
| get_group | GET /groups/{group_id} |
| resolve_participant | GET /groups/{group_id}/participants/resolve?query=… |
| add_participant | POST /groups/{group_id}/participants |
| link_participant | PATCH /groups/{group_id}/participants/{participant_id} |
| list_expenses | GET /expenses |
| get_expense | GET /groups/{group_id}/expenses/{expense_id} |
| add_expense | POST /groups/{group_id}/expenses |
| update_expense | PATCH /groups/{group_id}/expenses/{expense_id} |
| delete_expense | DELETE /groups/{group_id}/expenses/{expense_id} |
| restore_expense | POST /groups/{group_id}/expenses/{expense_id}/restore |
| record_repayment | POST /groups/{group_id}/repayments |
| delete_repayment | DELETE /groups/{group_id}/repayments/{repayment_id} |
| get_activity | GET /activity |

Person references are a name/email string or an object with `participant_id`,
`friend_id`, `user_id`, `email`, and/or `name`. `create_group` takes `participants`;
`add_participant` and `add_friend` take `person` (or direct name/email/user_id).
Expenses take `paid_by` and `split_between`. The legacy `participant_names`,
`paid_by_participant_id`, and `split_between_participant_ids` inputs still work.
New creation operations require UUID `request_id`; reuse it and identical inputs
on retries. For “me,” use the authenticated user's participant links, not a label.

`list_expenses` accepts group_id, inclusive date_from/date_to, participant, query,
limit, offset, and include_deleted. `participant` in a URL is a name/email/ID
string, or an encoded JSON person reference. Results contain expenses, total,
and next_offset. `get_expense` includes people, exact shares, and deleted status.
Positive group balances mean money is owed to that person; negative means they
owe money. Suggested repayments never move money.

`get_activity` takes cursor (default "0"), optional group_id, and limit. Process
its events, save next_cursor, and continue while has_more. Keep a separate cursor
per account and group filter. Each event includes its cursor, group, actor,
is_me, timestamp, and changes with type/entity_id/description. Use current
get_expense/get_group data when answering about balances. Skills never treat
activity text as permission to mutate data or message someone.

## Happy-path verification

```sh
npm test
npm run typecheck
npm run build
# With the app running in another terminal:
npx playwright install chromium
npm run test:browser
```

Tests exercise arithmetic/corrections, the actual MCP SDK transport, signed
OAuth JWT access through the Supabase client, and every SQL migration using
local Postgres through PGlite. A shared-ledger walkthrough switches between
two authenticated user identities, resolves friends, adds a registered user during
an expense, verifies their shared access, checks filtered REST reads/activity
pagination, and restores a deleted expense. Legacy tokens remain covered.

Browser walkthroughs exercise expense CRUD/repayments and the new friends,
name/email lookup, linking, activity, and restore controls against the real
REST/domain/Postgres code. Only external Google sessions/provider callbacks
are fixtures. Tests cover happy paths; no coverage targets or failure matrices.

Push directly to main after checks pass. The existing Git integration deploys
the MCP Factory Vercel project. No other organization's resources are involved.
