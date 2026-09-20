# Marketplace MVP — Plan & Backlog

> Reformations, house maintenance and emergency call-outs marketplace.
> Two-sided: **clients** ⇄ **manitas** (non-licensed handymen) and **professionals** (licensed).
> Built primarily by AI agents — the process below exists so several agents can work in
> parallel without colliding, and so agent output quality is *measurable*, not anecdotal.

---

## 1. Locked decisions

| Area | Decision |
|---|---|
| API | **Fastify + TypeScript + Prisma + PostgreSQL** |
| Frontend | **Vite + React + TypeScript**, separate from the API. Client-rendered today; **React Router framework mode (SSR on Workers) is a recorded switch**, not a rewrite — see `docs/adr/ADR-011` |
| Sharetribe | **Design/UX reference only.** We read the Sharetribe Web Template for flow design, search UX, Stripe + Google Maps integration patterns. We do **not** run their backend and do **not** fork their app. |
| Repo | pnpm monorepo, single repo, single CI |
| Market | **Spain first.** ES + EN i18n, EUR only |
| Payments | **Stripe Connect Express** — pro onboarding/KYC, platform-held funds, split payouts, Stripe Billing for pro subscriptions |
| Geo | PostgreSQL + **PostGIS**, Google Maps Places/Geocoding on the client |
| Auth | **`better-auth`, self-hosted** against our own Postgres — `app_user` stays the user record, sessions are database rows behind an httpOnly cookie (not access tokens), email+password first with Google as a second method. See `docs/adr/ADR-005` |
| Process | **Strict**: spec → frozen contract → **TDD** → implementation → review, one owning agent per vertical slice |
| Traceability | Every branch carries its spec **and** its agent run record; every human intervention is logged |
| Code host | **GitHub** + **GitHub Actions** for CI (Codeberg was considered; its CI needs a self-hosted runner or a different Woodpecker syntax — not worth the friction at MVP) |
| Hosting | **Neon** (Postgres, branch-per-PR) · **Fly.io** (API) · **Cloudflare Pages** (web) · **R2** (objects) — see `docs/adr/ADR-006` |
| Feature flags | **Flagsmith** free tier behind the **OpenFeature** SDK — see `docs/adr/ADR-007` |
| Design system | **`packages/ui`** on **React Aria Components** + CSS Modules over three token layers; **Storybook** as a deployed workbench whose stories *are* the accessibility test suite — see `docs/adr/ADR-012` |
| Board | **GitHub Projects** (issues + kanban), one issue per task ID from §6, automated from PR state |

### Working assumptions (correct me if wrong)
- Funds are captured at booking/acceptance and **paid out after job completion** (manual capture / delayed payout via Stripe Connect). Legal review needed before launch — see §10.
- Licence verification is **manual review by a human/agent operator** in the MVP, not an automated registry API.
- No native mobile app in MVP; the web app is mobile-first PWA-ish.
- No in-platform chat in MVP beyond message threads attached to a job (no realtime presence).

### Explicitly out of MVP scope
Native apps · realtime chat/presence · multi-country · multi-currency · insurance products ·
financing/instalments · pro-to-pro subcontracting · advanced ranking/ML matching ·
public API for third parties.

---

## 2. Target architecture

```
marketplace/
├─ agents/                 # ⚠️ system-wide agent prompts & charters — see §11
│  ├─ AGENTS.md            # rules every agent loads before doing anything
│  ├─ roles/               # one charter per slice agent
│  ├─ prompts/             # reusable task / review / spec templates
│  └─ policies/            # contract-change, escalation, human-approval boundaries
├─ apps/
│  ├─ api/                 # Fastify, modular by domain slice
│  │  ├─ src/modules/{auth,users,professionals,certifications,
│  │  │                listings,search,jobs,quotes,auctions,
│  │  │                emergency,bookings,payments,subscriptions,
│  │  │                reviews,notifications,admin}
│  │  ├─ src/plugins/      # db, auth, stripe, storage, logging, rate-limit
│  │  └─ prisma/
│  └─ web/                 # Vite + React + TS
│     ├─ src/features/<same slice names>
│     ├─ src/shared/       # hooks, api client (generated) — components live in packages/ui
│     └─ src/routes/       # route modules: loader + component, DOM-free at import (ADR-011)
├─ packages/
│  ├─ contracts/           # ⚠️ THE FROZEN SEAM: zod schemas + OpenAPI + generated client
│  ├─ ui/                  # design-system primitives, patterns, tokens + the
│  │                       # Storybook workbench — deployed, stories are tests (ADR-012)
│  ├─ config/              # eslint, tsconfig, prettier, vitest presets
│  └─ testing/             # fixtures, factories, Stripe/Maps mocks, seed data
├─ memory/                 # what agents know across sessions — see §5.8
│  ├─ LONG_TERM.md         # index, loaded by every agent
│  ├─ repo/                # durable repo-wide facts (decisions, conventions, gotchas, glossary)
│  ├─ slices/<agent>.md    # durable per-agent knowledge
│  └─ sessions/            # per-session working memory + handoffs
├─ docs/
│  ├─ adr/                 # architecture decision records
│  ├─ specs/               # one spec + one run record per feature (travels with the branch)
│  └─ interventions/       # append-only human intervention ledger — see §5.6
└─ .github/
   ├─ workflows/
   └─ pull_request_template.md
```

**Rules of the architecture**
1. `packages/contracts` is the only thing both apps import. All request/response shapes are zod
   schemas there; OpenAPI and the typed fetch client are **generated**, never hand-written.
2. A slice owns its Prisma models, its routes, its service, its tests, and its frontend feature
   folder. Cross-slice access goes through service interfaces, never direct table reads.
3. No business logic in route handlers, no Prisma calls in React.
4. Money is `integer` cents + currency code. Never floats. Never `number` for amounts in the DB.

### Environments
| Env | App | Data | Stripe | Deploy trigger |
|---|---|---|---|---|
| local | docker-compose | Postgres+PostGIS container, or a personal Neon branch | test keys | — |
| preview (`feat/XXX`) | Fly app per PR (scale-to-zero) + CF Pages preview | **Neon branch off sanitised staging**, destroyed on PR close | test keys | PR open/update |
| staging | Fly, always-on | Neon `staging` branch, seeded, resettable | test keys | merge to `main` |
| production | Fly, ≥2 machines | **separate Neon project**, own keys | live keys | **manual** — tag a commit, promote the tested artifact |

Full rationale, costs and the data-protection rules: `docs/adr/ADR-006-hosting-and-environments.md`.

---

## 3. Domain model sketch

Frozen early so agents don't each invent a schema. Changes require an ADR.

- **User** — id, email, phone, passwordHash, role(s) `CLIENT | MANITAS | PRO | ADMIN`, locale, status
- **ClientProfile** — name, addresses[], defaultLocation(geo)
- **ProviderProfile** — kind `MANITAS | PRO`, displayName, bio, serviceRadius, baseLocation(geo),
  categories[], hourlyRateCents, responseTimeMins, ratingAvg, ratingCount, stripeAccountId,
  verificationStatus, subscriptionTier, badges[]
- **Certification** — providerId, type (fontanería, electricidad, gas, …), licenceNumber,
  issuingBody, issuedAt, expiresAt, documentKey, status `PENDING | APPROVED | REJECTED`, reviewedBy, reviewNote
- **PortfolioItem** — providerId, title, description, images[], categoryId, completedAt
- **Category** — slug, name(i18n), requiresLicence(bool), parentId
- **Listing** — providerId, categoryId, title, description, priceModel `HOURLY | FIXED | QUOTE_ONLY`,
  priceCents, area(geo), active
- **Job** — clientId, categoryId, title, description, photos[], location(geo), urgency,
  budgetRangeCents, mode `DIRECT | QUOTE | AUCTION | EMERGENCY`, status, deadlineAt
- **Quote** — jobId, providerId, amountCents, breakdown[], message, validUntil, status
- **Auction** — jobId, closesAt, revealPolicy `SEALED | OPEN`, minBidCents, status
- **Bid** — auctionId, providerId, amountCents, message, createdAt, status
- **EmergencyRequest** — jobId, broadcastRadius, broadcastAt, acceptedProviderId, acceptedAt, expiresAt
- **Booking** — jobId, providerId, agreedAmountCents, scheduledAt, status
  `PENDING_PAYMENT | CONFIRMED | IN_PROGRESS | COMPLETED | CANCELLED | DISPUTED`
- **Payment** — bookingId, stripePaymentIntentId, amountCents, platformFeeCents, state, capturedAt, releasedAt, refundedCents
- **Payout** — providerId, stripeTransferId, amountCents, status
- **Subscription** — providerId, tier `FREE | PLUS | PREMIUM`, stripeSubscriptionId, currentPeriodEnd, status
- **Badge** — code (`VERIFIED_LICENCE`, `TOP_RATED`, `FAST_RESPONDER`, `PREMIUM`), grantedAt, expiresAt, source `AUTOMATIC | MANUAL`
- **Review** — bookingId, authorId, subjectId, rating, text, publishedAt
- **MessageThread / Message** — scoped to a job or booking
- **AuditLog** — actor, action, entity, before/after, at

**State machines to specify before coding** (each gets a diagram in its spec):
Job, Booking, Payment, Auction, EmergencyRequest, Certification.

---

## 4. Slice ownership map

One agent owns each slice end-to-end (API + DB + frontend feature + tests). Nobody else edits
files inside another slice's folders; cross-slice needs go through a contract change request.

| Slice | Owner agent | Owns |
|---|---|---|
| S0 Platform | `agent-devops` | monorepo, CI/CD, envs, observability, `packages/config` |
| S1 Contracts | `agent-contracts` | `packages/contracts`, OpenAPI, codegen, ADRs |
| S2 Identity | `agent-identity` | auth, sessions, roles, client profiles |
| S3 Providers | `agent-providers` | provider profiles, portfolio, categories, availability |
| S4 Trust | `agent-trust` | certifications, verification queue, badges, reviews |
| S5 Discovery | `agent-discovery` | listings, geo search, filters, map UI |
| S6 Jobs | `agent-jobs` | jobs, quotes/presupuestos, messaging |
| S7 Auctions | `agent-auctions` | auctions, bids, close/award logic |
| S8 Emergency | `agent-emergency` | broadcast, accept-race, notifications |
| S9 Money | `agent-money` | Stripe Connect, bookings, payments, payouts, refunds, subscriptions, invoicing |
| S10 Design system | `agent-ui` | `packages/ui`, tokens, i18n, a11y |
| S11 Quality | `agent-qa` | e2e suite, seed data, contract-test harness, flake watch |
| S12 Admin/Ops | `agent-admin` | back-office: verification review, disputes, refunds, moderation |
| S13 Agent autonomy | `agent-devops` | `services/orchestrator`, worker images, model routing, egress gates |

Shared files (`prisma/schema.prisma`, `packages/contracts`, CI config) are **append-only by request**:
a slice agent opens a change proposal, `agent-contracts` applies it. This is the main collision risk.

---

## 5. Agent operating model

### 5.1 The pipeline (every task follows it)

1. **Spec** — the owning agent writes `docs/specs/<slice>/<TASK-ID>-<slug>.md` **on the feature
   branch**.
   Must contain: user stories, state machine, API surface, error cases, permissions matrix,
   acceptance criteria (Given/When/Then), out-of-scope. Reviewed by `agent-contracts`.
2. **Contract freeze** — zod schemas + Prisma models merged into `packages/contracts` /
   `schema.prisma` **before** implementation. Once merged, the shape only changes via ADR.
3. **TDD — red first.** Load the `test-driven-development` skill. Write the tests for the
   acceptance criteria and **observe them fail**. The failing run is pasted into the run record
   (§5.2). No implementation code exists at this point.
4. **Green** — the minimum implementation that passes. API then frontend, owner's folders only.
5. **Refactor** — with tests green, clean up. Tests must stay green and unchanged.
6. **Self-review** — the owning agent runs the full gate locally.
7. **Cross-review** — a different agent reviews code *and* spec *and* prompts (see §5.4).
8. **Merge** — squash, conventional commit, task ID in the subject.

### 5.2 Branch = spec + run record

Every feature branch is self-describing. Branch name is `<TASK-ID>-<slug>`, e.g.
`W4-T03-quote-submission`, and the branch **must** contain both of:

| File | Purpose |
|---|---|
| `docs/specs/<slice>/<TASK-ID>-<slug>.md` | The spec. What we agreed to build. |
| `docs/specs/<slice>/<TASK-ID>-<slug>.run.md` | The **agent run record**. How it got built. |

The run record makes prompt quality reviewable in the diff, which is the point:

```markdown
# Run record — W4-T03 quote submission
Agent:        agent-jobs
Model:        <model id>
Skills used:  test-driven-development, api-and-interface-design
Started:      2026-09-08T09:12Z

## Prompts
### 1. Spec authoring
<verbatim prompt>
### 2. Implementation
<verbatim prompt>
### 3. Corrections (iteration 2 — why a re-prompt was needed)
<verbatim prompt + what was wrong with the first output>

## Red phase
<paste of the failing test run, before implementation>

## Deviations from spec
- none / <what changed and why, with the ADR link if the contract moved>

## Self-assessment
- Weakest part of this change:
- What a reviewer should look at hardest:
```

**CI gate `spec-present`**: a PR whose branch name carries a task ID fails unless it
adds or modifies both files for that ID. No spec, no merge.

