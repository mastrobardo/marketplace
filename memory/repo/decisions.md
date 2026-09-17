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

### Prefer a manual rebase over restructuring source files to avoid conflicts
- **id**: MEM-2026-09-09-28
- **scope**: repo
- **fact**: Shared files that parallel branches collide on — the i18n catalogues, the appended
  memory files, the README Layout table — stay as they are. Conflicts are resolved by rebasing by
  hand. Do not split a file into one-record-per-file, and do not add generated indexes or git merge
  drivers, to avoid them.
- **why**: The operator rejected exactly that after seeing it built (`W0-T23`, PR #161, reverted
  whole). Splitting two translation catalogues into fourteen files makes every agent that reads or
  edits copy pay a permanent cost, every day, to avoid an occasional conflict a human resolves in
  under a minute. The merge-conflict cost is visible and the fragmentation cost is not, which is how
  the trade looks better than it is.
- **apply**: Expect to re-merge `main` after each PR lands, and resolve by hand — keeping both sides
  only after confirming the hunk is genuinely an addition (`MEM-2026-09-09-13`). If a shared file
  ever does become intolerable, agree the trade-off with the operator **before** writing the spec:
  see `agents/prompts/00-spec-authoring.md`.
- **evidence**: PR #161 and its revert; `docs/interventions/2026-09-09-W0-T23-01.md`
- **status**: active

### A provider's base address is their operating centre, and it is required

- **id**: MEM-2026-09-17-15
- **scope**: repo
- **fact**: Every provider — manitas or pro — must have a base address, and it is **the centre of
  the radius they work in, not where they live**. A provider may legitimately set it to a city
  centre and cover 40 km from there. Operator's rule, 2026-09-17, taken while reviewing `W3-T07`'s
  answer for a provider without one.
- **why**: `base_address_id` is nullable today, and the null is not a benign "not set yet": such a
  provider is excluded from search entirely (`W3-T05` AC6, `schema.prisma:213`) and cannot be
  serialised by `ProviderProfileSchema` at all, which requires `city`, `province` and `point`. So
  the state the schema permits is one the product cannot serve — `W3-T07` answers it `404`, for a
  row that exists. Requiring the address deletes the state rather than handling it.
- **apply**: `W3-T02` requires a base address at profile creation; making the column `NOT NULL` is a
  migration for `agent-contracts` (`docs/specs/S3/W3-T07-provider-profile-api.md` §5 Q1). Until
  both land, treat "no base address" as unlisted rather than as an error — and do not add a second
  way of rendering a provider without one. Separately, **the privacy rule does not weaken**: a
  provider may still enter their home, and no endpoint can tell which did, so the coarse point and
  the `line1`/`line2` deny stand exactly as they are. What changes is the *stated purpose* of the
  column — `schema.prisma:214` and `packages/contracts/src/search.ts` both justify coarsening with
  "usually a home address", which is now the wrong reason for the right behaviour (§5 Q2).
- **evidence**: `docs/specs/S3/W3-T07-provider-profile-api.md` §2.4; `TODO.md` `W3-T02`
- **status**: active
