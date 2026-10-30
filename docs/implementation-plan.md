# Shared people and agent tools

## Goal and scope

Keep Splitzii a small ledger on the existing Next.js, Vercel, and Supabase stack.
No payments, invitation emails, friend requests, background workers, or new services.
Google/browser OAuth stays unchanged. Work locally, test happy paths, push main.

## People, friends, and access

- A person reference can be a name, email, registered user ID, friend ID, or
  existing participant ID. Keep the current participant-ID API compatible.
- Registered profiles come from Supabase Auth. Only Auth's verified email and
  immutable user ID grant access; display names never grant access.
- Find registered users by name or exact email. Resolve against existing group
  people first, then personal friends and the user directory. Return ranked
  candidates for lookup; require a choice when a mutation is ambiguous.
- Unknown emails create pending participants. Signing in with the same verified
  Google email attaches the user to their groups, without a separate invitation.
- Unknown names create name-only participants. They remain ledger entries until
  linked explicitly by email/user ID. An existing participant can be linked later
  without changing their historical expense IDs/shares.
- Friends are a private address book, not another permission system. Add, list,
  search, and remove friends. Adding a friend alone shares no groups.
- Owners and linked group members can view and update the whole group, including
  adding people. Group ownership stays immutable. Email additions grant group
  access; adding a new person while recording an expense also adds them to that
  group. No separate expense permissions.
- Map “me” to the signed-in user when a matching participant exists or when the
  user explicitly adds themselves. Do not silently include owners in expenses.

## Tools and HTTP routes

Keep all behavior in shared domain functions and publish it through MCP/REST.

| Tool | HTTP route under /api/v1 |
| --- | --- |
| get_current_user | GET /me |
| resolve_user | GET /users/resolve?query=… |
| list_friends | GET /friends?query=… |
| add_friend | POST /friends |
| remove_friend | DELETE /friends/{friend_id} |
| resolve_group | GET /groups/resolve?query=… |
| resolve_participant | GET /groups/{group_id}/participants/resolve?query=… |
| list_expenses | GET /expenses?group_id=…&date_from=…&date_to=…&participant=…&query=…&limit=…&offset=… |
| get_expense | GET /groups/{group_id}/expenses/{expense_id} |
| get_activity | GET /activity?cursor=…&group_id=…&limit=… |
| restore_expense | POST /groups/{group_id}/expenses/{expense_id}/restore |

Extend create_group/add_participant/add_expense/update_expense to accept person
references. Include an explicit link_participant operation to attach an existing
name-only person without rewriting old financial records.

## Storage and activity

- Keep atomic group JSON documents and version-checked writes.
- Add small private profile, friend, membership, and activity tables. Expose only
  scoped RPCs; enable RLS and revoke direct access to private data.
- Rebuild membership from validated participant identities on each group write;
  preserve existing identity bindings and claim pending verified emails at sign-in.
- Archive deleted expenses in the document. They stop affecting balances but can
  be restored with their original IDs and shares.
- Write activity in the same database transaction as each change, including edits,
  deletions, restorations, and repayments. Return actor, group, change type, entity
  ID, timestamp, and a durable next cursor. Serialize cursor allocation so a later
  committed event cannot hide an earlier in-flight write.
- get_activity is a read feed. It does not wake an idle agent. Skills recommend
  checking it at conversation start; scheduled polling depends on host support.

## Delivery steps and validation

1. Implement and exercise the migration in local Postgres/PGlite.
2. Add shared person resolution, friends, filtered reads, activity, and undo.
3. Publish matching MCP tools, REST/OpenAPI schemas, plugin skills, and docs.
4. Add web friends lookup, people/email entry on group and expense forms,
   participant linking, activity view, and expense restore.
5. Run happy-path tests: two real user identities collaborate, a pending email
   joins after signup, friends resolve names, agents read filtered expenses and
   incremental activity, deletion/restoration preserves balances. Exercise the
   browser forms against the actual domain/Postgres code with a Google fixture.
6. Run tests, typecheck, production build; apply only to MCP Factory Supabase;
   push main, check the MCP Factory Vercel deployment, and smoke public metadata.

## Limits

One currency and equal splits remain. An ambiguous name needs a choice. Name-only
contacts cannot receive authenticated access until linked. No notification delivery
or Muse scheduling claim is made by this change. No Sabia resources are involved.

## Delivery record

Implemented all 21 tools and matching REST/OpenAPI operations, web friends/person
lookup/linking/activity/restore controls, and three plugin skills. Tool patterns
were informed by <https://github.com/tarunn2799/splitwise-mcp>; the existing
TypeScript/Supabase stack and Google/browser OAuth remain in place.

The shared_people_and_agent_tools migration was applied to MCP Factory with
version 20261030153110. Hosted RPC checks loaded the current profile, friends,
groups, and activity successfully. Private tables intentionally have RLS with
no direct policies/grants: scoped RPCs are their only API. Local validation
passed five domain/SQL/MCP/OAuth tests and three browser walkthroughs, plus
TypeScript and a production build. Google and Muse remain external live checks;
no agent wake-up or push delivery is implemented.
