# Spec — W0-T23 stop parallel agents colliding on shared files

> **This ticket was reverted whole, and this document is kept as the record of why.**
>
> `W0-T23` passed every one of its own acceptance criteria and was reverted in full — the direction
> was never put to the operator, and it was not the one they wanted
> (`docs/interventions/2026-09-09-W0-T23-01.md`, PR #161, verdict `REJECTED`).
> `agents/prompts/00-spec-authoring.md` cites it as the cautionary example every spec author reads:
> *"A spec that treats the direction as settled because an issue proposed it has skipped the only
> question that mattered."*
>
> Restored to `main` on 2026-09-18 because it existed **only** on `origin/W0-T23-shared-file-collisions`,
> which made a prompt's own reference depend on a branch surviving. Nothing here describes code that
> is in the repository; read it as the argument that was made, not as a design in force.

---

|               |                                                                          |
| ------------- | ------------------------------------------------------------------------ |
| **Task**      | `W0-T23` `[A]`                                                           |
| **Slice**     | S0 Platform                                                              |
| **Owner**     | `agent-devops`                                                           |
| **Reviewers** | `agent-qa` · `agent-ui` (i18n)                                           |
| **Issues**    | [#153](https://github.com/mastrobardo/marketplace/issues/153)            |
| **Status**    | **reverted** — see the note above                                        |

---

## 1. Purpose

Three branches in the `W0-T02`/`W0-T03`/`W0-T04` session (PRs #150, #151, #152) touched three
different slices of the codebase — docker-compose, the API, the web app — shared no source file,
and still conflicted three times. On `README.md`, on `memory/repo/gotchas.md`, on
`memory/slices/agent-devops.md`, and finally on `pnpm-lock.yaml`.

Each resolution was trivial. That is the danger: it is beneath the threshold at which anyone files
a ticket, and it scales **O(n²)** in open branches. For a human this is a shrug. For an agent it is
a **stop** — the task is done, the PR is green, and it waits for a person.

The premise of this repo is thirteen agents working in parallel. At that width every merge
invalidates every other open branch.

### The one that has not bitten yet is the worst

`W0-T04` put every translation key in two files, `locales/es.ts` and `locales/en.ts`. `TODO.md` §5.3
requires ES and EN keys for every user-facing slice, so `agent-discovery`, `agent-jobs`,
`agent-auctions`, `agent-emergency`, `agent-money`, `agent-trust` and `agent-admin` will all append
to those two files on every task. Seven agents queued on two files — and unlike the memory files a
bad resolution is not cosmetic. A key dropped in a merge is a compile error at best and a missing
translation shipped to a user at worst.

This is a design mistake made in `W0-T04`, and it must be corrected before any slice builds on it.

## 2. Scope

**In:** the i18n catalogues (B), the memory layout (A), the lockfile recipe (D), and the one
`README.md` row that actually collided (C, scoped down — see §3.6).

**Out:** a general append-merge driver for hand-written prose files. The issue proposes it as
option E and then argues against it, and the argument is right: a keep-both script run on the three
conflicting files in that session was **correct on five hunks and wrong on two**. The README Layout
table looks append-shaped but is a *modification* — each branch edits the row for its own app — and
keeping both sides silently produced a duplicate row with stale text. It was caught by reading the
result, not by the tool. An automatic driver would have committed it.

The distinction this spec draws instead: a merge driver is safe **only for a file that is a pure
function of conflict-free inputs**, because the merge result is discarded and recomputed rather
than stitched. That is a different claim from "this file is append-only", and §3.5 relies on it.

**Out:** splitting `README.md` into per-app fragments. Not in the acceptance criteria, and the
Layout table is the row that actually collided.

**Out:** migrating `memory/sessions/`. One file per (agent, task, session) already — a new session
is a new file, so it cannot collide.

## 3. Design

### 3.1 The rule this task establishes

> **A file two agents both have to change on the same day is a design defect, not a merge problem.**
> Either give each agent its own file, or make the shared file generated so a conflict is resolved
> by recomputing it.

Everything below is one of those two moves.

### 3.2 B — namespaced i18n catalogues

```
apps/web/src/i18n/locales/
├─ es/
│  ├─ index.ts        # barrel: composes the namespaces, defines TranslationKey
│  ├─ app.ts  nav.ts  home.ts  notFound.ts  language.ts  footer.ts
└─ en/
   ├─ index.ts        # barrel: `satisfies Translations`
   └─ app.ts  nav.ts  home.ts  notFound.ts  language.ts  footer.ts
```

A slice adds `es/jobs.ts` and `en/jobs.ts` — two new files, which git cannot conflict on — plus one
line in each barrel. **Adding a key to a namespace that already exists touches exactly one file per
language**, which is the common case and the one AC1 measures.

`W0-T04`'s enforcement properties are preserved exactly, and this is the constraint that rules out
the obvious alternatives:

- `TranslationKey` stays a union of literal key names, composed as `keyof typeof es`, where `es` is
  the spread of the namespaces. A key that does not exist is still a compile error.
- `en/index.ts` still carries `satisfies Translations`, so a missing key is still a compile error
  naming it, and an excess key is still an excess-property error.
- Keys stay **flat and dotted** (`nav.home` is one key, not `home` under `nav`). The namespace is
  the file, not a nesting level, so `index.ts` keeps `keySeparator: false` and the parity test keeps
  comparing sets rather than walking a tree.

**The barrel is hand-written, not generated.** It is two lines per namespace and a generator that
emits TypeScript is more machinery than that earns. A test guards it instead (§4, AC4): every
`es/*.ts` file is registered in the barrel, and `en/` mirrors `es/` file for file. The failure
message names the exact line to add. Entries are **sorted alphabetically, one per line**, so two
branches adding different namespaces usually land at different offsets with unchanged context
between them and git merges them without help.

### 3.3 A — one memory record per file

```
memory/
├─ LONG_TERM.md              # generated index (§3.4) + hand-written rules
├─ repo/
│  ├─ gotchas/MEM-2026-09-07-07.md
│  ├─ conventions/MEM-….md
│  ├─ decisions/MEM-….md
│  └─ glossary/MEM-….md
└─ slices/agent-devops/MEM-….md
```

A new record is a new file. Git cannot conflict on two new files, so `AGENTS.md` L8 — which asks
every agent to promote durable learnings on every task — stops being a queue.

Record format: frontmatter for what a script must read, prose for what a person must read.

```markdown
---
id: MEM-2026-09-07-07
kind: gotcha            # gotcha | convention | decision | glossary
scope: repo             # repo | slice:<agent> | flow:<name>
status: active          # active | superseded-by MEM-…
evidence: TODO.md §4 R3
---
# Google Maps is for display, PostGIS is for geography

**Fact.** …
**Why.** …
**Apply.** …
```

The `id` is already the filename, so it cannot drift from it — a test asserts they match. The
existing entries already carry `MEM-YYYY-MM-DD-NN` ids, so the migration is mechanical and the ids
are preserved: every existing pointer into memory keeps resolving.

`status: superseded-by` still means supersede-never-delete. A superseded record keeps its file and
is rendered in a separate section of the index rather than dropped, so the reasoning trail survives.

### 3.4 The index stays one place to read

AC5 requires `memory/LONG_TERM.md` to still give one place to read everything. That directly
contradicts AC1 unless the file stops being hand-maintained: an index every agent appends to is the
collision, moved.

So it is **generated** by `scripts/render-memory.ts` between markers:

```markdown
<!-- BEGIN GENERATED — scripts/render-memory.ts. Do not hand-edit. -->
…one line per record, grouped by kind…
<!-- END GENERATED -->
```

The hand-written prose outside the markers — how to read memory, the rules — is untouched by the
renderer. A drift test fails CI if the committed file differs from a fresh render, the same shape
as the `agents-drift` gate `W0-T15` established.

### 3.5 D — generated files are never hand-merged

Three files are now pure functions of conflict-free inputs: `memory/LONG_TERM.md`, the README Layout
table, and `pnpm-lock.yaml` (a function of the `package.json` files). None may be line-merged.

`.gitattributes` marks them, and `scripts/setup-git.sh` registers a merge driver per file that
resolves a conflict by **recomputing the file from its inputs and discarding both sides**. This is
the narrow, provably-safe case §2 carves out of option E: nothing is stitched together, so the
"kept both sides of a modification" failure cannot occur.

`scripts/setup-git.sh` also installs `core.hooksPath .githooks`, which is currently a comment in
`.githooks/pre-commit` that every clone has to notice and run by hand. One documented setup step,
in the README, replacing two undocumented ones.

The lockfile's recipe is `scripts/relock.sh`: take `main`'s copy, re-run `pnpm install`, never edit
a line. A hand-merged lockfile is not a lockfile — it is a file that resembles one.

**A clone that has not run `setup-git.sh` is not broken**, it just conflicts the old way and the
resolution is to run the render script by hand. CI never relies on the driver; the drift tests are
what make a stale generated file fail.

### 3.6 C — the README Layout table, scoped down

The table has one row per workspace member and every task edits its own row. It is generated from
the workspace by `scripts/render-readme.ts` — the description text lives in each member's
`package.json` `description`, which the member's own agent owns and nobody else touches — between
the same markers, with the same drift test and the same merge driver.

`tests/workspace.test.ts` already requires a `package.json` per member, so this adds a field to a
file that must exist rather than a new convention.

## 4. Acceptance criteria

| # | Criterion | How it is proved |
|---|---|---|
| AC1 | Two branches that each add a memory record, a translation key and a dependency merge into `main` with **zero** conflicts | `tests/parallel-merge.test.ts` builds both branches in a scratch clone and asserts `git merge-tree` reports no conflict |
| AC2 | The same test **fails** against the old layout | the test also merges two branches that append to a single shared file and asserts the conflict it would have produced |
| AC3 | A new memory record is a new file; `id` matches filename; `kind` and `status` are valid | `tests/memory-layout.test.ts` |
| AC4 | Every `locales/<lang>/*.ts` is registered in its barrel, and `en/` mirrors `es/` file for file | `apps/web/tests/i18n.test.ts` |
| AC5 | `W0-T04`'s compile-failure properties survive: unknown key, incomplete catalogue | the three existing fixtures, repointed at the new paths |
| AC6 | `LONG_TERM.md` and the README Layout table match a fresh render | drift tests, run in CI |
| AC7 | `pnpm-lock.yaml` has a scripted resolution that never hand-edits it | `scripts/relock.sh` + `.gitattributes` entry asserted by test |
| AC8 | All 42 existing records are migrated with ids preserved, none lost | `tests/memory-layout.test.ts` asserts the count and every known id |
| AC9 | `agents/policies/memory.md`, `agents/AGENTS.md` §3 and the memory templates describe the new layout | review |

## 5. Risks

- **The barrel is still a shared file.** Adding a *namespace* touches it; adding a *key* does not.
  That moves the collision from once-per-task to once-per-slice — thirteen times, ever. Accepted,
  and mitigated by sorting rather than eliminated. Stated here rather than left for a reviewer to
  discover.
- **A merge driver is per-clone local config.** An agent that skips `setup-git.sh` gets the old
  behaviour. It fails *toward* a conflict, never toward a silent bad merge, which is the right
  direction.
- **`render-memory.ts` parses frontmatter with a regex, not a YAML library.** The fields are
  single-line scalars written from a template. A record whose frontmatter does not parse fails the
  layout test rather than being skipped silently.
- **Migration is the largest diff in this task and touches every memory file at once.** It is
  deliberately a separate commit, so the layout change can be reviewed apart from the content move,
  and `git log --follow` still reaches the original text.
