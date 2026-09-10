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
| Frontend | **Vite + React + TypeScript** (SPA), separate from the API |
| Sharetribe | **Design/UX reference only.** We read the Sharetribe Web Template for flow design, search UX, Stripe + Google Maps integration patterns. We do **not** run their backend and do **not** fork their app. |
| Repo | pnpm monorepo, single repo, single CI |
| Market | **Spain first.** ES + EN i18n, EUR only |
| Payments | **Stripe Connect Express** — pro onboarding/KYC, platform-held funds, split payouts, Stripe Billing for pro subscriptions |
| Geo | PostgreSQL + **PostGIS**, Google Maps Places/Geocoding on the client |
| Process | **Strict**: spec → frozen contract → **TDD** → implementation → review, one owning agent per vertical slice |
| Traceability | Every branch carries its spec **and** its agent run record; every human intervention is logged |
| Code host | **GitHub** + **GitHub Actions** for CI (Codeberg was considered; its CI needs a self-hosted runner or a different Woodpecker syntax — not worth the friction at MVP) |
| Hosting | **Neon** (Postgres, branch-per-PR) · **Fly.io** (API) · **Cloudflare Pages** (web) · **R2** (objects) — see `docs/adr/ADR-006` |
| Feature flags | **Flagsmith** free tier behind the **OpenFeature** SDK — see `docs/adr/ADR-007` |
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
│     ├─ src/shared/       # design system, hooks, api client (generated)
│     └─ src/routes/
├─ packages/
│  ├─ contracts/           # ⚠️ THE FROZEN SEAM: zod schemas + OpenAPI + generated client
│  ├─ ui/                  # design-system primitives
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
Nightly on staging: full e2e suite, seed reset, Stripe webhook replay.

### 5.6 Human intervention ledger — *nothing manual goes unrecorded*

If a human rejects, overrides, or hand-edits agent work, it gets written down. This is the
dataset that tells us which agents and which prompts are weak.

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
| `OPS-14` | Email provider (Resend/Brevo) + verified sender domain | test email delivered | `W2-T01` |
| `OPS-15` | SMS provider (Twilio) + Spanish sender | test SMS delivered | `W2-T06`, `W7-T04` |
| `OPS-16` | Domain + DNS pointed at Cloudflare | staging hostname resolves | `W0-T07` |
| `OPS-17` | Per-environment encryption data keys generated and stored in Fly secrets | keys present, never in repo | `W0-T18` |
| `OPS-18` | **Stripe live** account + KYC + bank details — *only before M9* | live keys in `production` env | launch |

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

