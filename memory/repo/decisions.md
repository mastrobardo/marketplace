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

### There is no superuser, and the role that sees money is not the role that moderates

- **id**: MEM-2026-09-18-2
- **scope**: repo
- **fact**: `ADMIN` gets no implicit bypass in the permissions matrix — it is allowed exactly the
  operations that list it, and today that is none. The operator's condition on that (2026-09-18):
  *"either a super admin or a way to actually have money permissions is required: someone should be
  able to look into transactions."* So the capability is not optional; what is decided is **how it
  arrives** — as an explicit grant to a role of its own, added with the first route that reads
  money, never by widening `ADMIN`.
- **why**: `W9-T04` hands `ADMIN` to content moderators while `W9-T03` and `W9-T05` read refunds,
  payouts and GMV. One role for both means one grant is every power, and `W9-T01`'s audit trail
  cannot then tell a moderator from a treasurer. A blanket admin branch in the guard is the version
  of this that nobody ever reviews, because it never appears in a diff.
- **apply**: adding a permission to `apps/api/src/modules/auth/permissions.ts` happens in the same
  PR as the route that guards with it — a cell no route enforces is the same empty promise as a
  column nothing writes to. For a money operation, add the role too (an additive `UserRole` enum
  member, `agent-contracts`' migration) rather than a cell under `ADMIN`. `W5-T10` must exist first:
  there are no transactions to read while the schema ends at `AuditRecord`.
- **evidence**: `docs/specs/S2/W2-T03-route-guards.md` §3.5, §3.5.1, AC7/AC15
- **status**: active

### A suspended, blocked or deleted user resolves to nothing at all

- **id**: MEM-2026-09-18-3
- **scope**: repo
- **fact**: Operator's rule, 2026-09-18: *"a suspended/blocked/deleted user should return no data.
  Not even `deletedAt`."* The guard establishes liveness with a `where: { status: 'ACTIVE',
  deletedAt: null }` on the user read — the state is in the predicate, so it never becomes a value —
  and the principal on the request is `{ userId, roles, sessionId }` and may never gain an
  account-state field. Such a request is `401`, byte-identical to one carrying no cookie.
- **why**: a flag on the principal is a flag some later route branches on, and the first branch that
  says something different for a suspended user than for a signed-out one is a state oracle on every
  endpoint — in the slice whose non-negotiable is that "unknown email" and "wrong password" are
  indistinguishable. Filtering instead of reporting also removes a dependency on whether
  better-auth's read path returns `additionalFields`, which is a property of the version we are on.
- **apply**: never carry `status` or `deletedAt` past the session adapter, and never answer
  `403 ACCOUNT_SUSPENDED`. Anything that needs to *tell* a person their account is suspended is a
  deliberate, separate surface (`W2-T08`/`W9`), not a code on an ordinary route.
- **evidence**: `docs/specs/S2/W2-T03-route-guards.md` §3.3, AC4/AC8/AC9/AC16
- **status**: active

### `MANITAS`/`PRO` is a kind and a trade is a category — neither is ever a role

- **id**: MEM-2026-09-18-4
- **scope**: repo
- **fact**: Providers come in two main types, *manitas* and *profesionales*, and trade subtypes
  (electricista, fontanero, …) are coming. Operator, 2026-09-18. None of them is a `UserRole`:
  `UserRole` is `CLIENT | PROVIDER | ADMIN` (`schema.prisma:41`), the type is
  `ProviderProfile.kind` (`ProviderKind`, `schema.prisma:58`), and a trade is a row in the
  `Category` tree reached through `ProviderCategory`. "May work a gated category" is a third thing
  again — an approved `Certification` plus `Category.requiresLicence` (`W3-T08`, `BD-07`).
- **why**: roles answer *who is asking* and are resolved from the session before any repository
  runs; kind and categories are properties of a **row**. A permission keyed on either would force
  the guard to read data on every request, and a role per trade would put a legal claim
  (`requiresLicence`) into a cookie where `agent-trust`'s verification cannot see it.
- **apply**: `apps/api/src/modules/auth/permissions.ts` is typed
  `Record<string, readonly UserRole[]>`, so a `'MANITAS'` cell is a compile error — asserted with
  `@ts-expect-error` in `permissions.test.ts` (AC17). A rule that depends on kind, category or
  certification belongs in the route **after** the row is read, like ownership. **`TODO.md` §3's
  domain sketch is wrong on this** — it lists `role(s) CLIENT | MANITAS | PRO | ADMIN` on `User`,
  which no migration ever implemented; the schema is the artefact in force and the sketch is
  `agent-contracts`' to correct.
- **evidence**: `docs/specs/S2/W2-T03-route-guards.md` §3.5.2; `memory/repo/glossary.md`
- **status**: active

### Category names are columns today, and are meant to become i18n keys

- **id**: MEM-2026-09-18-13
- **scope**: repo
- **fact**: `Category.nameEs` / `Category.nameEn` hold display strings in the database
  (`apps/api/prisma/seed/categories.ts` seeds twenty pairs like
  `nameEs: 'Desatascos', nameEn: 'Drain unblocking'`). The operator's stated direction, 2026-09-18,
  is that these belong in the i18n layer instead — a category carries a **key**, and the catalogues
  in `apps/web/src/i18n/locales/{es,en}.ts` carry the words. The English key is expected to be the
  short noun (`drain`), not the current column value (`Drain unblocking`).
- **why**: three things follow from it that are not obvious from the column alone.
  1. **The wire contract already hides this.** `CategorySummarySchema` is
     `{ slug, name, requiresLicence }` with the locale resolved at the route (`W3-T01` §3.7), so
     moving names out of the table is a storage-and-seeder change with **no contract change and no
     consumer change**. That is why it can wait, and it is the reason to keep resolving locale
     server-side rather than shipping the pair.
  2. **The slug is an identifier, the names are labels, and only one of them is safe to change.**
     Slugs are Spanish today (`fontaneria`, `desatascos`) and they are load-bearing: they appear in
     URLs (`?what=fontaneria`), in `W3-T02`'s slug→id resolution on every profile write, in
     `provider_category`, and in the four fixed demo uuids `MEM-2026-09-18-1` pins. An English key
     namespace does **not** imply renaming slugs — that is a breaking change with a migration, and
     a relabel is not.
  3. **It conflicts with making the back office the taxonomy's writer**, which the operator also
     raised on 2026-09-18. The i18n catalogues have a *compile-time* completeness guarantee —
     `apps/web/tests/fixtures/{unknown-key,incomplete-catalogue}` exist to prove `tsc` fails on a
     missing key — while the columns are checked only at runtime, by the outbound zod parse that
     turns a bad row into a 500 (`W3-T01` AC11). Moving to keys **upgrades** that guarantee, but an
     admin who can create a category at runtime cannot be given a compile-checked key for it. The
     two directions are mutually exclusive for the same string; choosing either decides the other.
- **apply**: do not "fix" the name columns opportunistically — the change is cheap on the wire and
  expensive in the seeder, and it is blocked on the authoring question above, not on effort. If the
  back office wins, names stay data and the columns are correct as they are.

  **The back office won.** Operator, 2026-09-19, asking for a full CRUD over the taxonomy
  (`W3-T11`): a category created by an admin at runtime cannot be given a compile-checked catalogue
  key, so **the i18n-key direction does not apply to category names** and `nameEs`/`nameEn` stay as
  they are. Recorded rather than treated as final — the two remarks were made a day apart and the
  operator may not have connected them, so **confirm this at `W3-T11`'s start** before building on
  it. Everything above about the slug being an identifier is unaffected and still holds.
- **evidence**: operator, 2026-09-18, on `apps/api/prisma/seed/categories.ts:107`;
  `W3-T01` spec §3.7, §9; `packages/contracts/src/catalogue.ts`
- **status**: active


### Seeded fixtures are the test substrate; a sanitised dump is a debugging instrument
- **id**: MEM-2026-09-19-2
- **scope**: repo
- **fact**: Deployed environments get their data from the **seed pipeline**, not from a copy of
  production. The operator asked at `W0-T30` whether an anonymised production dump would be needed
  instead, or as well, in order to reproduce production edge cases in preview or staging. The
  answer recorded here is *both, but not interchangeably*:
  1. **Fixtures are what tests assert against**, and a dump cannot replace them. Anonymised rows
     are non-deterministic, so an e2e test can assert shapes and never values; a seeded taxonomy
     lets a test say `toBe('gas')`.
  2. **A dump is for discovery** — real shape, real volume, the accented surname and the 400-character
     address nobody thought to write. That is a genuine need and `W0-T20` owns it.
  3. **The durable answer to a production edge case is a regression seeder, not the dump.** The dump
     helps you *find* the case; a seeder is how you *keep* it — it is in git, it runs in CI for
     ever, and it needs no sanitisation pipeline to stay alive.
- **why**: Sanitisation is a permanent liability — one missed column is a GDPR breach, which is
  `R14` in the risk register — and it buys nothing that fixtures already provide for testing. The
  cost is worth paying for debugging fidelity, and only for that. There is also no production to
  dump yet, so building the pipeline now would be guessing at the shape of data that does not exist.
- **apply**: Do not propose copying production data into a test environment as a way of getting
  test data; add a seeder. When `W0-T20` builds the sanitised path, it is *additive* — the seed
  pipeline stays the source of truth for anything a test asserts on. A bug reproduced from
  production ships with a seeder that reproduces it.
- **evidence**: operator, 2026-09-19 (*"would a prd db dump (maybe anonymized) also be required? […]
  we might want to replicate […] some edge cases coming from PRD"*); `W0-T30` spec §1.2;
  `TODO.md` `R14`, `W0-T20`
- **status**: active

### A fixture that must not travel is a password problem, not a data problem
- **id**: MEM-2026-09-19-3
- **scope**: repo
- **fact**: `auth.demo-users` carried `localOnly: true` for a year of tickets, and the reason was
  never that its rows were fake — it was that its password is a literal in a public repository.
  `W0-T30` removed the flag and resolved the password from `SEED_DEMO_PASSWORD` instead, refusing to
  run against a non-local host when that is unset. No registered seeder is `localOnly` today; the
  flag stays in `Seeder` for `W0-T20`'s real cases.
- **why**: "Never leave the laptop" is a blunt answer that cost more than it protected: it made the
  seed pipeline useless in every deployed environment — `assertSafeTarget` refused the *whole* run
  over one flagged seeder — and staging still needed accounts QA could sign in as. Separating *the
  rows may travel* from *this credential may not* gets both.
- **apply**: Before marking a seeder `localOnly`, ask which part is actually unsafe. If it is a
  secret, take it from the environment and refuse loudly when it is missing. Reserve the flag for
  data that is unsafe **as data** — real personal information, real licence documents.
- **evidence**: `W0-T30` spec §2, §3.3; `apps/api/prisma/seed/auth-demo-users.ts`;
  `apps/api/tests/seed-filter.test.ts` AC8–AC11
- **status**: active

### An admin arrives from the back of the project, never through the front of the app
- **id**: MEM-2026-09-20-1
- **scope**: repo
- **fact**: Admin accounts are provisioned by a **separate process** — by hand, by script, by
  whatever `W9-T07` decides — and deliberately **outside the normal auth flow**. Operator,
  2026-09-20: *"we need to keep it outside normal generation of auth. An admin will be someone
  joining the project from the back, not the front of the app."* There is therefore **no admin
  registration route**, and no path by which a storefront signup can end in an `ADMIN` role.
- **why**: A self-service route to a privileged role is a privilege-escalation surface that has to
  be defended for ever. Not having one is cheaper and stronger than guarding one. It also matches
  who an admin actually is here: someone on the project, not a customer.
- **apply**: Never add `ADMIN` to anything reachable from `apps/web`'s signup, and never let a role
  grant ride along with a profile write. A seeded admin is fine and is wanted (`W9-T07`) — but it
  inherits `MEM-2026-09-19-3`: the password comes from a secret and the seeder refuses a non-local
  target without one. This is a privilege boundary, not merely an account.
- **evidence**: operator, 2026-09-20; `TODO.md` `W9-T07`; `apps/api/src/modules/auth/permissions.ts`
  (*"`ADMIN` is not implicit"*)
- **status**: active

### Admin actions get their own table — `AuditRecord` is a state-machine ledger, not an audit log
- **id**: MEM-2026-09-20-2
- **scope**: repo
- **fact**: Two separate records, on purpose. `AuditRecord` stays what it is: a **state-machine**
  ledger, `fromState`/`toState` non-null, *"written only through `transition()` in
  `@marketplace/contracts`"*. Admin actions get a **different table**, owned by `W9-T08`. Operator,
  2026-09-20: *"Admin action deserves it's own table. We must keep records for all users, but
  actions taken by an admin need their own flow."*
- **why**: An admin renaming a category is not a state transition, and there is no honest
  `fromState` for it. Forcing it into `AuditRecord` means either inventing pseudo-states
  (`"requiresLicence:false"`) or making the columns nullable — and the moment they are nullable, the
  guarantee that every row describes a real transition is gone, which is the only reason that table
  is worth trusting.
- **apply**: Do not reach for `AuditRecord` to log an admin action, a config change or anything
  without a state machine behind it. If `W9-T08` has not landed yet, the honest move is to leave the
  action unlogged and say so in the ticket — not to half-write it into the wrong table.
- **evidence**: operator, 2026-09-20; `apps/api/prisma/schema.prisma` `model AuditRecord`;
  `TODO.md` `W9-T08`
- **status**: active

### A working website comes before the audit trail, and before the back office
- **id**: MEM-2026-09-20-3
- **scope**: repo
- **fact**: Ordering set by the operator on 2026-09-20: *"the audit is not so important to get to an
  [MVP]. First thing, before getting a designer on board, is to have a full functional website"* —
  and *"Fully funtional: the feature of the websites (presupuestos, auctions, search) should be
  fully developed."* So `W4` and `W6` come first; `W9` (admin & ops) and `W3-T11` (back-office
  taxonomy CRUD) wait, however ready they are.
- **why**: A design pass on a site whose funnels do not work reviews the wrong thing, and an audit
  trail records actions nobody can yet take. Both are real work whose value is unlocked by the
  feature work, not the other way round.
- **apply**: When a ticket is blocked on something in `W9`, check whether it is *really* blocked or
  merely un-audited — `W9-T08` is explicitly not MVP-blocking. Do not propose back-office work as
  "next" while a funnel is unfinished. This ordering is a judgement about sequence, not about
  whether the deferred work matters; revisit it when the funnels close.
- **evidence**: operator, 2026-09-20; `TODO.md` §6 `▶ NEXT` banner
### A draft asks for nothing; publishing asks for one thing
- **id**: MEM-2026-09-20-4
- **scope**: repo
- **fact**: `W4-T01` split validation in two, and the split is the pattern for every "post something"
  flow that follows. A `DRAFT` requires **nothing but an owner** — every column nullable, `PUT`
  merges, `{}` is a valid body. Publishing requires **one thing**: at least one category, enforced
  by a guard on the `DRAFT → OPEN` transition rather than by the schema. Operator, 2026-09-20: *"A
  user should be able to complete a minimal flow even with missing parameters. I dont want to policy
  the users"*, and then *"at least category need to be there"*.
- **why**: The two instructions only look contradictory. A schema that required a category would
  make a draft impossible; a publish that did not would make an `OPEN` job that reaches nobody,
  because matching is by category — and the client would experience that as silence rather than as
  an error. The floor is *what the feature needs to function*, never *what a form looks complete
  with*. A description is not on the floor: a job without one is harder to quote, and that is the
  client's problem, not the platform's.
- **apply**: When adding a field to any posting flow, ask whether its absence **breaks the feature**
  or merely makes the result worse. Only the first earns a place at publish. New guard requirements
  go on the machine, not in a zod schema, so the draft stays reachable. `hasAnyCategory`'s context
  is a single count on purpose — if that interface grows a field, a requirement has been added.
- **evidence**: operator, 2026-09-20; `W4-T01` spec §2.2–§2.3; `packages/contracts/src/job.ts`
  `hasAnyCategory`; `apps/api/tests/job-live.test.ts` AC3/AC5
- **status**: active

### Rows written in one transaction share a timestamp, so insertion order is not a thing
- **id**: MEM-2026-09-20-5
- **scope**: repo
- **fact**: Postgres gives every row written inside one transaction the same `CURRENT_TIMESTAMP`, so
  a `created_at DEFAULT now()` column **cannot** order rows written together. `W4-T01` ordered a
  job's categories that way, fell through to the uuid tiebreak, and the set shuffled between reads.
- **why**: The bug is invisible in any test that inserts one row at a time, and it looks like it
  works locally until a second row lands in the same statement batch. It was caught only because an
  acceptance criterion asserted *stable order across two reads* rather than just "the right members".
- **apply**: Never order a join or child table by `createdAt` when the rows can be written together.
  Either add an explicit `position` column, or order by something inherent to the referenced row —
  `W4-T01` uses the category's own `position`, which also makes a job's categories read the same way
  the picker showed them. When asserting order, read **twice** and compare; one read cannot catch it.
- **evidence**: `W4-T01` run record deviation 2; `apps/api/src/modules/jobs/repository.ts`
  `JOB_INCLUDE`; `apps/api/tests/job-live.test.ts` AC8
- **status**: active

### Credential rotation runs on a 30-to-60-day cadence, which is what makes `W0-T32` deferrable
- **id**: MEM-2026-09-20-10
- **scope**: repo
- **fact**: Operator, 2026-09-20: *"a rotation shall happen every 30/60 days max, so no biggie."*
  That sets a cadence the repo did not have, and it is the reason `W0-T32` — making a seeded
  credential genuinely rotatable — is deferred rather than urgent: a procedure run six to twelve
  times a year can be manual.
- **why**: `W0-T31` found that a `*_SEED_DEMO_PASSWORD` cannot be rotated by changing the secret,
  because the seeder runs once per database and `_seed_run` skips it for ever after. That is a real
  defect, but its cost is a function of how often anyone hits it. At this cadence, hand-deleting a
  ledger row or re-branching is annoying, not blocking.
- **apply**: Deferred is **not** open-ended, and this entry exists so the deadline is not lost. The
  preview and staging demo passwords were set on **2026-09-20**, so the first rotation falls due
  between **2026-10-20 and 2026-11-19**. Until `W0-T32` lands, that rotation is manual ledger
  surgery on an environment QA is using — so `W0-T32` wants to land inside that window, not
  whenever the funnels happen to be finished. The cadence also applies to `*_BETTER_AUTH_SECRET`,
  where rotation *is* immediate and needs no ticket.
- **evidence**: operator, 2026-09-20; `TODO.md` `W0-T32`; `W0-T31` spec §3.4;
  `scripts/secrets/generate.ts` `rotationNote`
- **status**: active

### An engagement has three sources of truth, and the third is the only honest one

- **id**: MEM-2026-09-20-17
- **scope**: repo
- **fact**: A job's lifecycle, its booking and ledger, and **the handshake** (a code the client scans
  when work starts) are three independent records of one engagement. They are **reconciled, never
  coupled**: a job does not need its booking's permission to change state. ADR-013 is the decision;
  `W5-T11` grows the second dimension; `W4-T09` builds the handshake.
- **why**: money lags reality — a late webhook, a retried capture, a Stripe incident — so coupling
  the machines means a professional who finished the work cannot close the job because the plumbing
  is behind, which punishes the party who did nothing wrong. And the first two sources can each be
  produced by one party alone, so neither settles a dispute. The scan cannot: it takes both people
  in one place, which is what makes `IN_PROGRESS` *attested* rather than claimed.
- **apply**: when two lifecycles describe one real-world event, reconcile them and treat divergence
  as a **finding**, not as something to prevent. Before trusting a state, ask which party could have
  produced it alone. And do not add a fourth source without asking what it attests that the others
  cannot — this ADR's whole argument is that a source nobody can fake is worth more than two that
  agree.
- **evidence**: `docs/adr/ADR-013-engagement-reconciliation.md` §1, §2, §3
- **status**: active

### Disintermediation is priced and attested, not policed — and never by reading messages

- **id**: MEM-2026-09-20-18
- **scope**: repo
- **fact**: `R4` (users taking a job off-platform) is answered in this order: **charge before the
  work** (platform revenue is realised when the client approves the start, not at completion),
  **attest that moment** (the handshake), then **detect the residue** (`W5-T11`). Contact masking
  (`W4-T08`) is superseded, and **message scanning is rejected**. Because revenue lands at the
  start, a pair that goes off-platform *afterwards* costs the platform nothing — the leak shrinks
  to one signature: introduced, never approved, and the work happened anyway (ADR-013 §8).
  Supersedes the open question recorded as `MEM-2026-09-20-14` — a job *does* track `IN_PROGRESS`
  and `COMPLETED`, cross-verified rather than derived.
- **why**: scanning messages for phone numbers is evadable by anyone who writes *llámame al seis
  tres cuatro…*, and it inspects private conversations to solve a revenue problem. An economic
  footprint cannot be spelled around. The operator's framing, 2026-09-20, is the standard to hold
  it to: *"I need a mechanism to make this hard ( not completely unavoidable because real life is
  not 100% enforceable )"* — friction and daylight, not a lock.
- **apply**: the unit of suspicion is **the pair and the rate, never the single event** — one
  cancellation is weather. Any detector's output is a finding for a human, because it measures money
  and attestation and then *infers intent*. `W8-T05` (reviews only after a completed paid booking)
  is part of this system even though it is filed under trust: do not relax it for review volume
  without replacing what it does.
- **evidence**: `docs/adr/ADR-013-engagement-reconciliation.md` §8, §9; `TODO.md` `R4`, `BD-08`
- **status**: active

### The job's price never touches the platform, and a ban needs evidence a refund does not

- **id**: MEM-2026-09-20-19
- **scope**: repo
- **fact**: Three constraints from ADR-013, cheap to honour and expensive to retrofit.
  **(1)** **One payment passes through this platform** — the call-out fee, captured at award and
  released when the client approves the start of work. What the job costs is settled between the two
  people, in cash if they choose; the platform does not see it and does not police their invoicing
  (operator, 2026-09-20: *"I cannot and i should not enforce a correct facturation"*).
  **(2)** Revenue is realised at the start of work, never at completion.
  **(3)** A no-show claim **always refunds the client**, but flags the professional on the first
  upheld claim and bans on the second — and those are different decisions with different bars.
- **why**: (1) and (2) are what keep this a marketplace rather than a financial entity: there is no
  third-party money resting anywhere, so the question of holding it never arises. (3) is about
  asymmetric cost — refunding a false claim costs a call-out fee, while removing a tradesperson ends
  their income here and cannot be undone by an apology. And the client side cannot be defended by
  pattern detection at all: someone who remodels a bathroom once a decade never accumulates enough
  events, which the operator put as *"less than 1% of users will need to remode their bathrooms 4
  times per year"*.
- **apply**: never design a flow where a client's payment for the *work* rests anywhere in this
  system — the only money it handles is its own fee. Keep refund and sanction as separate decisions
  wherever a claim triggers both. A low sanction threshold is survivable **only if verification is
  cheap**, so the arrival attestation in `W4-T09` is a requirement of the two-strike rule rather
  than an enhancement to it. The one client-side detector worth having is a repeat-claim counter:
  it catches multi-property owners, who are the only clients with the volume to scam repeatedly —
  the operator's own observation. Related trap in ADR-013 §4: **card authorizations expire after
  roughly a week**, so the fee is captured, not held.
- **evidence**: `docs/adr/ADR-013-engagement-reconciliation.md` §4, §4.1, §6, §6.1; `TODO.md`
  `BD-01`
- **status**: active

### The queue is never for sale — the supply side does not pay for position

- **id**: MEM-2026-09-20-23
- **scope**: repo
- **fact**: A professional never pays to quote, to be seen, or to be seen **first**. The demand side
  pays: *una tantum* per quote request or auction, or a client subscription, **metered per quote
  that actually arrives**. Position — the head start on a lead, and the prominent five on a job — is
  earned from completion rate, response time, no-show record, verified licence and fit, and cannot
  be bought at any price. Search and radius are never paywalled. ADR-014.
- **why**: the operator researched the incumbents from the demand side and found the mechanism, not
  just the price: *"credits system doesnt work, also because almost all platforms here in spain are
  pushed by big companies that can cover all the jobs."* Credits let capital buy the queue — a firm
  with a budget takes every lead, the autónomo cannot outspend it and leaves. A platform paid per
  *application* also earns more the worse each application's odds are, so the product degrades as it
  succeeds.
- **apply**: **any proposal to charge a provider must pass one test — would a firm with a budget end
  up ahead of a better small provider? If yes, it is the queue again**, whatever it is called. This
  catches the obvious form (credits) and the subtle one: a "PLUS provider fee" buying a three-hour
  head start on leads was proposed and rejected for exactly this reason, in the same conversation
  that diagnosed it. Charging the client is only allowed under the mirror rule: never bill for
  something that did not arrive, which is the same broken promise pointed the other way.
- **evidence**: `docs/adr/ADR-014-who-pays.md` §1, §2, §4; `TODO.md` `BD-02`, `BD-03`
- **status**: active

### Merit-based ranking has nothing to rank on day one

- **id**: MEM-2026-09-20-24
- **scope**: repo
- **fact**: ADR-014 §4 gives position to completion rate, response time, no-show record and reviews
  — **all of which are history, and at launch there is none**. Until it exists, position comes from
  the signals that need no history: **fit** (category match, distance, availability) and **verified
  licence**, which is earned on day one by uploading a document. Response time accrues within days.
- **why**: a principle that only works in year two is a principle that is absent exactly when first
  impressions are formed, and the silent failure mode is worse than an obvious one — merit-ordering
  with no data does not error, it just quietly falls through to whatever the tiebreak is, which in
  practice means insertion order or a random uuid — and `MEM-2026-09-20-5` is the proof that this
  class of bug ships: `W4-T01`'s category ordering looked correct and shuffled between reads.
- **apply**: whenever a design ranks by earned reputation, **write down what it does before anyone
  has any**, and make the fallback explicit rather than incidental. `W3-T05` already answers this
  correctly for search: a provider with no rating sorts as *unrated*, never as `0.00`, because a
  zero would rank a new provider below a bad one.
- **evidence**: `docs/adr/ADR-014-who-pays.md` §7; `packages/contracts/src/search.ts` `ratingAvg`
- **status**: active

### Reputation is two numbers that may disagree, plus tags the platform refuses to weight

- **id**: MEM-2026-09-20-25
- **scope**: repo
- **fact**: A provider carries a **satisfaction** score (about the person, shown as given) and a
  **competence** score **per trade** (its own row, optional per review). Neither is derived from the
  other and they are allowed to disagree. A trade with no scores is **absent from every average** —
  never zero, never a midpoint — and where an aggregate is shown it is the **mean of the per-trade
  means**, not of all reviews. Alongside them, **positive-only tags** (*tidy*, *quiet*, *on time*)
  that aggregate into counts. ADR-015.
- **why**: operator, 2026-09-20 — *"i could be the best electrician in the world, doing things in
  half the time, but leaving a mess behind me. How would the next user know?"* One figure cannot
  hold that, and averaging the trades together reproduces the same fault one level down: *"a score
  that catch all might be easier to read, but hide real bottlenecks."* Mean-of-means rather than
  mean-of-reviews is the difference between 4.0 and 4.92 for a provider who is excellent at fifty
  plumbing jobs and poor at two electrical ones — the second hides exactly what a client asking for
  electrical work needs.
- **apply**: **never introduce a blended reputation number**, however much easier it is to render;
  the blending is the defect. Do not weight the tags either — *"if i have a cleaner, the mess might
  not be a problem"*, so the weighting lives in the client's circumstances and the platform's job is
  to carry the facts. The one place a weighting is unavoidable is an ordered list (ADR-014 §4), and
  there the client can re-sort. Tags are positive-only on purpose: an absence of `tidy` says what is
  needed without publishing a negative claim about a named tradesperson.
- **evidence**: `docs/adr/ADR-015-reputation.md` §1, §3, §4; `TODO.md` `BD-10`, `W8-T05`, `W8-T06`
- **status**: active

### A tag vocabulary cannot be extended later without lying about history

- **id**: MEM-2026-09-20-26
- **scope**: repo
- **fact**: The review tag list in ADR-015 §4 is effectively permanent. **Old reviews cannot be
  retro-tagged**, so a tag introduced in year two shows near-zero counts on every established
  provider and reads as a weakness they do not have — while a genuinely new provider starts level.
  Adding a tag redistributes reputation backwards.
- **why**: the counts are the signal (*tidy (14)*), and a count is only meaningful against the
  number of reviews that *could* have carried it. Nothing in the data distinguishes "nobody thought
  this" from "this tag did not exist yet", and reconstructing it means storing the vocabulary's
  history and every review's exposure to it — machinery nobody will build retroactively.
- **apply**: choose the initial set deliberately and small, and treat any later addition as a
  migration problem rather than a config change: at minimum record the date a tag was introduced and
  exclude reviews written before it from that tag's denominator. **The same trap applies to any
  count-based signal introduced after launch** — badges with qualifying rules (`W8-T04`) and the
  no-show findings in ADR-013 §6 have the same shape.
- **evidence**: `docs/adr/ADR-015-reputation.md` §4.1; `TODO.md` `BD-10`
- **status**: active

### The platform states the facts and lets people choose — it does not enforce

- **id**: MEM-2026-09-20-20
- **scope**: repo
- **fact**: Where this product could either **block** a user or **tell them something and let them
  decide**, it tells them. Four decisions, four tickets, one rule:
  - `W4-T01` — one required field to publish. *"I dont want to policy the users."*
  - `W3-T01` §3.5.2 — a licence flag marks a verification, **never** an exclusion.
  - ADR-013 — disintermediation is priced and attested, not policed; the platform does not enforce
    the parties' invoicing.
  - `W4-T03` — no category gate on who may quote; the gap between what a job needs and what a
    provider lists is **shown** instead. Operator: *"i might not be verified as an electrician, but
    given my rates and past jobs recorded is up to the client to pick me or not. Nothing enforces,
    but stated clearly."*
- **why**: every one of those gates would also block the legitimate case — the plumber who brings an
  electrician, the client who knows what they want without filling in a form, the two people who
  settle in cash. A rule that stops the bad case by stopping the good one is a rule that makes the
  product worse at its job. What is left, and what makes it work, is that the platform must then
  **say the true thing plainly**: an unenforced gap that is also hidden is not this principle, it is
  negligence.
- **apply**: when a ticket reaches "should we block X", the answer here is usually "show it".
  Reach for enforcement only where the harm is irreversible or somebody else's — money leaving,
  a safety claim nobody can check, a person being misled about who they are dealing with. And
  whenever you choose to show rather than block, **check that the thing you are showing is true
  today**: `W4-T03` nearly shipped a `verified` field that nothing in the schema could populate,
  which would have been the appearance of this principle without the substance.
- **evidence**: `docs/specs/S4/W4-T03-quote-submission.md` §2.2, §2.3;
  `docs/adr/ADR-013-engagement-reconciliation.md` §4.1; `W3-T01` §3.5.2; `W4-T01` §1.1
- **status**: active
