---
task:    W0-T31
agent:   agent-devops
session: 2026-09-19T13:40Z
status:  closed
---

# Session — W0-T31

## Goal

A tool for generating the deploy secrets `W0-T30` introduced, that a human can also use for
rotation. Asked for at `W0-T30`'s close.

The actual requirement, from the operator's follow-up, is narrower and harder than "generate a
password": **the tool must not be able to leak a value into an agent session.**

## Current state

Landed and green on `W0-T31-secret-generation`, stacked on `W0-T30-seed-a-deployed-database`
(PR #268). 25/25 in `tests/secrets-generate.test.ts`; typecheck, lint and prettier clean.

- `scripts/secrets/strength.ts` — recipes by name suffix, plus the explicit `ISSUED_ELSEWHERE` list
- `scripts/secrets/generate.ts` — TTY guard, stdin write via `gh`, rotation notes
- `W0-T32` filed: a seeded credential does not actually rotate

## Log

- 13:40 operator asked for the tool and, in the next message, set the real constraint: *"as long the
  secret is not bleeded in any agent session. Which i doubt is the case"*. Treated the doubt as
  correct rather than reassuring them — a printed value **does** leak to whatever reads stdout.
- 13:42 chose `process.stdout.isTTY` as the guard. The reason it is the right check and not a
  heuristic: it is a fact about *where the bytes go*, not a guess about who is calling. No capture
  path — pipe, redirect, CI, agent — has a TTY on stdout.
- 13:43 put the guard **before** `randomBytes`. A tool that generates and then declines to show
  leaves a value that exists and is unreachable, which is what makes somebody re-run it with a
  redirect.
- 13:45 **dead end avoided**: `gh secret set --body "$VALUE"` is the obvious call and is wrong —
  argv is visible in `ps` and lands in shell history. `gh` reads stdin when `--body` is omitted;
  confirmed in `gh secret set --help` before relying on it.
- 13:46 **caught my own tautology.** `AC6` asserted
  `generatable.has(name) || recipeFor(name) === undefined`, which is `X || !X` — true for every
  input including an unclassified secret. Replaced with an explicit `ISSUED_ELSEWHERE` list so a
  new `REQUIRED` entry fails until classified. Found by re-reading the assertion, not by a test.
- 13:48 **found a real defect in `W0-T30` while writing the rotation note**: a seeded password
  cannot be rotated by changing the secret, because the ledger skips the seeder for ever. Filed
  `W0-T32` rather than changing ledger semantics from inside a tooling ticket. The tool prints the
  warning every time.
- 13:50 verified both refusals from inside this session. I could not make the tool emit a value,
  which is the demonstration the operator asked for.

## Blocked / escalations

None. `W0-T30`'s two secrets still need creating — that is `W0-T30`'s handoff, and this tool is now
the way to do it.

## Handoff

**Next action:** open the PR for this branch against `W0-T30-seed-a-deployed-database` (stacked), or
rebase onto `main` if #268 merges first — `strength.ts` reads `REQUIRED`, and the two
`*_SEED_DEMO_PASSWORD` entries only exist on the `W0-T30` branch.

Then `W3-T11`, which is what `W0-T30` unblocked.

**Do not redo:**
- The leak analysis. Spec §2 is the table; `MEM-2026-09-19-7` is the durable rule.
- `gh secret set` stdin behaviour. Confirmed from its own `--help`: reads stdin when `--body` is
  omitted.
- The rotation gap. It is `W0-T32`, deliberately not fixed here.
- Trying to exercise `--write` end to end from an agent session. It refuses by design; the first
  real write is the operator's.
