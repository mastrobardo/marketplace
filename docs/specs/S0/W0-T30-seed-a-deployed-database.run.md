# Run record — W0-T30 seed a deployed database

```
Agent:        agent-devops
Model:        claude-opus-5
Skills used:  test-driven-development, ci-cd-and-automation, security-and-hardening,
              documentation-and-adrs
Started:      2026-09-19T09:18Z
Finished:     2026-09-19T09:30Z
```

## Prompts

### 1. Task selection

> PLease, next task!

No task id given. `TODO.md`'s `▶ NEXT` banner and the previous commit (`9eec8e3`) both named
`W0-T30` then `W3-T11`, so no clarification was needed about *which* ticket — only about its
content, below.

### 2. Operator's answer to the two open questions in the plan

> For point 2: i think staging should reach staging at least with some test users, and data which
> allows QA to test. This said, is it a good idea? or would a prd db dump (maybe anonymized) also be
> required? Why this: we might want to replicate, either in preview or staging, some edge cases
> coming from PRD (ie: bug fixing or similar). So, for now, let's seed all the datas we need to
> complete e2e for each funnels ( a user, a manita, later an auction, etc etc ), and add it as a
> condition for features (ie: when developing the auction, i need to add test data to acutally check
> the feature )

This **changed the shape of the ticket** and is the reason the spec has a §1.2 and a §3.6 that the
`TODO.md` entry did not anticipate. Three things came out of it:

- the fixtures-vs-dump question, answered in spec §1.2 and promoted as `MEM-2026-09-19-2`;
- the discovery that "staging gets test users" is blocked by a **published password**, not by the
  seed pipeline — spec §2, and the largest single piece of work in the ticket;
- the process rule, which is `TODO.md` §5.3's new line rather than anything in this slice's code.

### 3. Confirmation of the two remaining decisions

> 1) all three, i agree. 2) it is a small fix, can go with this feat.

`(1)` settled §3.4 — preview and staging both get all three seeders. `(2)` put the `pnpm db:reset`
typo (root `package.json`, a missing space) in this branch rather than a follow-up.

### 4. Corrections

