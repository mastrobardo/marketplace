# W0-T30 — Seed data that can actually reach a deployed database

- **Slice**: S0 Platform (`agent-devops`)
- **Decides**: how a seeder reaches preview and staging without a developer fixture reaching them
  too, and where the line between *seeded fixtures* and *sanitised production data* falls.
- **Unblocks**: `W3-T11` (back-office CRUD over the taxonomy — a taxonomy nobody can seed is a
  taxonomy nobody can edit in a deployed environment), and every e2e funnel `agent-qa` has yet to
  write.

---

## 1. Purpose

`pnpm db:seed` cannot reach preview or staging, and no deploy workflow tries. Two independent
reasons, both live today:

1. **The safety gate judges the registry, not the run.** `assertSafeTarget`
   (`apps/api/prisma/seed/run.ts:38`) filters *every registered seeder* for `localOnly` and throws
   if it finds one. `auth.demo-users` is `localOnly: true`, so the whole run is refused against a
   non-local host — including `categories.taxonomy`, which is deliberately **not** `localOnly`
   precisely so that a preview can hold the real vocabulary.
2. **No deploy runs it.** `deploy-preview.yml` and `deploy-staging.yml` run `db:migrate:deploy` and
   stop.

The visible symptom, since `W3-T01` deleted MSW: `GET /api/categories` answers `200 {"items": []}`
on both environments and the storefront renders an empty category grid and an empty facet rail.
Both workflows carry a comment explaining this and instructing the next person not to paper over it
with a mock. This ticket removes the reason for those comments.

### 1.1 What the operator asked for, 2026-09-19

> *"staging should reach staging at least with some test users, and data which allows QA to test
> […] let's seed all the datas we need to complete e2e for each funnels (a user, a manita, later an
> auction, etc etc), and add it as a condition for features (ie: when developing the auction, i need
> to add test data to actually check the feature)"*

Two things, and they are separable. The first is this ticket: staging and preview get the taxonomy,
the demo users and the demo provider world. The second is a **process rule** — a feature ships with
the seed data that exercises it — which lands in the Definition of Done (§3.6) so every future
ticket inherits it instead of relying on someone remembering.

### 1.2 The question the operator raised: fixtures, or an anonymised production dump?

> *"is it a good idea? or would a prd db dump (maybe anonymized) also be required? […] we might want
> to replicate, either in preview or staging, some edge cases coming from PRD"*

**Both, eventually. They are different instruments and only one is buildable today.**

| | Seeded fixtures | Anonymised production dump |
|---|---|---|
| Determinism | Known ids, known values. An e2e test can assert `toBe('gas')` | Non-deterministic; a test can assert shapes only |
| Edge cases | Only the ones somebody thought to write | The real ones — the accented surname, the 400-character address, the provider with zero categories |
| Liability | None. No real personal data ever existed | Permanent. One missed column is a GDPR breach; `R14` in the risk register already names it |
| Exists today | Yes — the pipeline works, it just cannot travel | No. There is no production to dump |

**Decision.** Fixtures stay the e2e substrate, because a dump cannot replace them: you cannot assert
exact values against anonymised data. A dump is a *discovery* instrument for "why does this break in
production", not a test substrate.

For the operator's bug-fixing case specifically, the durable answer is not the dump. When a
production edge case bites, the fix is to **add a regression seeder** that reproduces it: it lives
in git, it runs in CI for ever, and it needs no sanitisation pipeline. The dump helps you *find* the
edge case; a seeder is how you *keep* it.

So the sanitised path is worth building when there is a production to sanitise. `W0-T20` already
owns it and `R14` is the risk it answers. Not now, and this ticket does not foreclose it — §3.2
keeps `localOnly` in the type for exactly the fixtures that must never travel.

## 2. The blocker this ticket has to clear first

`apps/api/prisma/seed/auth-demo-users.ts:16`:

```ts
const PASSWORD = 'seed-password-local-only';
```

That literal is in git, and the repository is public. Staging is `marketplace-api-staging.fly.dev`
— reachable by anyone. Seeding those two accounts to staging as they stand publishes working
credentials for an internet-facing host, which is exactly what the file's own header warns about:

> *"a known-credential account reaching an environment somebody demos is a real account somebody
> else can use."*

"Staging gets test users" is right. *These* users, unchanged, are not. §3.3 is the fix.

## 3. Design

### 3.1 The filter: `db:seed --only <id>[,<id>…]`

`runSeeders` takes an optional `only` list. When present, the registry is narrowed to those ids
**before** `assertSafeTarget` runs, so the gate judges the list it was actually given rather than
everything that happens to be registered.

Three properties, each of which is a test in §5:

- **Registry order is preserved**, whatever order the ids arrive in. `providers.demo-world` resolves
  slugs that `categories.taxonomy` writes, and `registry.ts` is the only place that ordering is
  stated. A CLI that let a caller reorder seeders would move that decision to the command line.