### 5.3 Definition of Done
- [ ] Spec on the branch, acceptance criteria all covered by a test
- [ ] Run record on the branch, including the **failing-test paste** from the red phase
- [ ] Contract in `packages/contracts`, client regenerated, no hand-written types
- [ ] Unit + contract tests pass; e2e added for any user-visible flow
- [ ] No `any`, no `@ts-expect-error` without a linked issue
- [ ] Permissions asserted in tests (not just happy path — test the 403)
- [ ] Errors use the shared error envelope + machine-readable code
- [ ] i18n keys added for ES and EN, no hardcoded strings
- [ ] Structured logs + metric for anything money- or state-machine-related
- [ ] Migration is reversible and tested against seeded staging data
- [ ] **Seed data exists for anything this feature adds to a funnel**, registered in
      `apps/api/prisma/seed/registry.ts` and named in both deploy workflows' `--only` list, so a
      preview can actually exercise it (`W0-T30` §3.6 — operator, 2026-09-19: *"when developing the
      auction, i need to add test data to actually check the feature"*)
- [ ] Preview env deployed and manually smoke-tested
- [ ] Session memory closed with a `## Handoff`; durable learnings promoted (§5.8)
- [ ] Any human intervention on this branch has a ledger entry (§5.6)

### 5.4 Review rules — three axes, not one

| Axis | Question | Reviewer |
|---|---|---|
| **Code** | Is it correct, safe, and inside the owner's boundaries? | peer slice agent |
| **Spec** | Does the spec actually describe the product need, and does the code satisfy *it*? | `agent-contracts` |
| **Prompt** | Did the prompt produce this in a reproducible way, or did it take 6 corrective rounds? | reviewing agent, reading `.run.md` |

- Money, auth and state machines get a **second** reviewer (`agent-money` or `agent-qa`).
- A run record showing many corrective iterations is a signal to fix the *prompt template* in
  `agents/prompts/`, not just the code. File that as a follow-up task.
- Reviewers never rewrite — they file a finding and hand back.

### 5.5 CI gates (all block merge)
`spec-present` · `typecheck` · `lint` · `prisma migrate diff` (no drift) · `unit` · `contract`
(OpenAPI ⇄ impl) · `e2e smoke` · `build both apps` · `secret scan` · `dependency audit (high+)` ·
`intervention-logged` (see below) · `agents-drift` (`.claude/agents/` matches `agents/roles/`)
These are failure classes, not job names: since `W0-T29` the four agent-process gates —
`spec-present`, `intervention-logged`, `author-identity`, `agents-drift` — run as the single
`gates` job, which annotates whichever of them failed (`pnpm gates` runs them locally).
Nightly on staging: full e2e suite, seed reset, Stripe webhook replay.

### 5.6 Human intervention ledger — *nothing manual goes unrecorded*

If a human **corrects the agent** — rejects, overrides, hand-edits, or redirects work already done —
it gets written down. This is the dataset that tells us which agents and which prompts are weak.
A re-prompt that redirects work already done is an intervention; one that answers a question the
agent asked is not (`W11-T19`, `docs/adr/ADR-010`).

**Location**: `docs/interventions/`, append-only, one file per intervention:
`YYYY-MM-DD-<TASK-ID>-<n>.md`

```markdown
---
task:      W5-T04
pr:        #142
agent:     agent-money
verdict:   REJECTED | REWORKED | OVERRIDDEN | MANUAL_FIX | SCOPE_CHANGE
intervened_by: <human>
at:        2026-09-14T16:40Z
---
## What the agent proposed
## What was wrong
## Root cause
spec-gap | prompt-gap | missing-test | missing-gate | model-error | context-missing |
requirement-changed
## What was done instead
## Corrective action
- [ ] spec updated
- [ ] prompt template updated in `agents/prompts/...`
- [ ] new CI gate / test added
- [ ] agent charter updated in `agents/roles/...`
```

**Enforcement**
- PR labels: `intervention:rejected`, `intervention:reworked`, `intervention:manual-fix`,
  `intervention:override`, `intervention:scope-change`.
- CI gate `intervention-logged`: if a PR carries any `intervention:*` label, it cannot merge
  without a matching file in `docs/interventions/`.
- The PR template has a mandatory block: *"Did a human change anything on this branch? Y/N →
  if Y, link the ledger entry."*
- A closed-without-merge PR from an agent **also** requires a ledger entry — a rejection is the
  most informative signal we get.
- Only `prompt-gap` and `spec-gap` entries require a corrective action; the rest are counted.
  An entry reconstructed from a transcript after the fact carries `backfilled: true`.

**Rollup**: weekly, `agent-qa` summarises into `docs/interventions/ROLLUP.md` —
interventions per agent, per root cause, per slice. Rising `prompt-gap` counts mean the templates
need work; rising `spec-gap` counts mean specs are being written too thin.

### 5.7 Escalation
Two agents needing the same file, or a contract change after freeze → stop, open an ADR in
`docs/adr/`, `agent-contracts` decides. No silent schema edits, ever.

### 5.8 Memory — agents run in different sessions

Agents work in parallel, in separate sessions, days apart. Knowledge that lives only in a chat
transcript is lost. Full contract: `agents/policies/memory.md`.

| Layer | Path | Lifetime | Writer |
|---|---|---|---|
| Index | `memory/LONG_TERM.md` | forever | anyone — **one-line pointers only** |
| Repo-wide | `memory/repo/{decisions,conventions,gotchas,glossary}.md` | forever, committed | anyone, via PR |
| Per-slice | `memory/slices/<agent>.md` | forever, committed | **only** the owning agent |
| Session | `memory/sessions/<date>-<agent>-<TASK-ID>.md` | one task, then archived | that session's agent |

**Every task starts** by reading long-term memory + the agent's slice file + *any open session file
for that task ID* — an interrupted session hands off through that file rather than being redone.
**Every task ends** by closing the session file with a `## Handoff` block and **promoting** anything
that outlives the task into `repo/` or `slices/`.

Entries are one fact each — `fact` / `why` / `apply` / `evidence` / `status` — never a diary, never
a copy of what the code or an ADR already says. Superseded entries are marked, not deleted, so the
reasoning trail survives. Memory is committed: **no secrets, no personal data, ever**.

Promotion happens in the same PR as the work. A separate "memory PR" never gets written.

---

## 6. Workstreams & backlog

Task IDs are stable — use them as board card titles.

> ### ▶ NEXT — `W4-T02`: the rest of the job state machine
>
> **`W4-T01` shipped on 2026-09-20.** A job exists: `Job` + `JobCategory`, `0010_job_posting`, the
> contract, and `DRAFT → OPEN` through the shared `transition()` seam. A draft asks for nothing; a
> publish asks for one category and nothing else (`MEM-2026-09-20-4`).
>
> **`W4-T02` has two jobs that are not optional**, both left deliberately by `W4-T01` and both
> load-bearing:
>
> 1. **Remove `OPEN` from `jobMachine.terminal`** in the same change that gives it an exit.
>    `defineMachine` rejects a dead end that is not declared terminal, so the list is honest today —
>    and becomes a lie the moment `AWARDED` exists.
> 2. **Move "only a draft may be edited" out of `repository.update`.** It is a hand-written `if`
>    that nothing ties to the machine's states. With four more states it keeps refusing correctly
>    *by accident* rather than by design, and no test would notice.
>
> Then `W4-T03` (quotes), which inherits the question `W4-T01` §2.4 deliberately did not answer:
> **a three-trade job — one quote covering everything, or three covering parts?** The data model
> does not prejudge it, and choosing wrong there is expensive.
>
> **Not blocking anything:** `W0-T32` (rotating a seeded credential) is deferred by the operator,
> 2026-09-20 — rotation is a 30-to-60-day cadence, so a manual procedure is survivable. It is not
> open-ended: the first rotation of the secrets set on 2026-09-20 falls due between **2026-10-20 and
> 2026-11-19**, and until `W0-T32` lands that rotation means deleting a `_seed_run` row by hand or
> re-branching the database. `W9` and `W3-T11` stay behind the funnels (`MEM-2026-09-20-3`).
>
> **`W13` remains filed and unstarted** — the DM / contact-gating epic, ADR first, its own session.
> `W4-T08` is `[SUPERSEDED-PENDING]`: do not build contact masking as written.
>
> ### Also ready — the storefront half, now that every endpoint it needs is real
>
> **A provider can describe themselves, and there is finally something to say.** `W3-T02` shipped
> the write path; `W3-T01` shipped the vocabulary — two family roots and twenty trades, served by
> `GET /api/categories`, with `BD-07` answered in the `requires_licence` column (five gated trades).
>
> **MSW is gone.** `GET /categories` was the last endpoint the storefront did not have, so the
> handler, the worker, the `stripMocks` plugin and `VITE_ENABLE_MOCKS` went with it — four workflows
> included. `apps/web/mocks/` no longer exists; its world lives in `apps/web/tests/fixtures/`, where
> the component harness still stubs `ApiClient` from it.
>
> **Two things are deliberately left open.** The nightly and the visual baselines now shoot a
> `vite preview` with no API behind it, so the category grid and facet rail render their empty
> states — a real shape a visitor reaches, but **the committed baselines are stale and
> `visual-baselines.yml` must be re-run**. And **preview and staging serve `{items: []}`**: no
> deploy runs `db:seed`, and `assertSafeTarget` refuses the whole run while `auth.demo-users` is
> `localOnly`, so no seeder can reach a deployed database at all. Operator, 2026-09-18: *"For now,
> empty categories. Seed will come with /categories api."* Tracked as `W0-T30` below.
>
> **Then `W3-T03` (portfolio) or `W3-T09` (availability)**, or the storefront work these unblock:
> nothing in `apps/web` yet calls `PUT /api/providers/me`, and the category list it now receives is
> real data rather than a fixture.
>
> **Then `W3-T03` (portfolio) or `W3-T09` (availability)**, both unblocked and neither urgent, or
> the storefront half — nothing in `apps/web` can yet call either new endpoint, and the editor page
> is `W12`'s to build (ADR-011). `W2-T05`'s pro signup fork is the other way in: it owns the role
> grant and the kind-specific fields, and `W3-T02` deliberately left both alone.
>
> **Two decisions still open, neither blocking:**
> `author-identity` survived `W0-T29`'s collapse and the steer said it was not very useful — spec
> §6 Q1, one line to retire. And `OPS-03` is yours whenever you want it: the seven required check
> names are in `docs/specs/S0/W0-T29-gate-consolidation.md` §4, and `perf` must never be among them.
>
> **For `agent-contracts`:** §3's domain model sketch still lists `role(s) CLIENT | MANITAS | PRO |
> ADMIN`, which no migration implemented — `UserRole` is `CLIENT | PROVIDER | ADMIN` and the type is
> `ProviderProfile.kind` (`W2-T03` §3.5.2). The other two from `W3-T07` are **done**: the column is
> `NOT NULL`, and the *"usually a home address"* justification is corrected in both files.
>
> **A human blocker worth knowing about:** `OPS-14` (an email provider). `W2-T10` made sign-up
> usable without it — `AUTH_TRUST_EMAIL_ON_SIGNUP` marks the user verified at creation, locally and
> in preview/staging only — so this now blocks *shipping* identity rather than developing it.

**Execution labels**

| Label | Meaning |
|---|---|
| `[H]` | **Human only.** Credentials, billing, legal, account ownership. An agent must never attempt these — it can only write the runbook and tell you what it needs. |
| `[M]` | **Mixed.** Agent does the work; a human supplies a secret, clicks a dashboard, or makes a product/policy judgement. The task is blocked until the human half lands. |
| `[A]` | **Agent only.** No human hands on the keyboard — but still requires PR approval and passes all gates. |
| `[B]` | **Blocked on a business decision.** Additive to the other labels. The mechanism can be built and tested with the number/policy in config; it must not ship with a value an agent invented. Every `[B]` maps to a `BD-xx` in §10.1. |

### OPS — manual service setup (human only, tracked on the board)

**Early deployment is the priority**, and these are the real day-one critical path: every W0 task
stalls until the accounts exist. Each is a board ticket with a *proof of done*, so the setup work is
visible rather than assumed. All are `[H]` — an agent must never attempt them.

| ID | Operation | Proof of done | Unblocks |
|---|---|---|---|
| ~~`OPS-01`~~ ✅ | **Personal** GitHub account authenticated on this machine (`gh auth login`, personal SSH key or PAT). Never the work account — see `docs/board/IDENTITY.md` | `gh api user --jq .login` returns the personal login | everything |
| ~~`OPS-02`~~ ✅ | Create the GitHub repo under the personal account; push `main` | remote set, `main` pushed | everything |
| `OPS-03` | Branch protection on `main`: required checks, ≥1 approval, no direct push | settings screenshot / API check | `W0-T13` |
| `OPS-04` | GitHub Environments `preview` / `staging` / `production` + secrets | environments exist, empty secrets declared | `W0-T07`, `W0-T09` |
| `OPS-05` | GitHub Project **board** created (needs `gh auth refresh -s project`); ✅ 135 issues imported (`node --experimental-strip-types scripts/seed-board.ts --repo <owner>/<name>`) | board populated | `W0-T19` |
| `OPS-06` | GitHub PAT for the MCP server + local MCP connection | `claude mcp list` shows github connected | ticket automation |
| `OPS-07` | **Neon**: staging project + **separate** production project, PostGIS enabled, API key | connection strings in GitHub Environments | `W0-T16` |
| `OPS-08` | **Fly.io** account + org + API token | `fly apps list` works from CI | `W0-T07` |
| `OPS-09` | **Cloudflare**: Pages project + R2 bucket (private) + API token | preview URL resolves | `W0-T07`, `W3-T03` |
| `OPS-10` | **Flagsmith**: project + `preview`/`staging`/`production` environments + SDK keys | keys in GitHub Environments | `W0-T17` |
| `OPS-11` | **Sentry** project + DSN | first test event received | `W0-T08` |
| `OPS-12` | **Google Cloud** project + Maps API key + billing + quota alerts | key restricted by referrer/IP | `W3-T06` |
| `OPS-13` | **Stripe** account (test mode) + Connect Express settings + webhook endpoint | test PaymentIntent succeeds | `W5-T01`, `W5-T03` |
| `OPS-14` | Email provider (Resend/Brevo) + verified sender domain | test email delivered | `W2-T01` (to **ship** it — MailHog builds and tests it, `ADR-005`) |
| `OPS-15` | SMS provider (Twilio) + Spanish sender | test SMS delivered | `W2-T06`, `W7-T04` |
| `OPS-16` | Domain + DNS pointed at Cloudflare | staging hostname resolves | `W0-T07` |
| `OPS-17` | Per-environment encryption data keys generated and stored in Fly secrets | keys present, never in repo | `W0-T18` |
| `OPS-18` | **Stripe live** account + KYC + bank details — *only before M9* | live keys in `production` env | launch |
| `OPS-19` | **GitHub App** for the agent system: installed on this repo only, Issues/PRs/contents write, webhook secret. Commits stay authored `mastrobardo@gmail.com` — push auth and commit authorship are deliberately different identities | app installed, webhook delivering | `W11-T01`, `W11-T10` |
| `OPS-20` | **Neon** project `marketplace-agents` for graph state — a separate project, never a branch of the product database | connection string in the agent environment | `W11-T01` |
| `OPS-21` | **Fly** org token scoped to the agent worker app + the always-on orchestrator app | `fly machine run` works from the orchestrator | `W11-T02` |
| `OPS-22` | **Inference provider** for the open-weight coder: account, **stated no-retention terms**, prompt-caching support confirmed — *phase B only, not before* | terms recorded on the ticket | `W11-T12` |

**The walking skeleton needs four services and nothing else**: Fly.io, Neon, Cloudflare, Sentry.

| Needed for M0 | Deferred until the feature needs it |
|---|---|
| `OPS-01`–`OPS-05` (GitHub, board), `OPS-07` (Neon), `OPS-08` (Fly), `OPS-09` (Cloudflare), `OPS-11` (Sentry) | `OPS-06` MCP · `OPS-10` Flagsmith → `W0-T17` · `OPS-12` Maps → `W3-T06` · `OPS-13` Stripe → `W5-T01` · `OPS-14` email → `W2-T01` · `OPS-15` SMS → `W2-T06` · `OPS-16` domain → before the first outside demo · `OPS-17` encryption keys → `W0-T18` · `OPS-18` Stripe live → M9 |

Every deferred account still has a ticket so nobody assumes it happened — it is just not on the
critical path. Local development covers the gaps in the meantime (MailHog for email, docker Postgres
for data), so no feature is blocked waiting for an account that is not needed yet.

### W0 — Platform foundation (`agent-devops`) — *blocks everything*
- `W0-T01` `[A]` pnpm monorepo skeleton, workspaces, tsconfig base, eslint/prettier presets
- `W0-T02` `[A]` docker-compose: Postgres + PostGIS + MailHog + MinIO (S3-compatible)
- `W0-T03` `[A]` Fastify app skeleton: health, config loading, error envelope, request-id, pino logging
- `W0-T04` `[A]` Vite React skeleton: router, layout shell, i18n (ES/EN), theme tokens
- `W0-T05` `[A]` Prisma init + first migration + seed script scaffold
- `W0-T06` `[A]` CI on **GitHub Actions**: typecheck/lint/test/build matrix on PR
- `W0-T07` `[M]` CD: Fly app + CF Pages preview per PR, staging on merge to `main`, **manual tagged release to prod** *(human: Fly/Cloudflare accounts, CI secrets)* — lands inert; activation is `W0-T24`
- `W0-T08` `[M]` Error tracking (Sentry), uptime check, structured log sink *(human: accounts + DSN)*
- `W0-T09` `[H]` Secret management: GitHub Environments + Fly secrets, populated per environment; agents only maintain `.env.example`
- `W0-T10` `[A]` `CONTRIBUTING-agents.md`: the pipeline in §5 as an enforceable checklist
- `W0-T11` `[A]` **`agents/` folder scaffold** (§11): `AGENTS.md`, role charters, prompt templates, policies
- `W0-T12` `[A]` CI gates `spec-present` + `intervention-logged`, PR template, `intervention:*` labels
- `W0-T13` `[M]` Branch protection: required checks, required approvals, no direct pushes to `main` *(human: GitHub settings)*
- `W0-T14` `[A]` **`memory/` scaffold** (§5.8): index, repo facts, per-slice files, session template
- `W0-T15` `[A]` `agents-drift` CI gate + `scripts/generate-claude-agents.ts` wired into CI
- `W0-T16` `[M]` **Neon**: staging + production projects, PostGIS enabled, `sslmode=verify-full`; CI creates a branch per PR off sanitised staging and **deletes it on PR close** *(human: Neon account + API key)* — ADR-006
- `W0-T17` `[M]` **Feature flags** *(not M0 — lands with the first feature that needs a flag)*: OpenFeature SDK + Flagsmith provider, typed flag registry (default OFF, owner, removal task ID), server-side evaluation + bootstrap payload, static provider in tests *(human: Flagsmith account + per-env SDK keys)* — ADR-007
- `W0-T18` `[M]` **Encryption & keys** *(not M0 — lands with the first sensitive field stored)*: envelope encryption for licence/phone columns, keyed hashes for lookup fields, per-env data keys in Fly secrets, key-rotation runbook *(human: generate and store the keys)* — ADR-006
- `W0-T19` `[M]` **Board**: GitHub Projects with one issue per task ID from §6, labels for slice + `[H]`/`[M]`/`[A]`, columns Backlog → Spec → Contract → Red → Green → Review → Done *(human: create the project)*
- `W0-T20` `[A]` Sanitisation step in the seed pipeline so no PII or licence document can reach a preview env
- `W0-T21` `[A]` CI gate `author-identity`: every commit author/committer is `mastrobardo@gmail.com` (see `docs/board/IDENTITY.md`)
- `W0-T22` `[A]` ✅ `scripts/seed-board.ts`: creates labels, milestones and one issue per OPS/W/BD id (135 issues; run with `--repo <owner>/<name>`)
- `W0-T23` `[A]` Stop parallel agents colliding on shared append-only files — namespaced i18n catalogues, one-record-per-file memory, README fragments *(issue #153)*
- `W0-T24` `[H]` **Activate and verify the deploy pipeline**: set the `preview`/`staging`/`production` secrets, then prove one preview deploy, one teardown, one staging deploy and one tagged production release actually run. `W0-T07` lands the pipeline **inert** — no deploy job can execute on its own PR, and `release-production.yml` is not even *triggered* until a tag exists *(issue #156; needs `OPS-04`, `OPS-07`, `OPS-08`, `OPS-09`, `W0-T09`)*
- `W0-T25` `[A]` Name every per-branch resource after the **task ID**, not the PR number — `marketplace-api-w1t02`, `preview/w1t02`, `w1t02.<project>.pages.dev`, derived from the branch name that `AGENTS.md` L2 already guarantees. Teardown must derive the same name, and two open PRs on one task share one environment *(issue #166; needs `W0-T24`)*
- `W0-T26` `[A]` **Make the `database` job discover its own live suites.** It names them file by file, so a new test file is skipped and the run still reports green — a gate that fails open. Tolerable while a human reads every diff; **load-bearing the moment an agent treats "CI green" as its success signal**, so this blocks `M10` *(prerequisite for `W11-T06`)*
- `W0-T27` `[A]` **Mirror the stack's third-party images into GHCR.** `minio/minio` and `minio/mc` were deleted from Docker Hub — the repositories, not the tags — and `stack:up` failed on every PR and on `main` until they were repointed at `quay.io` (#237). GHCR needs no external account, so this is `[A]`: the built-in `GITHUB_TOKEN` pushes to a package this repo owns. Both `linux/amd64` (CI) and `linux/arm64` (every laptop) must survive the copy. Not urgent — #237 pins by **digest**, so a re-pointed tag now fails loudly — and load-bearing at the same moment `W0-T26` is: an agent treating "CI green" as its success signal cannot diagnose a build that will not start because someone else deleted a tag *(issue #238)*

- `W0-T28` `[A]` ✅ **Route `/api/*` from Cloudflare to the Fly app so the browser sees one origin.** A Pages advanced-mode `_worker.js`, emitted by the web build with the API origin baked in — `wrangler pages deploy` cannot hand a variable to the deployment it creates, and a project-level one is a single value shared by every preview. `BETTER_AUTH_URL` becomes the **web** URL, which is two things at once: better-auth builds the emailed links from it *and* derives `trustedOrigins` from it, so pointed at Fly it produced both failures the operator hit on #247 — no `Access-Control-Allow-Origin` for the Pages host, and a `SameSite=Lax` cookie that would never have been sent anyway. The deploy is reordered for it (web, then the API's secrets, then the API) because the Pages URL is read back from wrangler and never constructed. **Three things found by running it:** `/api/health` is a 404 — the API serves `/health` at its root, so the deploy's new smoke check probes `/api/auth/get-session`, which proves the whole seam in one request; the storefront was calling `categories`/`search`/`providers/:id` at the **root**, which one origin would have answered with the SPA's own `index.html`, so every path now carries the `api/` prefix and **`W3-T01`/`W3-T05`/`W3-T07` must mount their routes under `/api`**; and `release-production.yml` deploys no web app at all, so production has no second origin to unify until `OPS-16`. Driven end to end through a real `wrangler pages dev` worker, including the cookie-carrying `POST` that answers `403 INVALID_ORIGIN` when the origins differ *(spec: `docs/specs/S0/W0-T28-one-origin.md`)*
- `W0-T29` `[A]` ✅ **Four gate jobs became one, and the check names `OPS-03` will use are now chosen rather than inherited.** `spec-present`, `intervention-logged`, `author-identity` and `agents-drift` were the same `scripts/gates/run.ts` with a different argument, and each spent ~30s on `checkout` + `setup-node` + `pnpm install --frozen-lockfile` to run ~2s of gate — then billed a whole minute, because GitHub rounds every job up. Measured across the first 273 runs (2026-09-09..17): **1,993 billed minutes against 1,328 of compute**, of which 345 — 17% of every minute this repo has ever billed — was those four. Now one `gates` job: 11 jobs per run become 8, ten `pnpm install` become seven, and ten required check names become **seven** (`typecheck` · `lint` · `unit` · `build` · `database` · `workflows` · `gates`, with `perf` never required). **What four job names bought was legibility**, and one job buys it back two ways: a `::error title=gate: <name>::` annotation puts the failure on the Checks tab without a log, and every verdict goes into the run summary as a table. It also gains something the four jobs never had — `--all` judges every gate in one process, so a branch that breaks two learns both in one round trip. Run them locally with **`pnpm gates`**. One behaviour changed: `author-identity` no longer judges the committer trailer of a commit **GitHub** committed (`noreply@github.com` — a squash merge, "Update branch", a web-UI edit), which is the only time it has ever fired and the one case its own remedy cannot fix (`MEM-2026-09-17-16`); the author is still judged. The operator's steer said that gate is "not very useful" and the ticket left its survival open — it survives because `ADR-008` and `IDENTITY.md` both name it as the enforcement that cannot be bypassed, and because after the collapse it costs one `git log` in a job that already has the history. **Retiring it is a one-line change** if you still want it gone: spec §6 Q1 *(spec: `docs/specs/S0/W0-T29-gate-consolidation.md`)*

### W1 — Contracts & domain foundation (`agent-contracts`)
- `W1-T01` `[A]` ✅ Error envelope + error-code registry — frozen in `packages/contracts` as a zod schema, `details` typed per code, explicit HTTP status→code table *(issue #55)*
- `W1-T02` `[A]` ✅ Pagination, sorting, filtering conventions — cursor (keyset) paging only, a per-endpoint sortable allow-list with `id` appended as the tiebreaker, flat typed filters, and `{ items, page: { nextCursor, hasMore } }` with no `total`; the lexicographic keyset predicate lives in the seam as provider-neutral data *(issue #56)*
- `W1-T03` `[A]` zod → OpenAPI generation + typed client codegen
- `W1-T04` `[A]` Contract-test harness (spin API, assert every route matches OpenAPI)
- `W1-T05` `[A]` ✅ Core Prisma schema — `app_user` (the table is not `user`: Postgres resolves the bare keyword to `current_user` and returns a row instead of failing), both profiles, `address` as the **only** table with geography, `category` + `provider_category`; one generated `geography(Point,4326)` column and one GIST index serve every proximity query *(issue #59)*
- `W1-T06` `[A]` ✅ Money value object — integer cents in `packages/contracts`, `prorate` and `allocate` the only two rounding sites, bounded at `Int32` because that is what Prisma `Int` is *(issue #60)*
- `W1-T07` `[A]` ✅ State-machine helper (transition table + guard + audit log emit) — `packages/contracts/src/state-machine.ts` *(spec: `docs/specs/S1/W1-T07-state-machine.md`)*
- `W1-T08` `[M]` ADR template + first 5 ADRs (stack, contracts seam, money, geo, auth) — **the auth one is written and signed off** (`ADR-005`, 2026-09-11), because it was what `W2` was blocked on; the other four are still outstanding and their decisions currently live only in §1 and in the code *(human: sign off on the money ADR when it is written)*
- `W1-T09` `[A]` ✅ Shared test factories + fixtures in `packages/testing` (TDD prerequisite for every slice) *(spec: `docs/specs/S1/W1-T09-test-factories.md`)*

### W2 — Identity & access (`agent-identity`)
- `W2-T01` `[A]` ✅ Signup/login (email+password), email verification, password reset — **mount `better-auth` on Fastify and map it onto `app_user`** (`ADR-005`): `modelName`, `generateId: false`, `roles`/`status`/`locale`/`deletedAt` as `additionalFields`. **Drops `app_user.passwordHash`** — credentials are `account` rows, which is also how Google arrives later without a migration — and **adds `name` and `email_verified`**, the latter because `emailVerified` is a boolean and `emailVerifiedAt` is a timestamp and field mapping renames columns without converting types. Soft-deleted users must not be able to authenticate: better-auth has no `deletedAt`, so that guard is ours and needs a test *(needs `OPS-14` to ship, not to build — Mailpit covers verification and reset locally)*. **Shipped with three corrections to `ADR-005`, all in the run record**: rule 1's `modelName: "app_user"` is a layer too low — the Prisma adapter speaks Prisma, so it is `modelName: 'user'` and `@@map` does the table mapping; the `session`/`account`/`verification` migration **moved here from `W2-T02`**, because credentials *are* `account` rows and a login *is* a `session` row and no subset of this ticket runs without them; and `W1-T05`'s functional `lower(email)` index is replaced by a plain `UNIQUE` plus `CHECK (email = lower(email))` — better-auth issues the equality predicate the old migration's own comment warned about, so every sign-in was a sequential scan. Operator decisions (2026-09-12): `SUSPENDED` cannot sign in, and verification is required before sign-in. A soft-deleted or suspended user is refused **byte-identically to a wrong password** — a distinct answer is an enumeration oracle. *(spec: `docs/specs/S2/W2-T01-auth-signup-login.md`)*
- `W2-T02` `[A]` Sessions — **the migration landed in `W2-T01`** (§4.1: a login *is* a `session` row, so the tables could not wait); what is left here is session *policy*: **database rows, not access tokens** — one opaque session token in an httpOnly/`Secure`/`SameSite=Lax` cookie, looked up per request; the `session`/`account`/`verification` migration; sliding expiry as rotation; revoke as a delete. **`ADR-005` rule 3 rewrote this line**: the old one said *"httpOnly refresh cookie + short-lived access token, rotation, revoke"*, and a short-lived access token makes revoke eventually-consistent — a suspended provider (`UserStatus.SUSPENDED`) and support impersonation (`BD-11`) both need it to mean *now*. Cookie caching stays **off** for the same reason. Session lifetime is an open choice, not better-auth's 7-day default (`ADR-005` Q3) *(`W0-T28` is done, so a preview login now works — one origin, and the cookie is first-party)*. **Also inherits a gap `W2-T01` left open and asserted**: the session hook refuses a suspended user a *new* session and does not touch the cookie they already hold, so "suspension means now" is currently half true. `apps/api/tests/auth.test.ts` carries a test written as what happens rather than what should, which flips when revoke-as-a-delete lands. ~~`BETTER_AUTH_URL` points at the API's own origin until this ticket makes one origin real~~ — **wrong, and `W2-T09` measured why**: it is the *web* origin (`.env.example` already sets `http://127.0.0.1:5173`). The emailed verification and reset links resolve against it, so pointing it at the API produces mail that bypasses the app; and `trustedOrigins` defaults to its origin, so every cookie-carrying `POST` from the dev server would answer `403 INVALID_ORIGIN`. What this ticket still owns is making one origin real in *preview* (`W0-T28`)
- `W2-T03` `[A]` ✅ **Roles, permissions and route guards — the first authenticated boundary in `apps/api`.** Two files in `modules/auth/`: `permissions.ts` (the matrix, keyed on `UserRole`) and `guard.ts` (`requireSession` / `requirePermission` over a **`ResolveSession` port**, so every 401/403 is asserted with a stub and no database, and the better-auth adapter is asserted live — the split `W3-T05` laid down, applied to the third boundary). **Three operator rules shaped it (2026-09-18).** *A suspended, blocked or deleted user returns no data — not even `deletedAt`*: liveness is a `where` clause (`status: 'ACTIVE', deletedAt: null`) rather than a field, so account state never becomes a value, `Principal` is `{ userId, roles, sessionId }` and can never gain one, and such a request is `401` byte-identically to one with no cookie — which also makes "suspension means now" true on guarded routes without touching `W2-T02`, and drops the dependency on whether better-auth returns `additionalFields` on its read path. *`ADMIN` has no implicit bypass* — no superuser branch anywhere, and **the role that reads money is deliberately not the one `W9-T04` gives to moderators** (`MEM-2026-09-18-2`): the transactions view arrives with its own role when `W5-T10` gives it something to read, never by widening `ADMIN`. And *`MANITAS`/`PRO` is a kind, a trade is a category, neither is a role* — the matrix is typed `Record<string, readonly UserRole[]>` so a `'MANITAS'` cell fails `typecheck` (**`TODO.md` §3's sketch is wrong on this** and is `agent-contracts`' to correct). **The matrix ships with one row**, `provider-profile:update-own`, because one row has a consumer; the deliverable is the growth rule — a permission enters in the same PR as the route that guards with it. **One thing found by building it:** a route path built with `encodeURIComponent` from an identifier containing `:` is unreachable — find-my-way decodes before matching, and `:` is a parameter — which cost seven red tests against a correct implementation (`MEM-2026-09-18-7`). No product route is guarded: `W3-T02` is the first consumer *(spec: `docs/specs/S2/W2-T03-route-guards.md`)*
- `W2-T04` `[A]` Client profile CRUD, addresses, saved locations
- `W2-T05` `[A]` Provider signup flow (MANITAS vs PRO, different required fields)
- `W2-T06` `[M]` Phone verification (SMS), required for providers *(human: SMS provider account + credentials)*
- `W2-T07` `[A]` Rate limiting, brute-force lockout, audit log on auth events — the first two come from `better-auth`; the audit half stays ours, emitting into `AuditRecord` through `W1-T07`'s helper (`ADR-005`)
- `W2-T08` `[M]` `[B]` GDPR: export my data, delete my account (soft-delete + anonymise) *(human: retention policy decision)*
- `W2-T09` `[A]` ✅ **The account pages** — `/:lang/signup`, `/login`, `/verify-email` and password reset as request + set, plus the entry points that were half the ticket: the header's two doors, a sign-out, and `AuthWall` gaining an optional action so `become-a-pro` leads somewhere. **React Hook Form owns the fields; every submit goes through a React Router `action`, never `useMutation`** — `R3`'s write-side, and what survives `W12-T14`'s SSR switch. **Two decisions settled by the operator (2026-09-14):** `ADR-005` Q1 — signup **always creates a `CLIENT`**, with the pro upgrade left to `W2-T05` (`roles` is `input: false`, so the fork needs API surface nobody has built) — and the form schemas stay **local to `apps/web`** rather than entering the frozen contracts seam. The pages cannot be helpful about who has an account: one success panel for a new signup and a duplicate alike, one message for every sign-in refusal, and `403 EMAIL_NOT_VERIFIED` as the single deliberate exception. **Four things the implementation measured rather than assumed**, all in the run record: `ensureQueryData` returns cached data *through* an invalidation (so the session loader uses `fetchQuery`, and the sign-out bug it caused is why); `BETTER_AUTH_URL` must be the **web** origin, because the emailed links resolve against it *and* `trustedOrigins` defaults to it; a `POST` announcing `application/json` with an empty body is a `400` from our own envelope; and `get-session` answers `200` with a literal `null`. Driven end to end against the local stack and then in a real browser *(spec: `docs/specs/S2/W2-T09-account-pages.md`)*
- `W2-T10` `[A]` ✅ **The account page, and a usable sign-up while there is no mail.** Two things the operator found by using `W2-T09`: a new account cannot be signed into (verification is required and nothing can send mail until `OPS-14`), and the header still offered `Log in`/`Sign up` to somebody already signed in. **`AUTH_TRUST_EMAIL_ON_SIGNUP`** marks a new user verified at creation — off by default, on locally and in preview/staging, warned about at boot outside development, and deleted the day `OPS-14` lands. **Not `requireEmailVerification: false`**, which is the shortcut that looks equivalent: better-auth derives the synthetic duplicate-sign-up response from that option, so turning it off would delete `W2-T01` §4.5's enumeration defence as a side effect — `auth-config.test.ts` now pins it. Sign-up **chains a sign-in**, so the page serves both modes without a flag reaching the browser: usable account → the home page, signed in; `403`/`401` → the inbox panel, unchanged. Signed in, the header is the user's **name, linking to `/:lang/account`**, and sign-out moved there — with identity, and an `AuthWall` where the plan upgrade goes (`BD-16`/`BD-03`; `W5-T07`/`W5-T08` are `[B]`). **Also fixed a runtime import cycle** `api.ts → session.ts → query.ts → api.ts`, latent since `W12-T08` and closed by `W2-T09`: it crashed `signup.tsx` with `seedSession is not a function` while `login.tsx` worked, because a cycle resolves by entry order. `ApiError` now has its own module. **And recovered `W2-T09`'s "login is one API call" commit**, which was pushed two minutes after #247 merged and so never reached `main` *(spec: `docs/specs/S2/W2-T10-account-page.md`)*

### W3 — Providers & discovery (`agent-providers`, `agent-discovery`)
- `W0-T30` `[A]` ✅ **Seed data that reaches a deployed database — and the password that was the real reason it could not.** Two independent refusals, both removed. `assertSafeTarget` judged the **registry**, so one `localOnly` fixture refused every seeder beside it; it now judges the seeders **selected for the run**, and `db:seed --only <id>[,<id>]` is what selects them — in *registry* order whatever order the caller used, because `providers.demo-world` resolves slugs `categories.taxonomy` writes and that ordering belongs in `registry.ts`, not on a command line. An unknown id is `SEED_UNKNOWN_ID`, never an empty run that succeeds. **The `localOnly` flag was answering the wrong question**: `auth.demo-users` was pinned to a laptop not because its rows are fake but because its password is a literal in a public repo — it now resolves one from `SEED_DEMO_PASSWORD` and **refuses** a non-local target without it, so no seeder in the registry is `localOnly` any more and the flag waits for `W0-T20`'s real cases. Preview and staging each seed all three seeders with an explicit id list in the YAML, so **what reaches staging is visible in a diff**; production seeds nothing, because data reaching production is a release decision. Two new secrets (`PREVIEW_`/`STAGING_SEED_DEMO_PASSWORD`) — and until a human sets them the guard *skips* both deploys, which is the designed failure and the reason they are `[H]`. **Answered while here**: fixtures versus an anonymised production dump (`MEM-2026-09-19-2` — they are different instruments; a production edge case comes back as a *regression seeder*), and §5.3 gains the line that makes every future funnel bring its own data. Two guard tests were wrong about `.optional()` and said a variable the app never reads was required *(spec: `docs/specs/S0/W0-T30-seed-a-deployed-database.md`)*

- `W0-T31` `[A]` ✅ **Generating a deploy secret without anybody reading it.** `tsx scripts/secrets/generate.ts <NAME> [--write]`, asked for at `W0-T30`'s close (*"this will come in hand when rotation is needed"*). The feature is twenty lines; **the requirement is that the tool cannot leak into an agent session**, which the operator raised and doubted was achievable. Three paths, each closed by construction, not policy: the value goes to `gh secret set` on **stdin** so it is never in `argv` (`ps`, shell history, process listings); `--write` prints **no value at all**; and both modes **refuse unless stdout is a TTY** — `isTTY` is a fact about where bytes go, not a guess about the caller, and there is no captured-output path that also has one. The refusal happens *before* `randomBytes`, so a refused run leaves no value in existence. Proven from inside an agent session, which could not make it emit one. Strength comes from the **name** (`*_BETTER_AUTH_SECRET` 32 bytes, `*_SEED_DEMO_PASSWORD` 24, both base64url, both asserted against the floors `EnvSchema` declares) — there is no `--length`, because a caller who can pick the strength can pick a weak one. Vendor credentials are listed **explicitly** in `ISSUED_ELSEWHERE` rather than inferred from "has no recipe", so a new entry in `REQUIRED` fails the suite until a human classifies it; `FLY_API_TOKEN` is refused by name, since random bytes of the right shape would fail at deploy time far from the cause. Two **argument-free wrappers** came with it — `set-preview-seed-password.sh` and `set-staging-seed-password.sh`, the repo's first `.sh` files — because whoever sets up an environment may not be technical (operator, 2026-09-19); each explains itself, confirms before overwriting, and hands off with `exec` rather than `$(…)`, which would capture the value *and* trip the TTY guard. **Found while writing the rotation note**: `*_SEED_DEMO_PASSWORD` does not actually rotate — see `W0-T32` *(spec: `docs/specs/S0/W0-T31-secret-generation.md`)*

- `W0-T32` `[A]` `[DEFERRED]` **Make a seeded credential actually rotatable.** *Deferred by the operator, 2026-09-20: rotation runs on a **30-to-60-day cadence**, so doing it by hand a few times is survivable and this does not block the funnels.* **It is deferred, not open-ended** — the preview and staging demo passwords were set on 2026-09-20, so the first rotation falls due between **2026-10-20 and 2026-11-19**; until this lands, that rotation means deleting a `_seed_run` row by hand or re-branching the database, on an environment QA is using. `W0-T31` had to print a warning instead of a rotation: setting a new `*_SEED_DEMO_PASSWORD` changes **nothing** about an environment that is already seeded, because `auth.demo-users` runs once per database and `_seed_run` skips it for ever after (`W0-T30` §3.1). The next deploy reads the new value and skips the seeder, so the old password keeps working and the secret's rotation is a fiction. Two candidate shapes: a `db:seed --force <id>` that deletes one ledger row and re-runs that seeder — which needs an answer for what `auth.demo-users` does when its rows already exist, since it `create`s rather than upserts and the ledger is *why* it may — or an explicit decision that demo credentials rotate by re-branching the database, which is cheap for preview and not for staging. `W0-T20` is the neighbour: a sanitised-data pipeline will want the same primitive for a different reason. Until this lands, treat a leaked staging demo password as *re-branch staging*, not *change the secret*

- `W3-T11` `[A]` `[B]` **Back-office CRUD for the category tree.** Operator decision, 2026-09-19: the back office becomes the taxonomy's writer, which **reverses `W3-T01` §9** — that section argued a runtime-editable taxonomy is the opposite of a legal boundary, because `requiresLicence` is what `W3-T08` reads as fact. The decision stands; the argument still has to be answered in the design rather than ignored. **`W0-T30` cleared the blocker** on 2026-09-19 — preview and staging now hold the taxonomy, so there is something deployed to edit — and it **depends on `W9-T01`** for admin auth and the audit trail — `AuditRecord` exists and an edit to a legal flag is exactly what it is for. Open at ticket start: **which slice owns it** (`modules/categories/` is `agent-providers`', `modules/admin/` is `agent-admin`'s), whether `requiresLicence` is editable at all or only by a narrower role than `ADMIN` (`W2-T03`'s rule: no implicit admin bypass, and a permission enters with the route that guards with it), and whether a slug may be changed after creation — it is in URLs, in `W3-T02`'s write path, in `provider_category` and in four fixed demo uuids, so renaming one is a breaking change while relabelling is free (`MEM-2026-09-19-1`). Note it also settles `MEM-2026-09-18-13`: runtime-editable names cannot be compile-checked i18n keys, so the `nameEs`/`nameEn` columns stay

- `W3-T01` `[M]` `[B]` ✅ **The category tree — two family roots, twenty trades, and `requiresLicence` answered.** `GET /api/categories` serves the **leaves only**: a category on the wire is a thing you can pick, so the roots are storage and `parentId` is populated but unrendered (`W12-T13` is the ticket that would render it). Flat contract, unchanged — `CategorySummarySchema` was already right. **`BD-07` is answered**: five gated trades (`electricidad`, `gas`, `climatizacion`, `telecomunicaciones`, `placas-solares`), and the rule that matters more than the list — *a licence attaches to the trade performed, not to the umbrella above it*, so `reforma-integral` is **not** gated. The flag marks a **verification**, not an exclusion (§3.5.2), which corrected `glossary.md` twice and `W3-T08`'s own line. `urgencias` is **not** a category and §3.1 says why — *urgencia* is already `EmergencyRequest` and `SearchUrgencySchema`'s `when`. No migration and no contract change: `W1-T05` modelled the table before anyone filled it. `demo-providers.ts` stops creating its four trades and resolves them instead, which makes seeder order load-bearing for the first time — asserted, not commented. **MSW deleted whole** *(spec: `docs/specs/S3/W3-T01-category-tree.md`)*
- `W3-T02` `[A]` ✅ **The provider profile write path — `GET`/`PUT /api/providers/me`, and the migration that deletes the state `W3-T07` answered `404` for.** The first guarded route in the API: `requirePermission('provider-profile:update-own')`, the one row `W2-T03` shipped with no consumer. **`/me`, never `/:id`** — the row is resolved from the principal, so ownership is structural and the `403`-vs-`404` question never arises. **`PUT` is the whole document**, because a partial update of a *set* has no agreed meaning (`{"categories":["gas"]}` is either "add" or "only"), and **the first write creates the profile** (operator, 2026-09-18) — without that the endpoint is unreachable by anyone who can sign in, since `auth-demo-users`' user has no profile and `demo-providers`' five profiles have no credentials. Profile, address and the category set move in **one transaction**, slugs resolve *before* any write, and a changed address is a **new `address` row** rather than an `UPDATE`: the old one may be where they live and `client_profile` may point at it. An identical address is reused, so repeated saves leak nothing. The answer is the **public** projection — what you saved is what a visitor sees — while `GET /me` adds the lines the owner typed. **`0009` makes `base_address_id` `NOT NULL`**, and three things came with it: the foreign key had to become `RESTRICT` (with the column required, `SET NULL` is not an outcome Postgres can produce), `packages/testing` now composes an address for every provider profile, and two live assertions describing a now-impossible row moved into `core-schema.test.ts` — where `AC-9` **inverted**, from *"deleting a base address leaves the provider, no longer searchable"* to a refused delete. **One thing found by building it:** `/me` and `/:id` share a path space, so an unguarded build answers `GET /me` as a malformed id — the fail-closed property is *never `200`*, not *always `404`* *(spec: `docs/specs/S3/W3-T02-provider-profile-write.md`)*
- `W3-T03` `[M]` Portfolio: image upload (S3 presigned), ordering, per-item category *(human: bucket + CDN credentials)*
- `W3-T04` `[A]` Listing CRUD with price model
- `W3-T05` `[A]` ✅ **Geo search API — `GET /api/search`, against the contract `W12-T08` froze.** PostGIS `ST_DWithin` against **each provider's own `service_radius_metres`** — "who will travel to me", not "who is near me" — so a provider 60 km out covering 80 km is a result and one 5 km out covering 2 km is not, and a null radius or absent base address is unsearchable (`schema.prisma:127`). One statement per request: filters, distance, the page and both facet aggregates in a single CTE, **asserted by counting Prisma's query events**, not by reading the SQL. `where` resolves through **`resolvePlace`, a port with a compiled-in ES gazetteer** — the 52 provincial capitals plus every postal code through its province prefix — because `OPS-12` has not happened and the operator's constraint was that the database stay clean for a lookup that may end up frontend-driven; an unresolvable place is a `400` naming `where`, not an empty list. **Three things found by building it:** the contract's `coarsenPoint` produced points its own `SearchPointSchema` rejected for ~1.63% of coordinates (`Math.round(v*1000) === v*1000` is false for `40.764`), which at 20 results a page would have 500'd ~28% of searches — fixed, with a property test over Spain's bounding box, since the fixed fixture it had was exactly representable and hid it; `packages/testing` cannot express a null radius, a quote-only rate or a `baseAddressId`, so the live suite reaches past the factories to Prisma (`agent-qa`, before `W3-T07`); and the MSW handler counts facets over the *page* while the contract says the matched set, so the real rail shows larger, page-stable numbers. **The mock did not go with it** — nothing seeds providers, so `W3-T10` retires it *(spec: `docs/specs/S5/W3-T05-geo-search.md`)*
- `W3-T06` `[M]` `GET /places/suggest` — the `where` field's autocomplete, plus the Maps account it needs. **The results UI is no longer here**: ADR-011 moved every storefront page into `W12`, and this ticket's old scope (*"Search results UI: list + map, clustering, mobile-first"*) shipped as `W12-T11`. What is left is the endpoint and the key — and `W12-T11` built the map's deferred boundary already, so the renderer drops in behind it *(human: Maps API key + billing + quota — `OPS-12`)*
- `W3-T07` `[A]` ✅ **Provider profile API — `GET /api/providers/:id`, against the `ProviderProfileSchema` `W12-T12` froze.** `:id`, not `:slug` — no slug column exists and ADR-011 Amendment 3 settles it on the uuid. `routes.ts` + `repository.ts`, the split `W3-T05` laid down, so the whole HTTP boundary is asserted without a database. **Prisma's typed client rather than raw SQL**, and the difference from search is the point: search is one hand-written statement because `ST_DWithin` runs against a generated `geography` column over a radius scan; this is one row by primary key, so `select` — where the columns *not* named are the projection — buys compile-time safety on exclusions that are doing security work. **Three things found by building it:** a provider with no base address cannot be serialised at all (`city`, `province` and `point` are non-null in the contract while `base_address_id` is nullable), so it answers `404` — a *transitional* answer, and the operator's rule that removes it is now on `W3-T02`; both `Decimal` columns (`rating_avg`, and the address coordinates) serialise to JSON as objects rather than numbers, so the outbound parse catches a column that would otherwise reach the wire malformed; and `packages/testing`'s `ProviderProfileInput` is **widened** here rather than worked around a third time — `serviceRadiusMetres`, `hourlyRateCents` and a new `baseAddressId` now match `schema.prisma`, closing `MEM-2026-09-17-10`. **The mock did not go with it**, for the same reason `W3-T05`'s did not: `W3-T10` retires both behind a seeder *(spec: `docs/specs/S3/W3-T07-provider-profile-api.md`)*
- `W3-T08` `[A]` Licence **verification**, not gating: a `requiresLicence` category invites proof and badges it. **The old wording here — *"only surface verified pros"* — was wrong and the operator corrected it on 2026-09-18**: an unverified provider in a gated trade is listed, searchable and bookable, and simply carries no badge. The frozen contract already assumed this (`catalogue.ts` surfaces the flag so a storefront *"can render the badge"*); `memory/repo/glossary.md` said the opposite and is corrected in `W3-T01`'s PR. Five trades carry the flag (`BD-07`, §10.1), and the machinery is `W8-T01`/`W8-T02`/`W8-T04` — this ticket is what makes a category *ask*. See `docs/specs/S3/W3-T01-category-tree.md` §3.5.2, and §10.3 for the one thing that survives: a client cannot tell that an ungated `reforma-integral` includes regulated work
- `W3-T09` `[A]` Availability calendar (weekly hours + blocked dates)
- `W3-T10` `[A]` ✅ **Demo provider seeder — the storefront reads its providers from Postgres now, not from MSW.** `apps/api/prisma/seed/demo-providers.ts` persists the world `apps/web/mocks/catalogue.ts` invented: four trades and five Madrid providers with base addresses, radii and rates, including the three rows the storefront has branches for — the quote-only provider `?mode=booking` excludes, the unrated cold-start card, and a far provider whose **own 50 km radius reaches Madrid from 29.8 km out** while every other seeded provider covers 15 km, which is `W3-T05`'s headline rule visible in the demo data. **Not `localOnly`**, deliberately: no credential, no phone number, no real person — `auth.demo-users` carries that flag because its rows have a published password, and nothing here does, so a preview database may hold this world and demo a working storefront (wiring a deploy to seed is `W0-T24`'s, nothing seeds on deploy today). Which is also why it **creates its own users**: in every environment where the local-only seeder correctly refuses, its rows are absent. Categories carry `requiresLicence: false` with `BD-07` named in the file — a demo seeder is not where a legal boundary gets decided by default. Then the two MSW handlers went. **`mocks/search.ts` and `mocks/provider.ts` did not**, and the ticket's own text is why: it said to delete them *and* said `searchCatalogue` stays because `tests/app-harness.tsx` stubs it for component tests — `W12-T11` split those modules out precisely so the handler and the stub could not disagree, and deleting them puts that second definition back in the harness (operator's call, 2026-09-18). **Eight handler-asserted criteria were re-homed rather than dropped** — `W12-T08`'s AC14–AC16 and `W12-T12`'s AC10–AC13, with a mapping table in the spec §3.1; two needed writing and both are in `seed-live.test.ts`, including **AC11, the only one that ever checked the two endpoints against each other** (every id search returns must resolve, or a visitor gets a working list of links to nothing). **One thing found by running it:** `provider_category` is keyed by its pair and has no `id` column, which a recording fake cannot know and Prisma rejects outright — `MEM-2026-09-18-1` *(spec: `docs/specs/S3/W3-T10-demo-provider-seeder.md`)*

### W4 — Jobs & presupuestos (`agent-jobs`)
- `W4-T01` `[A]` ✅ **Job posting flow — a draft that asks for nothing, and a publish that asks for one thing.** The first `W4` row: there was no `Job` in the schema at all, so this carries the model, `0010_job_posting` and the contract, not just routes. **A `DRAFT` requires nothing but an owner** — every column nullable, `{}` is a valid body, `PUT` merges — and **publishing requires exactly one thing: at least one category** (`MEM-2026-09-20-4`). Not because a form should look complete, but because matching is by category and a job with none reaches nobody, which a client experiences as silence. No description, no title, no budget, no location required. **Categories are many-to-many** (`JobCategory`, mirroring `ProviderCategory`): *a reformation of a bathroom might need tiles, plumbing and electricity* — operator, 2026-09-20. Location is **inferred** from the client's default address at publish and stays null if there is none. Two states only — `W4-T02` owns the rest, and `defineMachine` **rejected the first declaration** because `OPEN` had no exit and was not declared terminal, which the spec had argued against; the contract was right. **Photos deferred** by the operator, with no column: object storage is unbuilt and a nullable column nothing writes is the empty promise this repo keeps refusing. `transition()`'s first consumer, so every publish writes an `audit_record` row inside the same transaction as the status change *(spec: `docs/specs/S4/W4-T01-job-posting.md`)*
- `W4-T02` `[A]` Job state machine: `DRAFT → OPEN → AWARDED → IN_PROGRESS → COMPLETED / CANCELLED`
- `W4-T03` `[A]` Quote submission (one active quote per pro per job, validity window)
- `W4-T04` `[A]` Quote comparison UI for the client + accept/reject
- `W4-T05` `[A]` `[B]` Award → creates Booking (hand-off to S9). ⚠ **Now blocked on `W5-T02`** (ADR-013 §4): awarding *is* a payment — the client pays a small fee upfront, captured and forfeitable — so `AWARDED` cannot be reached without Stripe. This stopped being a pure hand-off on 2026-09-20
- `W4-T06` `[A]` Job-scoped message thread + attachments
- `W4-T07` `[A]` Job feed for providers: matched by category + radius + licence status
- `W4-T09` `[A]` `[B]` **The handshake — a code the client scans when work starts** (ADR-013 §3). Filed 2026-09-20 and new: the professional presents a code on their device, the client scans it, and that moment releases the call-out fee and moves the engagement to `IN_PROGRESS`. **It is the only source of truth neither party can produce alone**, which is what makes the state *attested* rather than claimed — the operator's reference is how Wallapop releases on confirmation. Single-use, short-lived, bound to one booking, **redeemed by the counterparty's authenticated session**: a code that is merely a URL is one the professional can scan themselves, which removes the only property worth building. **This is where platform revenue is realised** (ADR-013 §4) — approval releases the fee, which makes insisting on it the professional protecting their own money rather than a rule anyone has to police. Also owns the **arrival attestation** (*"I'm here"*, location-stamped) without which the two-strike ban rests on claims nobody can check, and the contest window that goes with it. Blocked on `W5-T02`
- `W4-T08` `[M]` `[B]` `[SUPERSEDED-PENDING]` Anti-disintermediation: mask contact details until booking is paid *(human: how aggressive to be — product call)*. ⚠ **Do not build this as written.** Operator, 2026-09-20, described a different model: seeing a contact is a **subscription** feature, not a reward for a paid booking, and non-paying users reach a professional through **in-app messaging** instead of being blocked. Transaction-gated and access-gated are different products with different revenue logic. `W13` owns the reconciliation and must land its ADR before this ticket means anything

### W5 — Money (`agent-money`) — *the highest-risk slice, staff it first*
- `W5-T01` `[M]` Stripe Connect Express onboarding for providers, KYC status sync *(human: Stripe account, Connect config, branding)*
- `W5-T02` `[A]` `[B]` Booking creation + PaymentIntent + 3DS handling. ⚠ **"Manual capture" is superseded by ADR-013 §4.** A hold releases on cancel and so costs the client nothing, which does none of the work the fee is there to do; and **card authorizations expire after roughly a week**, so a hold cannot cover work scheduled three weeks out. The shape is now **one payment only** — the call-out fee, *captured* at award, released when the client approves the start (`W4-T09`), refunded on a no-show, forfeited in full on a cancel. **There is no escrow of the job's value, because the job's value never enters the platform.** Verify the exact flow and the expiry against current Stripe docs before building; the ADR states the shape, not the API. Unblocks `W4-T05` and `W4-T09`
- `W5-T03` `[M]` Webhook endpoint: idempotent, signature-verified, replayable, dead-letter queue *(human: register endpoint, supply signing secret)*
- `W5-T04` `[M]` `[B]` `[SUPERSEDED]` ~~Completion → capture → transfer~~ *(human: **decide the take rate** — still needed, but it prices the call-out fee, not a cut of the job)*. ⚠ **Nothing happens at completion** (ADR-013 §4): revenue is realised when the client approves the start of work, and **the job's own price never passes through the platform at all** — operator, 2026-09-20: *"Platform revenues is on the start of work"*. What the work costs is settled between the two people, in cash if they choose, and the platform neither sees it nor polices it (§4.1). The release this row used to describe now lives at `W4-T09`
- `W5-T05` `[M]` `[B]` Cancellation & refund policy engine + partial refunds *(human: define the policy)*. **Forfeiture is all-or-nothing** — operator, 2026-09-20: a client who cancels after awarding loses the upfront fee whether they cancel ten minutes later or the night before, and the time-based tiers this row used to assume are **not** the model. ADR-013 §5 records the enforceability risk that decision carries. **What is still unmodelled is the split** — operator: *"How to divide them ( platform costs vs reservation of time of professional ) is still up for a serious plan i still didnt have time to model"*. Two claimants on one forfeited amount, and any share reaching the professional is a payout for work not done, so it carries IVA and belongs on `W5-T09`'s list
- `W5-T06` `[A]` Dispute/hold flow: freeze payout, admin resolves
- `W5-T07` `[M]` `[B]` Stripe Billing: FREE/PLUS/PREMIUM tiers, proration, dunning *(human: create products/prices, set pricing)*
- `W5-T08` `[M]` `[B]` Subscription entitlements service *(human: **define what each tier buys**)*
- `W5-T09` `[H]` `[B]` Invoices/receipts with Spanish VAT (IVA) + provider payout statements — **needs an accountant**; agent implements only after the rules are written down
- `W5-T10` `[A]` Ledger table: every money movement double-entered and reconcilable to Stripe
- `W5-T11` `[A]` Reconciliation job + alert on any mismatch

### W6 — Auctions (`agent-auctions`)
- `W6-T01` `[A]` Auction creation from a job (sealed vs open, close time, min bid)
- `W6-T02` `[A]` Bid submission with validation + one-active-bid rule + entitlement check
- `W6-T03` `[A]` Scheduled close worker (idempotent, restart-safe), award or expire
- `W6-T04` `[M]` `[B]` Anti-sniping: extend close window on late bids *(human: window policy)*
- `W6-T05` `[A]` Client manual award override before close
- `W6-T06` `[A]` Auction UI: countdown, bid list per reveal policy, award action
- `W6-T07` `[M]` `[B]` Abuse controls: retraction limits, lowball detection, bid caps by tier *(human: thresholds)*

### W7 — Emergency call-outs (`agent-emergency`)
- `W7-T01` `[M]` `[B]` Emergency request creation + premium pricing rules *(human: **pricing model**)*
- `W7-T02` `[A]` Broadcast to nearby available verified pros, expanding-radius waves
- `W7-T03` `[A]` First-accept-wins with a race-safe claim (DB-level, concurrency-tested)
- `W7-T04` `[M]` Notification transport: web push + email + SMS fallback *(human: provider accounts, VAPID keys, sender verification)*
- `W7-T05` `[A]` Provider "available now" toggle with auto-expiry
- `W7-T06` `[A]` No-accept fallback: escalate radius, then notify client + suggest quote mode
- `W7-T07` `[A]` Client live status screen (accepted / en route / arrived)

### W8 — Trust: certification, badges, reviews (`agent-trust`)
- `W8-T01` `[M]` Licence upload (private bucket, virus scan, EXIF strip, signed short-lived URLs) *(human: AV service + bucket policy)*
- `W8-T02` `[A]` Verification queue + admin review UI + approve/reject with reason
- `W8-T03` `[A]` Expiry tracking + re-verification reminders + auto-revoke on expiry
- `W8-T04` `[M]` `[B]` Badge engine: VERIFIED_LICENCE, TOP_RATED, FAST_RESPONDER, PREMIUM *(human: qualifying rules)*
- `W8-T05` `[A]` Reviews: only after a completed paid booking, both directions, edit window. **Also a revenue control, and labelled so it is not relaxed by accident** (ADR-013 §9): a professional's reputation only grows through on-platform work, which turns leaking from free money into a cost they pay themselves. *"Let clients review any job, we need more reviews"* is a reasonable-sounding growth proposal that would remove it silently
- `W8-T06` `[M]` `[B]` Rating aggregation + display rules (min N reviews before showing an average) *(human: N and the display policy)*
- `W8-T07` `[A]` Moderation: report content, hide/remove, appeal trail

### W9 — Admin & ops (`agent-admin`)
- `W9-T01` `[A]` **Admin auth** — a session that proves `ADMIN`, and the permission rows that go with it. **Narrowed on 2026-09-20**: the audit trail was in this line and is now `W9-T08`, because the two are independent and only one of them blocks anything. Today `ADMIN` is a role nobody wears and nothing grants: `permissions.ts` has a single row (`provider-profile:update-own`) and states that *"`ADMIN` is not implicit… an admin is allowed exactly what lists it, which is currently nothing"* (`MEM-2026-09-18-2`). Needs `W9-T07` for an account to exist at all
- `W9-T07` `[A]` `[M]` **Admin account provisioning — deliberately not part of signup.** Operator, 2026-09-20: *"this would be a separate process, either by hand, script or whatever, but we need to keep it outside normal generation of auth. An admin will be someone joining the project from the back, not the front of the app."* So there is **no admin registration route**, ever, and no path from the storefront to an `ADMIN` role. A seeded admin is wanted now so `W9-T01` and `W3-T11` have something to authenticate as; real provisioning comes later. Inherits `W0-T30`'s lesson exactly — the seeded admin's password must come from a secret and refuse a non-local target, since this one is a *privilege* boundary and not just an account (`MEM-2026-09-19-3`, `scripts/secrets/`). `[M]` for whoever holds that secret
- `W9-T08` `[A]` **The admin-action audit contract, and its own table.** Operator, 2026-09-20: *"Admin action deserves it's own table. We must keep records for all users, but actions taken by an admin need their own flow."* **Not `AuditRecord`** — that model is a *state-machine* ledger (`fromState`/`toState` non-null, *"written only through `transition()` in `@marketplace/contracts`"*), and an admin renaming a category is not a state transition; forcing it in would mean faking states or loosening the rule that keeps that ledger trustworthy. This ticket owns the new model, who writes it, and what an admin action *is*. **Explicitly not MVP-blocking** (operator, same day: *"the audit is not so important to get to an [MVP]"*), so it does not gate `W3-T11` or anything front-of-app — but it is the thing that answers `W3-T01` §9's objection, so `W3-T11` should not claim to have answered it until this exists
- `W9-T02` `[M]` `[B]` Verification queue, user search, impersonate-for-support (logged) *(human: approve the impersonation policy — GDPR sensitive)*
- `W9-T03` `[A]` Dispute & refund console
- `W9-T04` `[A]` Content moderation queue
- `W9-T05` `[A]` Ops dashboard: GMV, take rate, active pros, conversion by flow, payout health
- `W9-T06` `[A]` Agent-quality dashboard: intervention ledger rollup by agent / root cause / slice

### W10 — Quality & launch (`agent-qa`, `agent-devops`)
- `W10-T01` `[A]` Seed script: believable demo marketplace (50 pros, 200 listings, jobs in every state)
- `W10-T02` `[A]` Playwright e2e per flow (see §7)
- `W10-T03` `[M]` Stripe sandbox scenario suite incl. failed payments, disputes, refunds *(human: test-mode setup)*
- `W10-T04` `[A]` Load test on search + emergency broadcast
- `W10-T05` `[A]` Accessibility pass (WCAG 2.1 AA) on the core flows
- `W10-T06` `[M]` Security review: OWASP top 10, file upload, IDOR sweep across every `:id` route *(human: sign-off; consider an external pentest)*
- `W10-T07` `[H]` Legal pages, cookie consent, ToS, privacy policy, GDPR records — **lawyer-drafted**, agent only wires them up
- `W10-T08` `[A]` Runbooks: payout failure, Stripe outage, webhook backlog, rollback
- `W10-T09` `[M]` Beta launch checklist + rollback plan *(human: go/no-go)*

### W11 — Agent autonomy (`agent-devops`, `agent-qa`) — *the pipeline builds itself*

Tickets executed unattended, spec to merged PR. Design: `docs/adr/ADR-008` (orchestration),
`docs/adr/ADR-009` (model tiering + redaction) and `docs/adr/ADR-010` (telemetry). **Three phases,
in order — each is a separate trust decision, and none of them starts until `W0-T26` closes the
fail-open `database` gate.**

**Phase A — Claude Code everywhere.** One harness, one vendor, the real repo. Proves the graph, the
interrupts and the gates before any of them has to survive a second model or a redactor.

- `W11-T01` `[A]` LangGraph orchestrator skeleton: graph, state, Postgres checkpointer, `POST /tickets`, HMAC-verified `POST /webhooks/github` *(needs `OPS-19`, `OPS-20`)*
- `W11-T02` `[M]` Fly apps `marketplace-agents` (always on) + `marketplace-agent-worker` (machines on demand), deploy workflow, **pinned** `WORKER_IMAGE_TAG` *(human: `OPS-21`)*
- `W11-T03` `[A]` The worker contract — fixed in/out interface — and `worker-claude`, its first implementation
- `W11-T04` `[A]` Deterministic context pack (no RAG) **plus a per-source trust manifest**: four of its sources are prose naming real people and incidents
- `W11-T05` `[A]` Spec phase → draft PR → `spec:approved` label interrupt → escalation answers as an addendum commit
- `W11-T06` `[A]` Machine-verified `tdd_red` (the suite **must** exit non-zero), `decompose`, and the per-criterion green loop *(needs `W0-T26`)*
- `W11-T07` `[A]` CI and review interrupts: `check_suite`, comments, and PR-close routed to the `ledger` node so `L7` is written by the graph, not by discipline
- `W11-T08` `[A]` Budget per ticket, attempt ladder, kill switch, `/threads` view and a stale-interrupt alert
- `W11-T09` `[A]` Per-phase run record: `agents/prompts/08-run-record.md` grows a model/tier/attempts/tokens/cost table, and `ROLLUP.md` reports by tier
- `W11-T10` `[M]` `agent-dispatch.yml` + the `agent:go` label *(human: install the App from `OPS-19`)*

**Phase B — a second model.** Only after phase A has run tickets end to end.

- `W11-T11` `[A]` `services/orchestrator/models.toml`: phase → layer → tier routing, and the promotion ladder
- `W11-T12` `[M]` `worker-openweights`: OpenAI-compatible endpoint behind the same contract *(human: `OPS-22` — and the egress decision below)*
- `W11-T13` `[A]` Harness-neutrality audit of `agents/prompts/**` — skills, `.claude/agents/` and hooks do not port
- `W11-T14` `[A]` Cost **per completed task** and promotion rate per tier; A/B the cheap tier on real tickets before trusting it

**Phase C — redaction.** `ghostc` (`micro1hackaton`) at the trust boundary.

- `W11-T15` `[A]` `ghostc screen` as a `PostToolUse` hook — a chokepoint on tool output, fail closed. Testable in phase A's harness with no third party involved
- `W11-T16` `[A]` `worker-ghost`: `compile` → work in ghost space → `verify` → `apply-patch`, as a third implementation of the `W11-T03` contract
- `W11-T17` `[A]` Extend the leak corpus to **agentic traffic** — context pack, `git log`, stack traces, CI logs. A repo snapshot is a different distribution from what a loop actually emits
- `W11-T18` `[M]` `[B]` Per-source egress decision for the context pack and the ghost workspace *(human: approve each destination; `screen` must never run on the tier it is screening)*

**Today — needs none of the above.** The pipeline is already producing the data; nothing reads it.
This runs against the human-driven pipeline and is what gives `W11-T09` and `W11-T14` a baseline.

- `W11-T19` `[A]` **Close the learning loop** (`docs/adr/ADR-010`). Four signals — correction rate by root cause, run-record completeness, cost/attempts per finished task, memory hit rate. Lower the `intervention-logged` trigger from "a human closed a PR" to "a human corrected the agent"; extend `spec-present` to assert a run record's **sections**, not just its existence; backfill the ledger from the 15 session transcripts **before the harness prunes them** — they are 20 MB, outside git, and hold ~125 operator turns against a ledger of one

### W12 — Web experience & design system (`agent-ui`) — *the storefront, and the parts every slice reuses*

The one slice in §4 that had an owner, a folder and no backlog. Design: `docs/adr/ADR-011` (how a
page is rendered) and `docs/adr/ADR-012` (what it is made of). Milestone `M11`. **Order matters
here**: the rules and the component layer land before the pages, because retrofitting either onto
finished pages is how the accessibility and SSR bills both come due at once.

**The foundation — rules and components before pages.**

- `W12-T01` `[A]` ✅ `packages/ui` — package, Vite library build, exports map, and `tokens.css` moved in from `apps/web`; the three ADR-011 route rules as ESLint config in `apps/web/eslint.config.js` plus a DOM-free route-module test. The gates landed before there was anything to retrofit *(issue #201)*
- `W12-T02` `[A]` ✅ Seven primitives on React Aria Components — Button, Field, TextInput, Select, Combobox, Dialog, Popover — with stories for default, focus, disabled, loading, error and long-text. React Aria stays `external` in the build: an 8.81 KB entry point rather than 339 KB, which is ADR-011's JS budget kept a task before it is measured *(issue #202)*
- `W12-T03` `[A]` ✅ Storybook 10 workbench in `packages/ui`: theme and locale toolbars, and every story running as a Vitest browser test in a real Chromium through `@storybook/addon-vitest`. Two projects, one `pnpm test` — a separate script is a suite that stops running the first time someone forgets it *(issue #203)*
- `W12-T04` `[A]` ✅ `parameters.a11y.test = 'error'`, set globally rather than per story: an axe violation fails the PR like any other assertion. Proven by a deliberate red probe before being believed. `W10-T05` paid down per pull request instead of as an audit at the end *(issue #204)*
- `W12-T05` `[A]` ✅ Three token layers in four files (`scale`, `themes/default`, `themes/contrast`, `components`), `[data-theme]` and `[data-scheme]` over `color-scheme` + `light-dark()` so a colour is written once and a scheme can be *chosen*, a high-contrast second theme, and a `tokens.test.ts` that resolves the whole graph in all four `theme × scheme` combinations — layering, completeness both ways, every `var()` naming something, and WCAG AA measured rather than assumed *(issue #205)*
- `W12-T06` `[A]` ✅ The workbench deployed to its own Cloudflare Pages project (`marketplace-ui`) — per PR and on merge, URL read back from wrangler and commented beside the app preview, teardown mirroring `deploy-preview-teardown.yml` *(issue #206)*

**The seam — search is a schema, and the schema defines the API's input.**

- `W12-T07` `[A]` ✅ The search bar as a declarative schema: typed field descriptors, three renderings of one declaration (hero, compact header, filter rail) from a single `SearchBar`, and `toSearchQuery`/`serializeSearchQuery`/`parseSearchQuery` as pure, DOM-free functions a Worker can call (`R4`). The descriptors are domain-free — a field's `name` is a string and its options arrive as data — because `packages/ui` may not import `packages/contracts`, which is also why the zod freeze stays `W12-T08`. Nine stories, so every rendering is an axe assertion *(issue #207)*
- `W12-T08` `[A]` ✅ The search contract: `SearchQuerySchema` composed with `W1-T02`'s `listQuery` so search pages like the other eight lists, `SearchResultSchema` as the public projection of a provider — strict, so the absent `line1`/`userId` are enforced rather than remembered (`W1-T05` §8) — and `SearchResponseSchema` built **on** `pageEnvelope` so the frozen envelope cannot drift. `GET /search` + `GET /categories` as MSW handlers built **from** the `packages/testing` factories, outside `src/` because the `W1-T09` gate is what makes that the only honest place for them. No rating sort: `ratingAvg` is nullable and keyset paging drops null rows, which on a cold-start marketplace is every new provider (`Q4`) *(issue #208)*

**The storefront — the M11 surface, all of it public.**

> **A deploy must be usable on its own.** A storefront page may not hard-depend on an endpoint that
> does not exist yet: it is mocked (`VITE_ENABLE_MOCKS`, on for preview and staging, never for the
> production release) or the page degrades without it. `W12-T09` broke this — the shell's loader
> treated `GET /categories` as a precondition, the endpoint 404'd, and the entire deployed storefront
> became the 500 page over one empty dropdown. Both halves are now gates: `routing.test.tsx` AC8a/b
> and `mocks.test.ts` AC19.

- `W12-T09` `[A]` ✅ Public shell: `/:lang` routing with **untranslated segments** (`/es/search`, never `/es/buscar` — ADR-011 Amendment 1), the compact search in the header over loader-supplied categories, a link-based language switcher that keeps your place and your query string, legal slots that say they are pending, and 404/500 boundaries **at the level that actually failed** — a mistyped legal URL keeps the header. React Query over axios, wired loader-first so R3/R5/R6 all still hold *(issue #209)*
- `W12-T10` `[A]` ✅ Home page: the hero search as a second rendering of the same declaration (its own landmark name — the header's is already `search`), category cards whose hrefs are built by `toSearchQuery`/`serializeSearchQuery` rather than by string concatenation, how-it-works, a trust strip, and `/:lang/become-a-pro` — the supply-side landing ADR-011 §2 puts in this ticket, stopping visibly at the auth wall (`W2-T01`) rather than at a 404. `Card` joins `packages/ui`'s patterns layer. The category region is **absent, not empty**, when `GET /categories` is down, and the required-`where` guard is now one hook both bars call — `W12-T09`'s header was navigating to `/es/search?` with an empty query string. No counts (no endpoint serves one) and no prerendering (ADR-011 Amendment 2) *(issue #210)*
- `W12-T11` `[A]` ✅ Results page: list + facet rail as the **third** rendering of `W12-T07`'s one declaration, the map as a deferred chunk proven by a build assertion (a flattened `import()` still works and silently doubles the entry — `R9`), empty/error states as one `EmptyState`, and `Next`-only paging because `W1-T02` decision D removed `total` so page numbers cannot exist. Category facets filter (`what` is in the contract); kind facets are counts, because `kind` is not and the seam is frozen. `ResultRow`/`Pagination`/`EmptyState` join `packages/ui`. **A query with no `where` is a state, not a parse failure** — every category card on the home page links to `?what=<slug>` with no location, and a visitor can delete the location from the header search. `missingRequiredFields` already names it: render the rail with the required field flagged and send no request. `SearchQuerySchema` requires `where`, so a loader that parses first answers the M11 demo with a 500 — and it renders without sending a request *(the `W12-T10` §10 Q3 hand-off, now closed)* *(issue #211)*
- `W12-T12` `[A]` ✅ Public provider profile: the page `W12-T11`'s every row links to, closing the storefront's last deliberate 404 and the M11 demo. **Four of the five things the old line named have no columns** — `PortfolioItem`, `Badge` and `Listing` are in §3's sketch and in no migration — so the page renders what exists (identity, categories, the `ratingAvg`/`ratingCount` summary, service area, member since) and states the rest as pending slots, keeping `W12-T08`'s rule that a contract holds only columns that exist. `ProviderProfileSchema` is *derived* from `SearchResultSchema` (minus `distanceMetres`, plus `serviceRadiusMetres` and `memberSince`) so the two cannot drift and the coarse-point refinement comes along. `AuthWall` joins `packages/ui` and `become-a-pro` adopts it — a boundary stated in words, with no disabled button and no link to a form that does not exist. **Listing detail is dropped**: a provider *is* the listing until a `Listing` model exists *(spec: `docs/specs/S10/W12-T12-provider-profile.md`, ADR-011 Amendment 3, issue #212)*
- `W12-T13` `[A]` *(priority open — this ticket's whole rationale was SEO, deferred by ADR-011 Amendment 1; re-derive before starting)* Category and category × city landing pages over the **curated** matrix *(needs `BD-15`)*

**Making it count — indexable, fast, and provably unchanged.**

- `W12-T14` `[A]` Flip the rendering switch — **and prerendering of the fixed routes arrives here too**, moved from `W12-T10` by ADR-011 Amendment 2: its rationale was indexing and link previews, both deferred, so standing up a prerender path before the framework-mode switch means building one that this ticket deletes. React Router framework mode on Workers, per-request i18n instance (the one known R6 violation today), and a **real HTTP status for 404/500** — today the SPA answers `200` for every path, so `/nope` is a soft 404. The indexing half — `meta`/canonical/`hreflang`/JSON-LD, sitemap, `robots.txt` disallowing `/search` — is **deferred** and splits into its own ticket when there is something in production worth indexing (ADR-011 Amendment 1)
- `W12-T15` `[A]` ✅ Performance **harness** (not a gate — operator, 2026-09-12: *"if the harness is in place, we'll get to it later… it should not be a blocker in this MVP phase"*): `pnpm --filter @marketplace/web perf` runs Lighthouse over the home and results pages and **reports** per-metric score floors (≥85) on a realistic 4G profile — 10 Mbps / 40 ms RTT / 4× CPU, *not* Lighthouse's default mobile profile. **The `≤170 KB initial JS` budget is deleted by operator decision (2026-09-12), not relaxed**: the same build scores 68 under the default profile and 100 under a real-4G one without a byte changing, and `TBT ≈ 0` on both — the bundle costs transfer time on a link this product is not for, never main-thread time. A future byte budget must be re-argued from a measurement, never cited from this line. Lighthouse's SEO category stays deferred (ADR-011 Amendment 1). It **runs on every pull request** via a non-gating `perf` job in `ci.yml` that appends the score table to the run recap, and a route below a floor uploads its Lighthouse filmstrip as the `perf-screenshots` artifact — frames named by the millisecond they painted. The job must never be added to branch protection: that would make it a merge gate through a settings change rather than a reviewed one. The R2 image pipeline (`srcset`/AVIF) and the font strategy split out — the latter is blocked on `W12-T19` choosing a face *(spec: `docs/specs/S10/W12-T15-performance-budget.md`, issue #215)*
- `W12-T18` `[A]` ✅ **Visual foundations — sequence this *before* `W12-T16`**: a palette, a type scale and depth, landing entirely in the token layers `W12-T05` built for it. Values are **vendored from vetted sources, never installed** — Radix Colors for the two theme ramps (twelve steps defined by *role*, which is close to the semantic names already chosen), Open Props for the type scale and elevation, the React Aria vanilla-CSS starter kit as a *reference* for component treatment. A theme that reads `var(--sand-2)` is a theme that no longer resolves on its own, and nothing new may reach the bundle `W12-T15` is already over budget on. The type scale gains display steps and **a line-height per size** — one ratio for everything is why the `h1` reads as large body text. Also fixes the contrast gate: `tokens.test.ts` AC6 names six pairs by hand and `--mp-color-text-muted` on `--mp-color-surface` is not one of them, which is what every `Card` description renders in *(spec: `docs/specs/S10/W12-T18-visual-foundations.md`, issue #232)*
- `W12-T20` `[A]` ✅ **The storefront never loaded the design system's stylesheet.** `apps/web/src/main.tsx` imported `@marketplace/ui/tokens.css` and `src/styles/app.css`; nothing imported `@marketplace/ui/styles.css` — the `dist/ui.css` export `W12-T02` §4 created for exactly this. So every React Aria component in the application rendered as a raw browser control, from `W12-T01` until `W2-T09` found it, and **no suite could see it**: axe is green on an unstyled page, the visual baselines are *Storybook* screenshots where the CSS is loaded, and the one test that reads the entry point's imports was satisfied by the tokens line. The fix is one line; the ticket is the gate. Three layers, cheapest first — the export resolves and carries real rules, the entry point imports both stylesheets, and **a production build emits the component layer**, with the needles derived from `dist/ui.css` rather than listed. That last one was green over a broken build in its first version: a CSS Modules class name is a *string* in the JS bundle whether or not the stylesheet ever loaded, so it was measuring tree-shaking until the needle became a selector (`MEM-2026-09-17-1`). Plus the observer the storefront never had — **route screenshots beside `W12-T16`'s axe pass, over the same list**, and `visual-baselines.yml` grew a `ref`/`subjects` pair so a ticket that introduces a route can generate its own baselines on its own branch. `pnpm dev` now builds the workspace packages first, because `styles.css` resolves to a build output *(spec: `docs/specs/S10/W12-T20-design-system-stylesheet.md`)*
- `W12-T19` `[M]` `[B]` The typeface: choose a face, licence it or take it from Google Fonts, self-host it, and set `--mp-font-family` — a one-line change in the theme layer, deliberately, which is why `W12-T18` leaves `system-ui` alone. The performance half (subsetting, `font-display`, preload) is `W12-T15`'s budget *(human: licensing and cost, and whether a brand is arriving from outside — `W12-T18` §10 Q1; issue #233)*
- `W12-T16` `[A]` ✅ Nightly visual regression: Playwright screenshots over a pinned story list, baselines generated **only** inside the CI image — **plus an axe pass over the real routes** (`/es`, `/en`, a legal slot, the 404 and the 500). `W12-T04`'s gate runs axe against *stories*, and the shell is not a story and will not become one: it is an application composition, not a component. So the skip link, the landmark set, the header's compact search and both error pages have no automated a11y coverage today — `shell.test.tsx` asserts landmark presence and name-uniqueness by hand, which is strictly weaker than axe *(agreed with the operator 2026-09-11 while reviewing `W12-T09`)*. **Runs after `W12-T18`** — there is no point baselining a look that is about to be replaced. `W12-T10` adds the home page and `/:lang/become-a-pro` to that uncovered list — five `region` landmarks, two `search` landmarks on one page, and a card grid — so the route list here is `/es`, `/en`, the home page, `become-a-pro`, a legal slot, the 404 and the 500 *(spec: `docs/specs/S10/W12-T16-visual-regression.md`, issue #216)*
- `W12-T17` `[M]` `[B]` Landing-page content: the curated city × category matrix and where the prose comes from *(human: `BD-15` — headless CMS vs MDX in the repo)*

---

### W13 — Messaging & contact gating (`agent-jobs` + `agent-money`) — *ADR first, and its own session*

> **Filed 2026-09-20 by the operator, and deliberately not started.** *"This DM part need an adr, and
> dedicated epic. So, creating adr and ticket should be done in its own session."* What follows is the
> brief for that session, not a design.

**The problem, in the operator's words:** *"Non payng users need to be able to contact professionals
ONLY through the app. This means some sort of internal messaging system. 'Able to see contact' should
be a payed feature. If we let people be able to contact by phone or personal email whoever on the
search result, the users will have no incentive to buy subscriptions."*

**Two things make this an epic rather than a ticket.**

1. **It reframes `W4-T08`, which is already written.** That ticket masks contact details until a
   **booking is paid** — transaction-gated. This is **subscription**-gated, and adds a channel
   (in-app DM) that `W4-T08` does not have. Different revenue logic, different product. `BD-08` is
   now this epic's question.
2. **The existing messaging is job-scoped.** `W4-T06` is a thread that exists once a job exists. The
   case here is contact **from a search result**, before any job — which nothing covers today.

**What the ADR has to settle, at minimum:**
- What a non-subscriber can do: message freely, a capped number, or request-and-accept?
- What subscribing unlocks — the raw phone/email, or just more messaging?
- Which side subscribes. The operator's framing says *users*; `subscriptionTier` in §3 hangs off the
  **provider** profile, and `S9`'s line says *"Stripe Billing for pro subscriptions"*. **These
  disagree, and it is the first thing to resolve.**
- Whether contact details are masked in *data* or only in *presentation* — the second is a leak
  waiting for anyone who opens dev tools.
- ~~How leakage is measured~~ — **answered 2026-09-20 by ADR-013, and from the opposite direction.**
  This brief assumed message scanning because *"messages are the place people paste a phone number
  anyway"*. They are, and scanning them is still the wrong instrument: evadable by anyone who spells
  a number out, and it reads private conversations to solve a revenue problem. ADR-013 measures the
  economic footprint instead — a forfeitable fee at award, a handshake that attests work started,
  and `W5-T11` reconciling lifecycle against money. **This epic no longer owes `R4` a method**, only
  the access rules.

**Known dependency, and it may block:** nothing in the codebase knows whether anyone is subscribed.
`subscriptionTier` is in the domain sketch and unbuilt; billing is `S9`, which has not started. The
ADR should say what this epic does while that is true — a feature flag, a stub predicate, or waiting.

**Not blocked by** `W9-T08` (audit) or `W3-T11` (back office), neither of which is front-of-app.

## 7. Testing strategy

TDD is not optional here: the red phase is a **Definition-of-Done artifact** (§5.3) and every slice
agent loads the `test-driven-development` skill at task start.

| Layer | Tool | Owner | TDD? | Runs |
|---|---|---|---|---|
| Unit (services, state machines, money, badge rules) | Vitest | slice owner | **required** | every PR |
| Contract (route ⇄ OpenAPI ⇄ generated client) | Vitest + supertest | `agent-contracts` | **required** | every PR |
| Integration (API + real Postgres in docker) | Vitest + testcontainers | slice owner | **required** | every PR |
| Component (React) | Vitest + Testing Library; in `packages/ui` the **stories are the tests** (`@storybook/addon-vitest`) | slice owner / `agent-ui` | required for logic-bearing components | every PR |
| E2E | Playwright against preview env | `agent-qa` | written from the spec's acceptance criteria, before the feature | smoke on PR, full nightly |
| Payments | Stripe test mode + webhook replay fixtures | `agent-money` | **required** | every PR touching S9 |
| Concurrency | targeted race tests (emergency accept, auction close, quote accept) | slice owner | **required** | every PR touching S7/S8 |
| Load | k6 on search + broadcast | `agent-devops` | n/a | pre-launch + nightly |
| A11y | **axe on every story** (Storybook + Vitest, failing the build) · axe in Playwright on the core flows | `agent-ui` | n/a | **every PR** (stories) + nightly (flows) |

**E2E flows that must exist before beta:**
1. Client signs up → searches manitas near a postcode → books → pays → completes → reviews
2. Client posts a job → 3 pros quote → client accepts → pays → completes → payout released
3. Client posts an auction → pros bid → auction closes → winner awarded → paid
4. Client raises an emergency → nearest pro accepts → arrives → completes → premium charged
5. Pro signs up → uploads licence → admin approves → badge appears → licensed category unlocked
6. Pro upgrades to PREMIUM → entitlements change → downgrades → proration correct
7. Cancellation and refund at each policy tier
8. Every 403: client cannot act as pro, pro cannot see other pros' sealed bids, etc.

**Test data**: one seed script, deterministic, versioned. Every agent tests against the same
fixture set — no ad-hoc data creation in tests except via shared factories in `packages/testing`.

---

## 8. Milestones (ordered for early deploys)

| # | Milestone | Contains | Exit criteria |
|---|---|---|---|
| **M0** | Walking skeleton deployed | `OPS-01`–`05`, `07`, `08`, `09`, `11`; W0 minus the deferred setups; W1-T01…T04 | Empty-but-real app on staging; **a PR gets its own Fly app + Neon branch, both destroyed on close**; errors reach Sentry; CI green **including `spec-present`, `intervention-logged` and `agents-drift`**; `agents/` + `memory/` in place. **Four services only: Fly, Neon, Cloudflare, Sentry.** |
| **M1** | Identity | W2, W1-T05…T09 | Anyone can sign up as client/manitas/pro on staging; permissions tested |
| **M2** | Discovery | W3 | Client can find and view providers on a map near a real Spanish postcode |
| **M3** | First euro | W5-T01…T04, W4-T01/T02/T05 | End-to-end paid direct booking with a manitas in Stripe test mode; funds captured and transferred |
| **M4** | Presupuestos | W4 remainder | Quote → accept → pay → complete works end-to-end |
| **M5** | Trust | W8 | Licence verification live; licensed categories gated on verified pros |
| **M6** | Auctions | W6 | Auction closes automatically and awards correctly under concurrency tests |
| **M7** | Emergency | W7 | Broadcast + first-accept-wins proven under a concurrency test |
| **M8** | Monetisation | W5-T05…T11, W8-T04 | Subscriptions, fees, refunds, badges, reconciliation clean |
| **M9** | Beta-ready | W9, W10 | Security + a11y + load pass, runbooks written, rollback rehearsed |
| **M10** | Agent autonomy | `W0-T26`, `OPS-19`–`22`, W11 | **Phase A**: an `[A]` ticket goes from `agent:go` to merged PR with no human keystroke but the spec approval and the review. **Phase B**: the cheap tier closes a majority of tickets unaided, measured per completed task. **Phase C**: zero leaks on the agentic-traffic corpus, `verify` fail-closed in the loop |
| **M11** | Public storefront | `W12` | A stranger with no account, on staging: home → search *fontanero · Madrid · esta semana* → seeded results on a list + map → a provider profile → a CTA that **stops cleanly at the auth wall**. Workbench deployed, every story passing axe, Lighthouse mobile budget green, ES **and** EN complete |

**M11 is numbered, not ordered.** It starts the moment M0 lands and runs alongside M1–M2: `agent-ui`
builds the component layer and the public pages against seeded fixtures while `agent-identity` and
`agent-discovery` build what those pages will eventually call. Its exit criterion is deliberately the
auth wall — everything past it (accounts, posting a job, paying) is M1, M3 and M4 arriving *into* a
front end that already exists, rather than each of them growing its own.

**Critical path**: human blockers (§6) → M0 → M1 → M3 (money). Everything else parallelises after M1.
Staff `agent-money` from M0 so Stripe Connect onboarding is already in review when M2 finishes.

**Parallelisation after M1**: `agent-discovery` (W3) ‖ `agent-money` (W5) ‖ `agent-trust`
(W8-T01/T02) ‖ `agent-ui` (**W12**, from M0 — it needs seeded fixtures, not endpoints) ‖ `agent-qa` (W10-T01 seeds).

---

## 9. Early deployment & feedback loop

1. **Deploy before there's anything to deploy.** M0 ships an empty app to staging on day one;
   nothing else starts until PR previews work.
2. **Every PR gets a URL.** Reviewers (human or agent) click, they don't imagine.
3. **Staging is always demoable** — seeded with a plausible Spanish marketplace, resettable with
   one command, never left broken overnight.
4. **Feature flags for every slice** (ADR-007): incomplete work merges to `main` behind a flag that
   is OFF everywhere except its own preview. Long-lived branches are the bottleneck we are avoiding;
   rollout and rollback are flag changes, not deploys.
5. **Observability from M0**: request logs with trace ids, error tracking, a metric per state
   transition. Payment failures page someone.
6. **Weekly**: staging walkthrough of the 8 e2e flows + review of `docs/interventions/ROLLUP.md`
   before adding new scope. Agent quality is a standing agenda item, not an afterthought.

---

## 10. Risks & open questions

| # | Risk / question | Impact | Action |
|---|---|---|---|
| R1 | Holding client funds until job completion may make us a payment intermediary under Spanish/EU rules | Blocks launch | Legal review before M8. Stripe Connect with delayed transfers is the mitigation, but confirm |
| R2 | Licence verification: is there a usable registry API per colegio/comunidad, or is it manual forever? | Ops cost, trust | Research during M2; MVP assumes manual review |
| R3 | Marketplace cold start — no pros means no clients | Existential | Seeded supply strategy (manual pro recruitment) before beta; not a code task |
| R4 | Disintermediation: users take the job off-platform after matching | Revenue | **Two halves, and the second is now designed.** *Access*: in-app messaging until a subscription unlocks details (`W13`, ADR pending; was `W4-T08`). *Economics and detection*: ADR-013 — awarding costs a forfeitable fee, the handshake attests that work started, and `W5-T11` reconciles lifecycle against money. The leak rate is the four signatures in ADR-013 §8, measured on the **pair and the rate**, never the single event. **Not** message scanning: evadable by anyone who writes *llámame al seis tres cuatro…*, and it reads private conversations to solve a revenue problem |
| R5 | Auction abuse: lowball bids, bid-and-run | Trust | Bid caps by tier, ratings-gated bidding, cancellation penalties |
| R6 | Emergency SLA — promising fast response we can't fulfil | Reputation, legal | No hard SLA promise in MVP copy; fallback path in W7-T06 |
| R7 | VAT/IVA and invoicing for autónomos, plus platform reporting duties (DAC7) | Compliance | Scope with an accountant before M8 (W5-T09 is `[H]` for this reason) |
| R8 | Agents colliding on `schema.prisma` and `packages/contracts` | Velocity | Ownership map §4 + ADR escalation §5.7; watch for it in week one |
| R9 | Google Maps cost at scale | Cost | Cache geocoding, use PostGIS for radius queries, Maps only for display/autocomplete |
| R10 | Insurance / liability for damage caused by a manitas | Legal | Out of MVP scope; ToS must be explicit about the platform's role |
| R11 | Ledger/run-record discipline decays under deadline pressure | Loses the quality signal | Both are **CI gates**, not conventions — see §5.2 and §5.6 |
| R12 | Flagsmith free tier is 50k requests/mo and 1 seat | Flags stop resolving | Server-side evaluation + caching only; never evaluate per client request (ADR-007) |
| R13 | Fly has no Spain region (nearest Paris ~25ms) | Latency | Acceptable at MVP; revisit if users complain |
| R14 | Preview envs branched from real data would leak PII/licences | GDPR breach | Previews branch only from **sanitised** staging (`W0-T20`); prod is a separate Neon project |
| R15 | Flags accumulate and rot into dead code paths | Maintainability | Removal task ID on every flag; 4 weeks at 100% rollout ⇒ cleanup task (ADR-007) |
| R16 | The SPA → SSR "switch" rots into a rewrite because the route rules stayed conventions | Landing pages ship late, slow, or never — and they are half of R3's answer | The six rules are lint + a DOM-free route-module test in `W12-T01`, landed **before** there are components to retrofit (ADR-011) |
| R17 | Every slice invents its own button; accessibility arrives as a `W10-T05` audit at the end | Thirty components to retrofit at the most expensive possible moment | `packages/ui` is the only place a component is defined, and axe runs per story per PR (ADR-012) |
| R18 | A client-rendered storefront is indexed badly or late by Google | No organic acquisition, which is the only cheap channel before there is supply to advertise | Curated landing matrix, server-rendered by `W12-T14`; search results deliberately `noindex, follow` to protect them from thin-content dilution |

## 10.1 Business decisions register — `[B]`

**You address these; agents must not invent them.** Each is a board ticket labelled
`decision:business`, and each blocks the listed tasks from *shipping* — not from being built. The
rule: build the mechanism, read the value from config, ship nothing with an invented number.

| ID | Decision | Blocks | Notes |
|---|---|---|---|
| `BD-01` | ✅ **Escrow — do we hold client funds until job completion?** | `W5-T02`, `W4-T09` | **Answered 2026-09-20 by ADR-013 §4, and the answer is smaller than either option in this row: there is nothing to escrow.** One payment passes through — the call-out fee, captured at award and released when the client approves the start of work, which is where platform revenue is realised. **The job's own price never touches the platform** (operator: *"Platform revenues is on the start of work"*), so the question of holding it does not arise, and neither does being a financial entity. `R1` before `M8` still applies and should look hardest at `BD-04`'s all-or-nothing forfeiture, plus the platform's own facilitator reporting obligations (§4.1) |
| `BD-02` | Platform take rate — flat %, or reduced for subscribers? | `W5-T04`, `W5-T08` | Drives unit economics and the tier value proposition |
| `BD-03` | What do PLUS and PREMIUM actually buy? (quote volume, radius, ranking boost, badge, lead priority) | `W5-T07`, `W5-T08`, `W3-T05` | Ranking boost has a fairness cost — decide deliberately |
| `BD-04` | Cancellation & refund policy | `W5-T05` | **Half answered 2026-09-20: forfeiture is all-or-nothing**, not time-banded (operator, ADR-013 §5). Still open, and unmodelled: **how the fee divides** between platform revenue and the professional's reserved time — and it is **one question with two triggers**, since the same split applies whether the fee is *released* at approval or *forfeited* at cancellation. Modelling it once answers both. The enforceability risk of the all-or-nothing choice is in ADR-013's Consequences |
| `BD-05` | Emergency pricing — call-out fee + hourly, or a premium multiplier? | `W7-T01` | Affects the whole urgency flow's UX |
| `BD-06` | Do **manitas** need verification (ID check), or only licensed pros? | `W8` scope, `W2-T05` | Trust vs. supply-side friction; affects cold start |
| ~~`BD-07`~~ ✅ | Which categories legally require a licence in Spain? | `W3-T01`, `W3-T08` | **Answered 2026-09-18: five trades** — `electricidad`, `gas`, `climatizacion`, `telecomunicaciones`, `placas-solares`. And a rule worth more than the list: **a licence attaches to the trade performed, not to the umbrella above it** — `reforma-integral` is *not* gated, because tiling and wall work need nothing and rewiring is gated as `electricidad`. `W3-T08` inherits the evasion that permits, stated in `docs/specs/S3/W3-T01-category-tree.md` §3.5.1/§10.3. `desatascos` is `false` **provisionally** — the operator is checking with the gremio, and asking whether it exposes an API for registration lookups, which would turn `W8-T02`'s human review into a call |
| `BD-08` | How aggressive is anti-disintermediation? | `W13` (was `W4-T08`) | Too strict harms UX, too loose leaks revenue. **Reframed 2026-09-20**: the question is no longer only *how much to mask* but *what unlocks it* — a paid booking or a subscription — and what non-paying users can do instead. **The detection half is answered by ADR-013** and needs no masking at all: make leaving cost a forfeited fee, attest the start with a handshake, reconcile the rest. What stays with `W13` is *access* — who may contact whom, and what a subscription buys |
| `BD-09` | Auction defaults: sealed vs open, anti-sniping window, bid caps per tier | `W6-T04`, `W6-T07` | |
| `BD-10` | Badge qualifying rules + minimum reviews before an average is shown | `W8-T04`, `W8-T06` | |
| `BD-11` | Support impersonation policy (GDPR-sensitive) | `W9-T02` | Consent, time-box, audit |
| `BD-12` | Target beta city/region | `W10-T01`, supply recruitment | Also shapes seed data |
| `BD-13` | VAT/IVA invoicing rules for autónomos + DAC7 reporting | `W5-T09` | Needs an accountant, not a decision alone |
| `BD-14` | GDPR data retention periods per entity | `W2-T08` | |
| `BD-15` | **Landing-page content**: which categories × which cities we publish, and where the prose comes from — headless CMS vs MDX in the repo | `W12-T13`, `W12-T14`, `W12-T17` | The SEO surface, and half the cold-start answer (R3). A *curated* list, never a loop over every pair. Distinct from the W9 back office: a CMS is for marketing content, never for the ops console |

---

## 11. The `agents/` folder — system-wide prompts

✅ **Built** (`W0-T11`, this session) — see `agents/README.md`. Built **before** any slice agent runs. One source of truth for how agents behave;
Claude Code subagent definitions in `.claude/agents/` are **generated from** `agents/roles/`, never
hand-maintained in parallel.

```
agents/
├─ AGENTS.md              # loaded by every agent, every task. Contains:
│                         #  - the §5 pipeline as hard rules
│                         #  - TDD is mandatory: red phase pasted into the run record
│                         #  - contract-freeze law: never touch schema.prisma or
│                         #    packages/contracts outside your slice without an ADR
│                         #  - branch naming, spec + run-record requirement
│                         #  - what you may NOT do: no secrets, no prod, no `[H]` tasks,
│                         #    no merging your own PR, no editing another slice's folders
│                         #  - how to escalate instead of guessing
│                         #  - Definition of Done, verbatim
├─ roles/
│  ├─ agent-devops.md     # each: mission, owned paths, forbidden paths, required skills,
│  ├─ agent-contracts.md  #        gates it must pass, who reviews it, escalation targets
│  ├─ agent-identity.md
│  ├─ agent-providers.md
│  ├─ agent-discovery.md
│  ├─ agent-jobs.md
│  ├─ agent-auctions.md
│  ├─ agent-emergency.md
│  ├─ agent-money.md      # strictest: two reviewers, ledger mandatory, no live keys ever
│  ├─ agent-trust.md
│  ├─ agent-ui.md
│  ├─ agent-qa.md
│  └─ agent-admin.md
├─ prompts/
│  ├─ 00-spec-authoring.md      # produces docs/specs/<slice>/<TASK-ID>-<slug>.md
│  ├─ 01-contract-proposal.md   # produces the zod/Prisma diff for agent-contracts
│  ├─ 02-tdd-red.md             # write failing tests from acceptance criteria only
│  ├─ 03-implement-green.md     # minimum code to pass; no scope creep
│  ├─ 04-refactor.md
│  ├─ 05-code-review.md         # the three-axis review of §5.4
│  ├─ 06-spec-review.md
│  ├─ 07-intervention-triage.md # turns a rejection into a ledger entry + corrective action
│  └─ 08-run-record.md          # the .run.md template
├─ policies/
│  ├─ contract-change.md        # the only legal way to move the seam
│  ├─ escalation.md             # when to stop and ask instead of guessing
│  ├─ human-boundaries.md       # the [H] list: secrets, billing, legal, prod, live keys
│  ├─ memory.md                 # the two memory layers and the promotion path (§5.8)
│  └─ review-and-merge.md       # who approves what, when two approvals are required
└─ prompts/09-memory-write.md   # session memory + promotion to long-term
```

`scripts/generate-claude-agents.ts` renders `.claude/agents/*.md` from `roles/`; CI gate
`agents-drift` fails if they diverge. Generated subagent files are build output — never hand-edited.

**Versioned like code.** A prompt template change is a PR, reviewed like any other, and the
intervention ledger is the evidence used to justify it. When `docs/interventions/ROLLUP.md` shows
repeated `prompt-gap` for one agent, the fix lands in `agents/prompts/` and we watch the rate.

---

## 12. Immediate next actions

1. **You**: answer the five open questions in §10.
2. **You**: clear the `[H]` human blockers listed at the top of §6 — nothing agent-side can deploy
   until these exist.
3. ✅ **Done**: `W0-T11` + `W0-T14` — `agents/` (AGENTS.md, 5 policies, 10 prompts, 13 charters),
   `memory/` (index, repo facts, per-slice files, session template), and the
   `.claude/agents` generator. Review these next.
4. `agent-devops` then takes **W0-T01 → W0-T22** (M0). Nothing else starts until preview envs and
   the `spec-present` / `intervention-logged` gates are live.
5. `agent-contracts` writes the first 5 ADRs and `W1-T05` core schema in parallel.
6. Import §6 into the board: one card per task ID, grouped by workstream, labelled by owning agent
   **and** by `[H]`/`[M]`/`[A]`.
