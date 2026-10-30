# Splitzii

A personal cost-sharing ledger built for an agent first, with a small web app
for viewing and correcting the numbers. **No money is transferred.**

App: <https://splitzii-mcp-factory.vercel.app> ·
MCP: <https://splitzii-mcp-factory.vercel.app/mcp> ·
[Plugin download](https://splitzii-mcp-factory.vercel.app/api/plugin) ·
[OpenAPI](https://splitzii-mcp-factory.vercel.app/api/openapi)

## MVP requirements

- Sign in with Google through Supabase Auth. Users need no Supabase account.
- Every user owns private groups. Participants are names and need no accounts.
- Create groups, add participants, record expenses paid by one person, and split
  equally among selected participants. The payer may be included in the split.
- Edit or delete expenses. Record or delete repayments made elsewhere.
- Show exact shares, net balances, and one suggested way to square up.
- One app currency with two decimal places, initially CAD. Money uses integer
  cents; remainder cents go to participants in sorted ID order.
- All ledger actions work through HTTP and MCP using the same functions.
- Use the default Vercel hostname. No custom domain is needed.

Keep this a small hobby project. Invitations, shared account access, uploads,
currency conversion, custom percentages, recurring expenses, notifications,
payments, and an embedded AI chatbot are outside v1.

## Architecture and development plan

One TypeScript/Next.js app runs on Vercel. Supabase provides Postgres and Google
authentication. Muse supplies the agent; the app has no model provider or AI
runtime. There are no queues, caches, background jobs, or separate API service.

1. Build the shared ledger functions and validate the expense → balance →
   repayment happy path.
2. Expose those functions through a versioned HTTP API and stateless MCP over
   Streamable HTTP, with common input schemas.
3. Add Google sign-in, the small web ledger, and browser-based OAuth for agents.
4. Package two skills with the MCP connection and deploy the MVP to Vercel.
5. Try it in Muse and refine only what real use shows is needed.

Each small group is stored as one JSON document with a version number. This
keeps each expense and its shares atomic without a multi-table transaction.
Writes compare versions and reread/retry a concurrent change. Balances are
calculated from expenses and repayments, never maintained as mutable totals.
This intentionally suits small personal ledgers rather than large accounting
datasets.

Supabase row-level security protects direct reads. Version-checked RPCs scope
every read/write to the authenticated Google user.
Privileged helpers live in a non-exposed schema and explicitly validate the
owner. Only a publishable Supabase key is needed; there is no service-role key.
Supabase’s OAuth 2.1 server handles client registration, PKCE, consent grants,
access tokens, and refresh tokens. Existing personal tokens remain compatible,
but new connections use OAuth and require no copied credentials.

## Run locally

Requires Node 24 and npm. Dependencies are pinned and the lockfile is committed.

```sh
npm ci
cp .env.example .env.local
```

Set the Supabase URL and **publishable** key in `.env.local`. For a local
Supabase stack, run `npm run db:start` (Docker required) followed by
`npm run db:reset`, and use the local project values. For hosted Supabase,
apply `supabase/migrations/20261030135023_initial_ledger.sql` once through the
Supabase CLI or dashboard SQL editor.

```sh
npm run dev
```

Open <http://localhost:3000>. The hosted app uses the same four environment
variables listed in `.env.example`. `NEXT_PUBLIC_APP_URL` is the stable app
origin without a trailing slash. Never commit `.env.local`.

### Google sign-in setup

1. Create a Google OAuth client of type **Web application** in Google Cloud.
2. In Supabase → Authentication → Sign In / Providers → Google, enable the
   provider and enter the client ID and secret directly in Supabase.
3. Use the Supabase callback URL shown there as Google's authorized redirect
   URI: `https://<project-ref>.supabase.co/auth/v1/callback`.
4. Set Supabase's Site URL to the stable Vercel app origin, and allow the exact
   `<app-origin>/auth/callback` redirect. Add
   `http://localhost:3000/auth/callback` for local development.
5. While the Google OAuth app is in Testing, add intended users as Google test
   users. First Google sign-in creates the app user automatically.

For the MCP Factory deployment, configure these exact values:

| Setting | Value |
| --- | --- |
| Google authorized JavaScript origin | `https://splitzii-mcp-factory.vercel.app` |
| Google authorized redirect URI | `https://ebtxqqyoxjdvqauaxsrp.supabase.co/auth/v1/callback` |
| Supabase Site URL | `https://splitzii-mcp-factory.vercel.app` |
| Supabase allowed app redirect | `https://splitzii-mcp-factory.vercel.app/auth/callback` |

Keep nonce checks enabled. OAuth credentials belong only in the Supabase
dashboard. Start sign-in on the canonical app origin; alternate Vercel aliases
redirect there before creating the PKCE verifier cookie.

The local setup agent reported a successful Google sign-in on a different
deployment. Sign-in on the MCP Factory origin still needs verification after
the dashboard URLs above are applied. Local expense CRUD and MCP happy paths
have passed; hosted expense CRUD and Muse integration remain to be checked.

Supabase manages the sign-in session. The app has no password or registration
form. The browser calls request-scoped session routes, which can refresh and
write cookies; private responses use `Cache-Control: no-store`.

## One-time OAuth server setup (project owner)

In the MCP Factory project only:
<https://supabase.com/dashboard/project/ebtxqqyoxjdvqauaxsrp/auth/oauth-server>

Under **Authentication → OAuth Server**:

1. Enable the OAuth 2.1 server.
2. Set the authorization/consent path to `/oauth/consent`.
3. Enable dynamic client registration, allowing Muse to register itself.
4. Keep the Site URL and Google redirect settings in the table above.

These hosted dashboard settings are separate from the committed local
`[auth.oauth_server]` configuration. No client secret, service-role key, or
new database migration is needed in the app. Supabase owns the callback
validation, authorization codes, PKCE, and token lifecycle.

## Test with Muse

1. Add `https://splitzii-mcp-factory.vercel.app/mcp` as a remote MCP connector
   in Muse. Choose OAuth/browser sign-in if asked for an authentication type.
2. Continue with Google in the browser and choose **Connect** once. Return to
   Muse; it stores and refreshes the connection automatically.
3. If Muse has cached the old API-key connection, remove that connector and
   add the URL again. Do not paste a key.
4. Add the two skills using Muse's supported mechanism, or download the plugin
   package if the host supports packages.
5. Ask: “Create a Weekend group with Me, Sam, and Alex.” Then: “Record $90 for
   dinner today, paid by Me and split among all three.” Ask who owes what.

The app implements MCP OAuth discovery with a `WWW-Authenticate` challenge
and protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`
(and the root fallback). The authorization server is Supabase Auth; clients
use its discovery document at
`https://ebtxqqyoxjdvqauaxsrp.supabase.co/.well-known/oauth-authorization-server/auth/v1`.
The consent page preserves the authorization request through Google sign-in.
The MCP and REST routes validate Supabase-issued OAuth access JWTs and use the
user identity for the same owner-scoped ledger RPCs as the browser.

Live Muse OAuth remains unverified until the hosted OAuth server is enabled
and the full browser connection is exercised. This implementation does not
claim that adding the URL alone can complete an unconfigured provider setup.

The plugin download contains `plugin.json`, a deployment-specific `mcp.json`,
and two skills: `manage-shared-expenses` and `explain-balances`. No credentials
are included. The skills resolve names to IDs, ask only for missing or ambiguous
details, and do not request another confirmation of clear ledger instructions.

## Agent-first API

The generated OpenAPI 3.1 document is at `/api/openapi`. HTTP responses are
`{ "data": result }` or `{ "error": { "code", "message" } }`. Agents use the OAuth authorization-code flow with PKCE; the host manages
credentials. Browser requests use the Google session cookie. Never use a
Supabase project key as an agent credential.

| MCP tool | HTTP method and path under `/api/v1` |
| --- | --- |
| `list_groups` | `GET /groups` |
| `create_group` | `POST /groups` |
| `get_group` | `GET /groups/{group_id}` |
| `add_participant` | `POST /groups/{group_id}/participants` |
| `add_expense` | `POST /groups/{group_id}/expenses` |
| `update_expense` | `PATCH /groups/{group_id}/expenses/{expense_id}` |
| `delete_expense` | `DELETE /groups/{group_id}/expenses/{expense_id}` |
| `record_repayment` | `POST /groups/{group_id}/repayments` |
| `delete_repayment` | `DELETE /groups/{group_id}/repayments/{repayment_id}` |

For creation, provide a fresh UUID `request_id`; reuse it for retries of the
same creation. Dates are explicit `YYYY-MM-DD`. Amounts are positive integer
minor units. `get_group` and mutations return entries, exact shares, balances,
and suggested repayments. Positive balance means money is owed to that person;
negative means that person owes money. Suggestions never move money.

## Happy-path verification

```sh
npm test
npm run typecheck
npm run build
# In a second terminal, with the app running:
npx playwright install chromium
npm run test:browser
```

The automated checks cover shared-expense arithmetic and corrections,
the actual stateless Streamable HTTP MCP protocol, and the SQL migration with
Google-user ownership context and legacy personal-token compatibility. A
local OAuth happy path verifies discovery, Google continuation, a signed access
JWT, and an authenticated MCP request using the real Supabase client. Database checks use
local Postgres via PGlite and do not require a hosted project.

One browser walkthrough creates a group, records dinner, records an external
repayment, edits and deletes an expense, and checks the mobile layout. It uses
the real HTTP dispatcher, ledger functions, and local Postgres, with a fixture
for the signed-in Google session. Google OAuth and the hosted Supabase connection
still require a live sign-in walkthrough. Tests cover happy paths only; no
coverage target or exhaustive test matrix.

Deploy from the authorized main branch after checks pass. Vercel can build the
repository when its GitHub integration has access, or accept the same source
files directly through its deployment API.
