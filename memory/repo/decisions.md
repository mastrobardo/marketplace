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

### The deploy pipeline exists but has never run
- **id**: MEM-2026-09-09-21
- **scope**: repo
- **fact**: `.github/workflows/deploy-{preview,preview-teardown,staging}.yml` and
  `release-production.yml` are complete and merged, and **not one of them has ever executed**.
  Every deploy job is gated on a preflight guard (`scripts/deploy/config.ts`) that reports which
  credentials are absent and skips. `release-production.yml` is stronger than unconfigured — a
  `push: tags` workflow is not *triggered* at all until a tag exists, so its `environment:
  production` protection and approval gate are wholly unexercised.
- **why**: `OPS-04`, `OPS-07`, `OPS-08`, `OPS-09` and `W0-T09` are all `[H]` and none is done. An
  unconfigured deploy **succeeds** rather than failing, because failing would make every PR red
  until four accounts exist, which is how a team learns to ignore red.
- **apply**: Do not treat a green PR as evidence a deploy works, and do not add a deploy to the
  required checks. Issue **#156 (`W0-T24`)** is the activation checklist; until it closes, the
  pipeline is code, not capability. If a deploy job silently does nothing, read the preflight job's
  log first — it prints exactly which secret is missing and where to set it.
- **evidence**: `docs/specs/S0/W0-T07-deploy-environments.md` §11; issue #156
- **status**: active
