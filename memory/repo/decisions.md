# Repo memory — decisions

Non-obvious constraints that shape the code. Formal architecture decisions live in `docs/adr/`;
this file records the *why* an agent would otherwise have to rediscover.

### Sharetribe is a reference, not a dependency
- **id**: MEM-2026-09-07-01
- **scope**: repo
- **fact**: We do not use Sharetribe's backend and do not fork their web template. We read it for
  UX patterns, Google Maps and Stripe integration approaches.
- **why**: Their fixed transaction process cannot express auctions, presupuestos, pro subscriptions
  or licence gating without fighting the platform.
- **apply**: Never add a Sharetribe SDK dependency. Cite their template only as design reference.
- **evidence**: `TODO.md` §1
- **status**: active

### Stack is Fastify + Prisma API with a separate Vite/React SPA
- **id**: MEM-2026-09-07-02
- **scope**: repo
- **fact**: No Next.js. The API and the frontend are separate apps in one pnpm monorepo, joined
  only by `packages/contracts`.
- **why**: Explicit operator decision — "api + front is better". It also gives each agent a clean
  side of the seam to own.
- **apply**: No SSR framework, no server components, no API routes inside the web app.
- **evidence**: `TODO.md` §1, §2
- **status**: active

### Money is integer cents, everywhere
- **id**: MEM-2026-09-07-03
- **scope**: repo
- **fact**: Amounts are `Int` cents plus a currency code, in the DB, the API and the UI state.
  Formatting happens only at render.
- **why**: Float arithmetic on money produces reconciliation failures that are extremely expensive
  to find after the fact.
- **apply**: If you are about to type `number` for an amount, stop.
- **evidence**: `TODO.md` §2 rule 4; `agents/roles/agent-money.md`
- **status**: active
