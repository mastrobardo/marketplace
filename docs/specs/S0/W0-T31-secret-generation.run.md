# Run record — W0-T31 secret generation

```
Agent:        agent-devops
Model:        claude-opus-5
Skills used:  security-and-hardening, test-driven-development, documentation-and-adrs
Started:      2026-09-19T13:40Z
Finished:     2026-09-19T14:30Z
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

### 3. The wrappers

> please create a bash script calling tsx scripts/secrets/generate.ts PREVIEW_SEED_DEMO_PASSWORD
> --write . this will be easier for other people

and, when asked whether one script should set every secret an environment needs:

> Divide them, but let's stat with just SEED PREVIEW and STAGING. We will add them later, depending
> also on the who will setup the env ( i'm not sure who will be a colllaborator: they might be
> thechnical or not )

That last clause is what settled the shape: **one script per secret, no arguments**. An `--env` flag
would be less code and more to explain to somebody who may not be technical.

### 4. Corrections

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

### The wrappers, verified the same way

```
$ echo "yes" | ./scripts/secrets/set-preview-seed-password.sh

Cannot continue. this needs to run in a terminal window.

  It produces a password, so anything that records the output — a pipe, a file,
  a CI job, an AI coding assistant — would record that too.
```

Two things this proves. The guard survives the extra layers — a bash wrapper and `pnpm exec` both
pass the TTY through, so nothing about the convenience weakened the guarantee. And the *early* check
matters: before it was added, the same command reached the confirmation prompt and the piped `yes`
answered it, so a prompt nobody saw was being satisfied before `generate.ts` finally refused.

The three shapes `AC10` forbids were checked against the assertion directly rather than assumed:
`VALUE=$(…)`, `… | tee log.txt` and `… > out.txt` are each caught, and the real `exec` line passes.

Final: `tests/secrets-generate.test.ts` 31/31. `pnpm verify` green — 10/10 turbo tasks, typecheck,
lint and prettier clean.

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

**The wrappers are the new weakest point, not the generator.** A shell script is the easiest place
in this repository to capture a credential by accident — `$(...)` is what a shell programmer reaches
for by reflex, and it defeats the whole design. `AC10` asserts its absence, but the assertion is a
regex over source text, which is a weaker instrument than the type system protecting everything else
here.

**`--write` is now proven, by the operator rather than by me.** On 2026-09-20 they ran
`./scripts/secrets/set-preview-seed-password.sh` and `PREVIEW_SEED_DEMO_PASSWORD` was set. That is
the one path I could not exercise — the refusal that makes this tool safe is also what stops an
agent testing its success case — so it stayed a stated gap until a human closed it. AC3 proved the
*arguments*; this proves the whole thing.

`STAGING_SEED_DEMO_PASSWORD` is still unset.

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


---

# Amendment — 2026-09-20: the tool worked and the outcome was useless

## What happened

The operator ran `./scripts/secrets/set-staging-seed-password.sh`. Every mechanism behaved exactly
as designed: a TTY, a confirmation, the value to `gh` over stdin, nothing printed. `gh` confirmed
the write. And then:

> this is a bummer […] The password is NOT shown, here or anywhere. It goes straight to GitHub.
> Nobody — including whoever runs this — ends up knowing what it is.

Staging had a credential nobody could use. The secret exists so QA can sign in as
`client@marketplace.local`; a value nobody knows does not secure that environment, it makes it
unusable.

## The error, stated plainly

I gave every generatable secret the same treatment. They have **opposite** requirements:

- `*_BETTER_AUTH_SECRET` signs sessions. The correct number of people who know it is zero.
- `*_SEED_DEMO_PASSWORD` is a password a person types into a login form. Hiding it defeats it.

I built the first behaviour, applied it to both, named a wrapper after the second, and recommended
it in the README. The original script even told the reader to *"stop and run this instead"* if they
needed a usable password — so the design knew its default was wrong for this secret and shipped it
anyway. That sentence was the tell, and I wrote it.

The security argument I was most pleased with actually pointed the other way. §2.1 establishes that
`isTTY` proves *a person is looking at a terminal*. That is precisely the condition under which
printing is safe. The guard was never "never show a secret" — it was "never show one to something
that records it". I drew the line one step too far and hid the value from the only audience that
needed it.

## A second, compounding wrong answer

The rotation warning fired unconditionally, so the operator — setting this secret for the **first**
time, on an environment whose every deploy had skipped at preflight — was told their brand-new value
would change nothing and they would need to re-seed or re-branch. False: with no `_seed_run` row,
the next deploy simply uses it.

A warning that is wrong half the time trains people to ignore the half that is right.

## What changed

1. **`Recipe.audience: 'nobody' | 'humans'`** — the distinction as data, so a new secret must decide.
2. **`--write` prints a `humans` secret** after setting it, with "write this down". A `nobody`
   secret is still never shown.
3. **`rotationNote(name, recipe, seeded?)`** — hedged when unknown, "nothing to rotate" when
   `false`, the full warning when `true`. `--seeded` / `--not-seeded` on the CLI.
4. **The wrappers' explanation rewritten.** It described the behaviour that was the bug, and a stale
   explanation is worse than none: it is what the operator reads and believes.
5. **AC10a/AC10b**, including an assertion that the wrapper text no longer claims the password is
   hidden — so the prose cannot drift back to describing the old behaviour.

## Self-assessment

**The tests all passed, and the thing was still wrong.** Every assertion in the original suite was
about *mechanism* — the value is not in argv, not on stdout, not on disk. Not one asked the only
question that mattered: **can the person who needs this credential obtain it?** A suite can be
thorough about how a thing works and silent about whether it is useful, and mine was.

**What I would do differently:** the `--write` path was the one I could not exercise from an agent
session, and I said so in the original self-assessment — "the first real write is yours". I treated
that as a testing gap. It was a **design review** gap: the path I could not run was the path whose
*outcome* I had never thought through end to end. When a mechanism cannot be exercised, the thing to
check is not just "will it work" but "what does the person have afterwards".

**Still true from the original:** `outputIsCaptured` remains the whole security property, and it is
unchanged. This amendment does not loosen it by one line.
