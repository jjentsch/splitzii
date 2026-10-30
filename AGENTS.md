# Splitzii

This is a personal hobby ledger. Ship the smallest useful change quickly.

- No payments or money movement. Repayments record something done elsewhere.
- Use Next.js on Vercel and Supabase for Google sign-in and storage.
- Keep API, MCP, and web behavior in shared ledger functions.
- Prefer existing dependencies and ordinary functions over new infrastructure.
- Money uses integer minor units. Equal splits only; one app currency.
- Implement authentication, ownership checks, and input validation without adding approval prompts to normal ledger actions.
- Test happy paths only. No coverage targets, failure matrices, or exhaustive suites.
- Run `npm test`, `npm run typecheck`, and `npm run build` for meaningful implementation changes.
- Work locally and push directly to main when checks pass, as authorized by the owner. Never force-push.
- Do not commit credentials or local environment files.
