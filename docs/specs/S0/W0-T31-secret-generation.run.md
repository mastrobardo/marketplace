# Run record — W0-T31 secret generation

```
Agent:        agent-devops
Model:        claude-opus-5
Skills used:  security-and-hardening, test-driven-development, documentation-and-adrs
Started:      2026-09-19T13:40Z
Finished:     2026-09-19T13:52Z
Stacked on:   W0-T30-seed-a-deployed-database (PR #268)
```

## Prompts

### 1. The request

> Wait, so i need to add PREVIEW_SEED_DEMO_PASSWORD on GA right? coud u create also a script to
> generate passwords? this will come in hand when rotation is needed

Two things: a confirmation (yes — and `STAGING_SEED_DEMO_PASSWORD` too, both as *environment*
secrets rather than repository ones), and a tool.

### 2. The condition that shaped the design

> gh secret set NAME --env preview this would be super good.. as long the secret is not bleeded in
> any agent session. Which i doubt is the case

This is the whole ticket. The feature is twenty lines; the requirement is that **the tool cannot
emit a value into anything that captures output**, and that requirement is what §2 of the spec is
about. The operator's doubt was well founded: a generator that prints to stdout makes
`human-boundaries.md` unenforceable the moment an agent runs it, because the value then arrives as
ordinary command output.

Answered with a mechanism rather than a promise — `isTTY` on stdout is a fact about where bytes go,
not a guess about who is calling.

### 3. Corrections

**None from the operator.** Two self-corrections during the build, both recorded below under
deviations.

## Red phase

Written against the acceptance criteria before the implementation was complete. The most important
assertion is AC3's, because it is the one that would silently pass if the mechanism were wrong:

```
 FAIL  tests/secrets-generate.test.ts > AC3 — the value never reaches a command line
       > passes the secret on stdin and never in argv
       TypeError: writeSecret is not a function

 FAIL  AC4 — captured output aborts before anything is generated > treats a non-TTY stdout as captured
       TypeError: outputIsCaptured is not a function

 FAIL  AC8 — the rotation note tells the truth about seeded passwords
       > warns that a seed password does not rotate on its own
       TypeError: rotationNote is not a function

 Test Files  1 failed (1)
```

### The assertion that matters, and why it is not vacuous

`AC3` injects a fake `spawn` and asserts the value appears in `input` and **not** in `args`. Run
against a version that used `--body`, it fails:

```
AssertionError: the value appeared in argv
  expected 'secret set PREVIEW_SEED_DEMO_PASSWORD --env preview --body the-secret-value'
  not to contain 'the-secret-value'
```

### Verified by hand, since the guarantee is the product

```
$ pnpm exec tsx scripts/secrets/generate.ts PREVIEW_SEED_DEMO_PASSWORD | head -8
refusing to run: stdout is not a terminal.

This tool produces a credential, and anything that captures stdout — a pipe, a redirect,
a CI job, an agent session — would capture it too. Run it directly in your own terminal.
No value was generated.

$ pnpm exec tsx scripts/secrets/generate.ts PREVIEW_SEED_DEMO_PASSWORD --write | head -4
refusing to run: stdout is not a terminal.
```

Both refusals were produced from this agent session, which is the demonstration: **I could not make
the tool emit a value**, and neither can any future agent, because every tool call in this harness
captures stdout.

`--list` is exempt and prints happily through a pipe — it emits names and reasons, never values.

Final: `tests/secrets-generate.test.ts` 25/25. `pnpm typecheck` 10/10, `pnpm lint` clean, prettier
clean.

## Deviations from spec

1. **`AC6`'s first assertion was a tautology and had to be rewritten.** It read
   `generatable.has(name) || recipeFor(name) === undefined`, and since `generatableSecrets()` is
   *defined* as the names with a recipe, that is `X || !X` — true for every input, including a
   secret nobody had classified. Replaced with an explicit `ISSUED_ELSEWHERE` list in
   `strength.ts`, so a secret added to `REQUIRED` now fails the suite until somebody says which kind
   it is. Caught by reading the assertion back rather than by a failing test, which is the only way
   this class of bug is ever caught.

2. **`writeSecret` gained an injected `spawn`.** AC3 cannot be asserted against the real
   `spawnSync` without running `gh` and writing a real secret. The parameter defaults to the real
   implementation, so production behaviour is unchanged and only the test passes a double.

3. **The module-entrypoint guard was wrong on the first attempt.** It compared `import.meta.url` to
   the *basename* of `process.argv[1]`, which would treat any file with a matching name as the
   entrypoint. Now an exact `pathToFileURL(process.argv[1]).href` comparison — importing the module
   in a test must never generate anything, and a fuzzy match is not a guarantee.

4. **A ticket was filed rather than fixed.** §3.4 — `*_SEED_DEMO_PASSWORD` does not actually rotate,
   because the seeder's ledger row makes a new value inert. Discovered while writing the rotation
   note. Filed as `W0-T32`; fixing it here would have meant changing `W0-T30`'s ledger semantics
   from inside a tooling ticket.

## Self-assessment

**Weakest part of this change.** `ISSUED_ELSEWHERE` is a hand-maintained list that duplicates
knowledge already implicit in `REQUIRED`. The test forces it to stay complete, which is the best
available answer, but it is still two lists that a careless edit can put out of step — the test will
catch *missing* entries and only the `not.toContain` assertion catches contradictory ones.

**What is not proven.** `--write` has never been executed end to end: doing so would either write a
real secret or need a `gh` fixture, and the refusal that makes this tool safe also prevents me from
exercising its success path. AC3 proves the *arguments* are right; the first real write will be the
operator's.

**What a reviewer should look at hardest:**

1. **`outputIsCaptured` is the entire security property.** If it can return `false` in a captured
   session, everything else is decoration. Worth attacking directly: `script(1)`, a pty wrapper, or
   a CI runner that allocates a TTY would all defeat it. My claim is only that no *ordinary* capture
   path survives it, not that it is unbypassable by someone deliberately trying.
2. **Whether `--write` should exist at all.** It is the operator's explicit request and the
   mechanism is sound, but it is the feature that moves a credential through code I wrote. The
   print-only path needs none of that trust.
3. **The 24-byte choice for seed passwords.** Arbitrary beyond "well past the floor of 12". The
   floor is enforced; the headroom is judgement.