- **An unknown id is a hard failure** (`SEED_UNKNOWN_ID`), never a silent no-op. A typo in a deploy
  workflow that quietly seeds nothing is the failure mode this whole ticket exists to remove.
- **An empty `--only` is a hard failure** too, for the same reason.

`--only` does not bypass the ledger: a seeder already recorded is still skipped, so the deploy step
is idempotent across every push to a branch.

### 3.2 `localOnly` stays, and stops being the thing that blocks everything

The flag keeps its meaning — *this fixture must never leave a laptop* — and keeps its gate. What
changes is only the set it is evaluated against. After §3.3, no seeder in the registry carries it;
it remains in `Seeder` for `W0-T20`'s real cases, which are the ones that will carry sanitised or
personal data.

This is a deliberate loosening of a security boundary, so it is worth stating what still holds: a
`localOnly` seeder named in `--only` against a remote host is still refused, with the same error.
The gate did not get weaker; it got *accurate*.

### 3.3 The demo users travel, their published password does not

`auth.demo-users` loses `localOnly` and gains a password resolved from the environment:

| Target | `SEED_DEMO_PASSWORD` | Result |
|---|---|---|
| Local host | unset | The published literal. A developer's `pnpm db:seed` is unchanged |
| Local host | set | The supplied value |
| Non-local host | set | The supplied value |
| Non-local host | **unset** | **Throws** `SEED_WEAK_CREDENTIAL`. Nothing is written |

The published literal is never written to a non-local database, and the refusal is loud rather than
silent — a staging database with no way in is a worse outcome than a failed deploy step, because
nobody discovers it until QA tries.

`SEED_DEMO_PASSWORD` is declared in `EnvSchema` (`apps/api/src/config.ts`) like every other variable
this system reads; a module reaching into `process.env` directly is a review failure, and the seed
entrypoint already calls `loadConfig()`. It is optional there — the schema cannot know whether the
target is local — and the seeder owns the conditional requirement, because the seeder is the only
thing that knows both facts at once.

The password is handed to seeders through `SeedContext`, alongside a `target.isLocal` flag computed
by `run.ts` from the same `LOCAL_HOSTS` set the gate uses. One definition of "local", two consumers.

### 3.4 What reaches which environment

Both environments get **all three** seeders (operator, 2026-09-19). Preview databases are branched
from `sanitised-staging`, so whatever staging holds is inherited by every preview anyway; seeding
both keeps the two environments honest about that rather than relying on the branch.

The workflow names the ids explicitly rather than running the registry wholesale:

```yaml
run: pnpm db:seed --only auth.demo-users,categories.taxonomy,providers.demo-world
```

An explicit list is auditable in a diff — you can see what reaches staging by reading the pull
request — and a newly registered seeder does not reach a deployed environment because somebody added
it to an array. It has to be named here, which is a decision with a reviewer.

### 3.5 Two new secrets, and what happens before they exist

The workflows read `PREVIEW_SEED_DEMO_PASSWORD` and `STAGING_SEED_DEMO_PASSWORD`, following the
existing per-environment prefix convention (`STAGING_BETTER_AUTH_SECRET`, and so on).

`tests/env-example.test.ts` asserts `guardSecrets()` equals `workflowSecrets()` — nothing may be
consumed without being checked for first — so both names also enter `REQUIRED` in
`scripts/deploy/config.ts` and `.env.example`'s inventory.

**The operational consequence, stated plainly:** until the operator creates both secrets, the deploy
guard reports the target unconfigured and **skips** the deploy. It does not fail, and nothing is
half-created — that is `renderMissing`'s designed behaviour and the reason the guard exists. But the
pipeline is dark until they exist, so they must be created **before this merges**, not after. `§6`
is the checklist, and `docs/board/INTERVENTIONS.md` carries the entry (§5.6 of `TODO.md`).

### 3.6 The process rule: a feature ships with the data that exercises it

`TODO.md` §5.3 Definition of Done gains one line:

> - [ ] Seed data exists for anything this feature adds to a funnel, registered in
>   `apps/api/prisma/seed/registry.ts` and reaching preview

This is the durable half of the operator's ask, and it belongs in the checklist rather than in
memory: `W5` (auctions) is months away and nobody will remember this conversation. The line makes
"I need test data to check the feature" the ticket author's problem at the time they write the
ticket.

### 3.7 `pnpm db:reset` is broken, and is fixed here

Root `package.json:29` reads `"pnpm--filter @marketplace/api db:reset"` — a missing space, so the
script has never worked. It is one character, it is in the seed pipeline's own surface, and the
operator approved fixing it here rather than filing it (2026-09-19).

## 4. What does not change