**None.** No iteration was needed on generated output. The two questions asked before implementation
started (§3.4's scope, and whether the typo belonged here) were answered once and did not change
afterwards, which is the outcome the plan-then-confirm step exists to produce.

The one place this run *did* re-plan was between prompt 1 and prompt 2, and that was the operator
adding requirements rather than correcting anything: per `TODO.md` §5.6 and `ADR-010`, a re-prompt
that answers a question the agent asked is not an intervention. **No `docs/interventions/` entry.**

## Red phase

`apps/api/tests/seed-filter.test.ts`, written before any implementation, against the unmodified
pipeline:

```
 ❯ tests/seed-filter.test.ts (16 tests | 15 failed) 233ms

 FAIL  AC1 — a filtered run reaches a remote host the unfiltered one could not
       > passes the gate when the filter excludes every localOnly seeder
       TypeError: (0 , __vite_ssr_import_5__.selectSeeders) is not a function
 FAIL  AC3 — the filter narrows what is judged, it does not grant an exemption
       > still refuses a localOnly seeder that was named explicitly
 FAIL  AC4 — an unknown id is a hard failure, never a silent no-op
       > names the id it could not find
       AssertionError: expected [Function] to throw error matching
         /SEED_UNKNOWN_ID.*categories\.taxonmy/s but got '(0 , …selectSeed…'
 FAIL  AC4 > reports every unknown id, not just the first
 FAIL  AC5 — an empty filter refuses rather than seeding nothing successfully > throws
 FAIL  AC5 > returns the whole registry when no filter is given at all
 FAIL  AC6 — registry order survives whatever order the CLI used > ignores the order of the ids given
 FAIL  AC6 > deduplicates a repeated id
 FAIL  AC8 — the published password never reaches a non-local database
       > refuses when the target is remote and no password was supplied
       AssertionError: promise resolved "undefined" instead of rejecting
 FAIL  AC9 — a supplied password is the one that is stored
       AssertionError: expected false to be true
 FAIL  AC10 — a developer on a laptop is unaffected
       > uses the published password when the target is local and nothing was supplied
 FAIL  AC10 > prefers a supplied password even locally
 FAIL  AC11 — nothing in the real registry is localOnly any more
       > leaves the flag in the type for W0-T20 and unused by the registry
 FAIL  AC11 > means the real registry passes the gate against a remote host unfiltered
       SeedError: SEED_UNSAFE_TARGET: refusing to run 1 local-only seeder(s) against host
         "db.example.com": auth.demo-users.
 FAIL  the filter is honest about a local target too
       > allows a localOnly seeder against loopback, filtered or not

 Test Files  1 failed (1)
      Tests  15 failed | 1 passed (16)
```

**The one that passed is the point of the suite.** AC2 — *the unfiltered gate still refuses the
whole registry against a remote host* — passed before the change and must pass after it. A run in
which AC2 had gone red would mean the filter had loosened the gate rather than narrowing what it
judges.

`AC11`'s second failure is the ticket stated as a test: the real registry, unfiltered, refused a
remote host. It is now green because `auth.demo-users` no longer needs the flag.

### Live verification, after green

The unit suite does not prove the CLI reaches the runner through two layers of `pnpm run`, which
was the risk flagged in the plan. Run against a scratch database (`w0t30_scratch`, created with
PostGIS, migrated, dropped afterwards):

```
$ pnpm db:seed --only nope.typo
> pnpm --filter @marketplace/api db:seed --only nope.typo
> tsx prisma/seed.ts --only nope.typo
SEED_UNKNOWN_ID: no seeder declares "nope.typo".
  Registered ids: auth.demo-users, categories.taxonomy, providers.demo-world.

$ pnpm db:seed --only providers.demo-world,categories.taxonomy
seed: ran 2 (categories.taxonomy, providers.demo-world), skipped 0 already applied.

$ pnpm db:seed
seed: ran 1 (auth.demo-users), skipped 2 already applied.

$ psql -tAc "select … from _seed_run"
22 categories, 5 providers, 7 users,
ledger: categories.taxonomy | providers.demo-world | auth.demo-users
```

Three things proven that no unit test covers: the flag survives both `pnpm` layers (with **and**
without a `--` separator); AC6's registry ordering holds through the real CLI, since the ids were
given reversed and ran in registry order; and AC7's idempotency is real — the second run skipped
what the first had recorded.

Full gate: `pnpm verify` green (10/10 turbo tasks, 286 root + 951 package tests). Live suite green
at 357/357 with `STACK_LIVE=1` and `DATABASE_URL` exported.

## Deviations from spec

1. **Two pre-existing guard tests were wrong, and had to be corrected rather than satisfied.**
   `tests/env-example.test.ts` and `tests/cd-workflows.test.ts` both derived "required" from
   `EnvSchema` as *"has no `.default(`"*. `SEED_DEMO_PASSWORD` is the repository's first
   `.optional()` variable, so both classified it as required — the first then demanded it be set
   live in `.env.example` (a file whose own header forbids real values), and the second demanded it
   be pushed onto the Fly app as a runtime secret the API never reads.

   Satisfying either would have been wrong: a password would have been committed, or a credential
   placed in a container with no consumer. Both heuristics now exclude `.optional()` as well.
   **This is the change in this branch a reviewer should look at hardest** — it edits assertions
   rather than code, which is exactly the shape of a test being bent to fit. The argument that it is
   not: an optional variable is by definition one the API boots without, and both tests say in their
   own words that they are about what the API *requires*.

2. **The teardown workflow gained a secret it does not use.** `deploy-preview-teardown.yml` shares
   `REQUIRED.preview` with the deploy, and `AC28` asserts the guard is handed everything it checks
   for. Withholding `PREVIEW_SEED_DEMO_PASSWORD` would make teardown report the target unconfigured
   and skip — leaking the Fly app and Neon branch it exists to destroy. Passed through with a
   comment saying why. The precedent already existed: `PREVIEW_BETTER_AUTH_SECRET` is there for the
   same reason.

3. **No intervention ledger entry, against what the implementation plan said.** The plan stated the
   new secrets would be logged in `docs/interventions/`. Reading §5.6 properly: that ledger is for a
   human *correcting* the agent, and creating a `[H]` secret is neither a correction nor an
   override. The `[H]` boundary is recorded where the repository already records it — `README.md`'s
   *What a human has to set*, `.env.example`'s inventory, and spec §6.

4. **A test helper module was added** (`apps/api/tests/seed-context.ts`). Widening `SeedContext`
   broke eleven `.run({ db })` call sites across three suites. Spelling `target: { isLocal: true }`
   inline at each would have hard-coded the local path into suites that are not about it.

## Self-assessment

**Weakest part of this change.** `SEED_DEMO_PASSWORD`'s conditional requirement is expressed in
three places that cannot check each other: `EnvSchema` says optional, `resolvePassword` says
required-unless-local, and the deploy guard says required-for-this-environment. No test can fail if
those three drift apart, because each is right about a different question. The seeder's refusal is
the backstop, and it fires at deploy time rather than at review time.

**Second weakest:** AC8 — the refusal against a non-local host — is proven only by unit test. I
cannot point `DATABASE_URL` at a real remote host from here, so the first genuine execution of that
path will be the first preview deploy after this merges.

**What a reviewer should look at hardest**, in order:

1. **Deviation 1**, the two edited guard tests. That is the one place a reviewer should assume bad
   faith and check the argument, because "the test was wrong" is what it always looks like.
2. **The security boundary actually moved.** `auth.demo-users` is no longer pinned to a laptop. The
   claim is that the *published password* was the risk and it is now unreachable off-laptop; the
   thing to verify is that nothing else in those rows is sensitive — fixed uuids, `@marketplace.local`
   addresses, `emailVerified: true`.
3. **The explicit id list in two workflows** is duplicated prose that will drift from `registry.ts`.
   That is deliberate (§3.4 — travel should be a reviewed decision), but it is a maintenance cost
   and the new `AC12` test is the only thing that will notice.
4. **Whether production should seed the taxonomy.** §7 says no, on the grounds that it is a release
   decision. `W3-T11` makes the taxonomy human-writable, which may make that permanent — or may
   make an empty production taxonomy a first-day problem for whoever opens the back office.