### W1 — Contracts & domain foundation (`agent-contracts`)
- `W1-T01` `[A]` ✅ Error envelope + error-code registry — frozen in `packages/contracts` as a zod schema, `details` typed per code, explicit HTTP status→code table *(issue #55)*
- `W1-T02` `[A]` ✅ Pagination, sorting, filtering conventions — cursor (keyset) paging only, a per-endpoint sortable allow-list with `id` appended as the tiebreaker, flat typed filters, and `{ items, page: { nextCursor, hasMore } }` with no `total`; the lexicographic keyset predicate lives in the seam as provider-neutral data *(issue #56)*
- `W1-T03` `[A]` zod → OpenAPI generation + typed client codegen
- `W1-T04` `[A]` Contract-test harness (spin API, assert every route matches OpenAPI)
- `W1-T05` `[A]` Core Prisma schema: User, profiles, Category, geo columns + PostGIS indexes
- `W1-T06` `[A]` ✅ Money value object — integer cents in `packages/contracts`, `prorate` and `allocate` the only two rounding sites, bounded at `Int32` because that is what Prisma `Int` is *(issue #60)*
- `W1-T07` `[A]` State-machine helper (transition table + guard + audit log emit)
- `W1-T08` `[M]` ADR template + first 5 ADRs (stack, contracts seam, money, geo, auth) *(human: sign off on the money + auth ADRs)*
- `W1-T09` `[A]` Shared test factories + fixtures in `packages/testing` (TDD prerequisite for every slice)

### W2 — Identity & access (`agent-identity`)
- `W2-T01` `[A]` Signup/login (email+password), email verification, password reset
- `W2-T02` `[A]` Sessions: httpOnly refresh cookie + short-lived access token, rotation, revoke
- `W2-T03` `[A]` Roles & permissions matrix + route guards + tests for every 403
- `W2-T04` `[A]` Client profile CRUD, addresses, saved locations
- `W2-T05` `[A]` Provider signup flow (MANITAS vs PRO, different required fields)
- `W2-T06` `[M]` Phone verification (SMS), required for providers *(human: SMS provider account + credentials)*
- `W2-T07` `[A]` Rate limiting, brute-force lockout, audit log on auth events
- `W2-T08` `[M]` `[B]` GDPR: export my data, delete my account (soft-delete + anonymise) *(human: retention policy decision)*

### W3 — Providers & discovery (`agent-providers`, `agent-discovery`)
- `W3-T01` `[M]` `[B]` Category tree + seed data for reformas/mantenimiento/urgencias, `requiresLicence` flag *(human: which categories legally require a licence in ES)*
- `W3-T02` `[A]` Provider profile: bio, categories, radius, rates, working hours
- `W3-T03` `[M]` Portfolio: image upload (S3 presigned), ordering, per-item category *(human: bucket + CDN credentials)*
- `W3-T04` `[A]` Listing CRUD with price model
- `W3-T05` `[A]` Geo search API: radius + category + price + rating + availability, PostGIS `ST_DWithin`
- `W3-T06` `[M]` Search results UI: list + map (Google Maps), clustering, mobile-first *(human: Maps API key + billing + quota)*
- `W3-T07` `[A]` Provider public profile page: badges, portfolio, reviews, response time
- `W3-T08` `[A]` Licence gating: `requiresLicence` categories only surface verified pros
- `W3-T09` `[A]` Availability calendar (weekly hours + blocked dates)

### W4 — Jobs & presupuestos (`agent-jobs`)
- `W4-T01` `[A]` Job posting flow: category, description, photos, location, budget, urgency
- `W4-T02` `[A]` Job state machine: `DRAFT → OPEN → AWARDED → IN_PROGRESS → COMPLETED / CANCELLED`
- `W4-T03` `[A]` Quote submission (one active quote per pro per job, validity window)
- `W4-T04` `[A]` Quote comparison UI for the client + accept/reject
- `W4-T05` `[A]` Award → creates Booking (hand-off to S9)
- `W4-T06` `[A]` Job-scoped message thread + attachments
- `W4-T07` `[A]` Job feed for providers: matched by category + radius + licence status
- `W4-T08` `[M]` `[B]` Anti-disintermediation: mask contact details until booking is paid *(human: how aggressive to be — product call)*

### W5 — Money (`agent-money`) — *the highest-risk slice, staff it first*
- `W5-T01` `[M]` Stripe Connect Express onboarding for providers, KYC status sync *(human: Stripe account, Connect config, branding)*
- `W5-T02` `[A]` `[B]` Booking creation + PaymentIntent (manual capture) + 3DS handling
- `W5-T03` `[M]` Webhook endpoint: idempotent, signature-verified, replayable, dead-letter queue *(human: register endpoint, supply signing secret)*
- `W5-T04` `[M]` `[B]` Completion → capture → transfer to provider minus platform fee *(human: **decide the take rate**)*
- `W5-T05` `[M]` `[B]` Cancellation & refund policy engine (time-based tiers) + partial refunds *(human: define the policy)*
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
- `W8-T05` `[A]` Reviews: only after a completed paid booking, both directions, edit window
- `W8-T06` `[M]` `[B]` Rating aggregation + display rules (min N reviews before showing an average) *(human: N and the display policy)*
- `W8-T07` `[A]` Moderation: report content, hide/remove, appeal trail

### W9 — Admin & ops (`agent-admin`)
- `W9-T01` `[A]` Admin auth + audit trail on every admin action
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

---

## 7. Testing strategy

TDD is not optional here: the red phase is a **Definition-of-Done artifact** (§5.3) and every slice
agent loads the `test-driven-development` skill at task start.

| Layer | Tool | Owner | TDD? | Runs |
|---|---|---|---|---|
| Unit (services, state machines, money, badge rules) | Vitest | slice owner | **required** | every PR |
| Contract (route ⇄ OpenAPI ⇄ generated client) | Vitest + supertest | `agent-contracts` | **required** | every PR |
| Integration (API + real Postgres in docker) | Vitest + testcontainers | slice owner | **required** | every PR |
| Component (React) | Vitest + Testing Library | slice owner | required for logic-bearing components | every PR |
| E2E | Playwright against preview env | `agent-qa` | written from the spec's acceptance criteria, before the feature | smoke on PR, full nightly |
| Payments | Stripe test mode + webhook replay fixtures | `agent-money` | **required** | every PR touching S9 |
| Concurrency | targeted race tests (emergency accept, auction close, quote accept) | slice owner | **required** | every PR touching S7/S8 |
| Load | k6 on search + broadcast | `agent-devops` | n/a | pre-launch + nightly |
| A11y | axe in Playwright | `agent-ui` | n/a | nightly |

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

**Critical path**: human blockers (§6) → M0 → M1 → M3 (money). Everything else parallelises after M1.
Staff `agent-money` from M0 so Stripe Connect onboarding is already in review when M2 finishes.

**Parallelisation after M1**: `agent-discovery` (W3) ‖ `agent-money` (W5) ‖ `agent-trust`
(W8-T01/T02) ‖ `agent-ui` (design system) ‖ `agent-qa` (W10-T01 seeds).

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
| R4 | Disintermediation: users take the job off-platform after matching | Revenue | Mask contact details pre-payment (W4-T08); measure the leak rate |
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

## 10.1 Business decisions register — `[B]`

**You address these; agents must not invent them.** Each is a board ticket labelled
`decision:business`, and each blocks the listed tasks from *shipping* — not from being built. The
rule: build the mechanism, read the value from config, ship nothing with an invented number.

| ID | Decision | Blocks | Notes |
|---|---|---|---|
| `BD-01` | **Escrow — do we hold client funds until job completion?** | `W5-T02`, `W5-T04` | The keystone decision. Yes ⇒ manual capture + delayed transfer, and R1 legal review before M8. No ⇒ pay-on-completion direct to the pro, far simpler, weaker client protection |
| `BD-02` | Platform take rate — flat %, or reduced for subscribers? | `W5-T04`, `W5-T08` | Drives unit economics and the tier value proposition |
| `BD-03` | What do PLUS and PREMIUM actually buy? (quote volume, radius, ranking boost, badge, lead priority) | `W5-T07`, `W5-T08`, `W3-T05` | Ranking boost has a fairness cost — decide deliberately |
| `BD-04` | Cancellation & refund policy tiers | `W5-T05` | Time-based bands, who bears the fee |
| `BD-05` | Emergency pricing — call-out fee + hourly, or a premium multiplier? | `W7-T01` | Affects the whole urgency flow's UX |
| `BD-06` | Do **manitas** need verification (ID check), or only licensed pros? | `W8` scope, `W2-T05` | Trust vs. supply-side friction; affects cold start |
| `BD-07` | Which categories legally require a licence in Spain? | `W3-T01`, `W3-T08` | Legal boundary, not a UI hint |
| `BD-08` | How aggressive is anti-disintermediation? | `W4-T08` | Too strict harms UX, too loose leaks revenue |
| `BD-09` | Auction defaults: sealed vs open, anti-sniping window, bid caps per tier | `W6-T04`, `W6-T07` | |
| `BD-10` | Badge qualifying rules + minimum reviews before an average is shown | `W8-T04`, `W8-T06` | |
| `BD-11` | Support impersonation policy (GDPR-sensitive) | `W9-T02` | Consent, time-box, audit |
| `BD-12` | Target beta city/region | `W10-T01`, supply recruitment | Also shapes seed data |
| `BD-13` | VAT/IVA invoicing rules for autónomos + DAC7 reporting | `W5-T09` | Needs an accountant, not a decision alone |
| `BD-14` | GDPR data retention periods per entity | `W2-T08` | |

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