- Every seeder's own logic. This ticket moves *when* they may run, never *what* they write.
- The ledger contract: a seeder runs at most once per database, inside a transaction with its own
  ledger row (`AC16` of `W0-T05`).
- Registry order, and `categories-seed.test.ts` AC18, which asserts it.
- `assertUniqueSeederIds`, and the `SEED_DUPLICATE_ID` failure.
- `W0-T20`'s scope. Sanitisation is still its ticket; §1.2 records the reasoning it inherits.
- The preview database's parent (`sanitised-staging`) and the branching model.

## 5. Acceptance criteria

- **AC1** — Given a registry containing a `localOnly` seeder, when `runSeeders` is called with
  `only` naming a seeder that is not `localOnly` and a remote `DATABASE_URL`, then it runs and does
  not throw.
- **AC2** — Given the same registry, when `runSeeders` is called with no `only` and a remote
  `DATABASE_URL`, then it throws `SEED_UNSAFE_TARGET` naming the `localOnly` seeder. The unfiltered
  gate is unchanged.
- **AC3** — Given `only` naming a `localOnly` seeder and a remote `DATABASE_URL`, then it throws
  `SEED_UNSAFE_TARGET`. The filter narrows what is judged; it does not grant an exemption.
- **AC4** — Given `only` containing an id no seeder declares, then it throws `SEED_UNKNOWN_ID`
  naming the unknown id, before connecting.
- **AC5** — Given an empty `only` list, then it throws `SEED_UNKNOWN_ID`-class refusal rather than
  running nothing successfully.
- **AC6** — Given `only` listing ids in an order that contradicts the registry, then seeders still
  run in registry order.
- **AC7** — Given a seeder already in the ledger and named in `only`, then it is skipped, and a
  second invocation reports it as skipped rather than running it twice.
- **AC8** — Given a non-local `DATABASE_URL` and no `SEED_DEMO_PASSWORD`, when `auth.demo-users`
  runs, then it throws and writes no user row.
- **AC9** — Given a non-local `DATABASE_URL` and a `SEED_DEMO_PASSWORD`, when `auth.demo-users`
  runs, then the stored hash verifies against that value and not against the published literal.
- **AC10** — Given a local `DATABASE_URL` and no `SEED_DEMO_PASSWORD`, then the published literal is
  used and a developer's existing workflow is unchanged.
- **AC11** — `auth.demo-users` no longer declares `localOnly`, and no seeder in the registry does.
- **AC12** — `deploy-preview.yml` and `deploy-staging.yml` each run `db:seed` with an explicit
  `--only` list naming all three seeders, after their migrate step and before the smoke test.
- **AC13** — `PREVIEW_SEED_DEMO_PASSWORD` and `STAGING_SEED_DEMO_PASSWORD` appear in `REQUIRED`,
  in `.env.example` commented out and empty, and `guardSecrets()` still equals `workflowSecrets()`.
- **AC14** — Neither workflow still claims nothing seeds its database, and neither still carries the
  instruction not to reintroduce a mock to cover an empty grid.
- **AC15** — `TODO.md` §5.3 carries the seed-data line of §3.6.
- **AC16** — `pnpm db:reset` resolves to a real script.
- **AC17** — Live: against a migrated local database, a filtered run of all three seeders leaves a
  taxonomy `GET /api/categories` serves and providers search returns.

## 6. For the operator

Before this merges, create in **Settings → Environments**:

| Environment | Secret | Value |
|---|---|---|
| `preview` | `PREVIEW_SEED_DEMO_PASSWORD` | Anything ≥ 12 characters. Share with whoever QAs a preview |
| `staging` | `STAGING_SEED_DEMO_PASSWORD` | As above, different value |

Until both exist the deploy guard skips preview and staging deploys with a `BLOCKED — needs human`
block naming them. Nothing is created and nothing is changed while they are missing.

The accounts they unlock are `client@marketplace.local` (Ana Cliente, `CLIENT`) and
`provider@marketplace.local` (Paco Fontanero, `CLIENT` + `PROVIDER`).

## 7. Out of scope

- **Sanitised or anonymised production data** — `W0-T20`, and §1.2 is the reasoning it inherits.
  There is no production to dump.
- **e2e funnels themselves.** There is no Playwright suite outside `packages/ui`'s a11y checks, and
  `agent-qa`'s slice memory is empty. §3.6 is the rule that makes each funnel bring its own data;
  writing those funnels is `W7`-and-after.
- **A seeder for jobs, auctions, emergencies or payments.** None of those models are built.
- **Production seeding.** `deploy-production.yml` gets no seed step: the taxonomy reaching
  production is a release decision, not a deploy side effect, and `W3-T11` is about to make the
  taxonomy writable by a human anyway.
- **Making `requiresLicence` or any taxonomy row editable** — `W3-T11`, which this unblocks.
