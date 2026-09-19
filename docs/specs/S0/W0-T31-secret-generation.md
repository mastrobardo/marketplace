# W0-T31 — Generating a deploy secret without anybody reading it

- **Slice**: S0 Platform (`agent-devops`)
- **Decides**: how a human produces a value for a `REQUIRED` secret, and what stops the tool that
  produces it from becoming a way around `agents/policies/human-boundaries.md`.
- **Depends on**: `W0-T30`, which added the first two secrets anybody has had to invent by hand.

---

## 1. Purpose

`W0-T30` ends with a human creating `PREVIEW_SEED_DEMO_PASSWORD` and `STAGING_SEED_DEMO_PASSWORD`,
and the operator asked for a tool — *"this will come in hand when rotation is needed"* (2026-09-19).

Every secret in `REQUIRED` falls into one of two kinds, and only one of them can be made locally:

- **Issued by a vendor.** `FLY_API_TOKEN`, `NEON_API_KEY`, `CLOUDFLARE_*`, a database URL. Random
  bytes for any of these produce a value of the right shape that simply does not work, and the
  failure surfaces at deploy time, far from its cause.
- **Invented by us.** `*_BETTER_AUTH_SECRET` and `*_SEED_DEMO_PASSWORD`. These are the only ones a
  generator has any business producing.

### 1.1 The operator's condition

> *"as long the secret is not bleeded in any agent session. Which i doubt is the case"*

The doubt is correct as stated, and a promise would not answer it. `agents/policies/human-boundaries.md`
already forbids an agent to *create, read, guess, echo, log or commit* a secret — but a tool that
prints one to stdout makes that rule unenforceable the moment an agent runs the tool, because the
agent then reads the value as ordinary command output.

So this ticket's real requirement is not "generate a password". It is: **the tool must be unable to
emit a value into anything that captures output**, by construction rather than by policy.

## 2. The three leak paths, and what closes each

| Path | Why it leaks | What closes it |
|---|---|---|
| **`argv`** — `gh secret set NAME --body <value>` | Visible in `ps`, in shell history, in any process listing on a shared machine | The value is written to `gh`'s **stdin**. It is never an argument, not even of the command this tool builds |
| **stdout** — printing the value | Whatever reads stdout keeps it: a pipe, a redirect, a CI log, an agent transcript | `--write` prints **no value at all**, and *both* modes refuse to run unless stdout is a **TTY** |
| **disk** — a temp file | Survives the process, and is read by anything with the path | Nothing is written to a file. The value exists as one string and is handed to a pipe |

### 2.1 Why `isTTY` and not a heuristic about who is running

The check is `process.stdout.isTTY`. That is not a guess about the caller's identity — it is a fact
about **where the bytes go**. A human at a terminal has a TTY; a pipe, a redirect, a CI runner and
an agent session do not. There is no version of "an agent runs this and captures the value" that
also has a TTY on stdout.

`CI` being set is refused as well, on the same grounds: a workflow log is a transcript like any
other, and a runner can allocate a TTY.

The refusal happens **before** `randomBytes` is called (§5, AC4). A tool that generates a value and
*then* declines to show it leaves a value that exists and is unreachable, which is the state that
tempts somebody to re-run it with a redirect.

## 3. Design

### 3.1 Strength comes from the name, not from a flag

`scripts/secrets/strength.ts` maps a **suffix** to a recipe, because every one of these names is
`<ENVIRONMENT>_<ROLE>` and it is the role that decides the strength. A new environment needs no
change.

| Suffix | Entropy | Floor it must clear |
|---|---|---|
| `BETTER_AUTH_SECRET` | 32 bytes, base64url | better-auth's 32-character minimum (`W2-T01` §4.8) |
| `SEED_DEMO_PASSWORD` | 24 bytes, base64url | `EnvSchema`'s `.min(12)` (`W0-T30` §3.3) |

No `--length`. A caller who can choose the strength is a caller who can choose a weak one, and the
schema's floor is already the authority on what is acceptable.

Values are **base64url**: URL-safe, no padding. These get pasted into web forms, copied through
shells, and occasionally end up in a URL because somebody was in a hurry.

### 3.2 A secret must be classified before it can be required

`ISSUED_ELSEWHERE` lists vendor credentials **explicitly**, rather than being inferred as "everything
without a recipe". A secret added to `REQUIRED` therefore fails the suite until a human states which
kind it is.

Inferring would classify every new secret as vendor-issued *by silence* — the answer that needs no
thought, and wrong about half the time.

### 3.3 One write, one environment

A secret shared by several environments (`FLY_API_TOKEN` is in all three) refuses to write without
`--env`. The tool does not pick, and does not offer "all": one value shared across environments
makes the weakest of them a way into the others.

### 3.4 The rotation note, which is the part that is actually wrong today

`W0-T30`'s seeder runs **once per database** — the `_seed_run` ledger skips it for ever after. So
setting a new `*_SEED_DEMO_PASSWORD` changes **nothing** about an environment that is already
seeded: the next deploy reads the new value and skips the seeder.

The tool says so, every time, next to the value. A rotation tool that implies a rotation happened is
worse than no tool.

`*_BETTER_AUTH_SECRET` genuinely does rotate immediately — it signs sessions, so a new value signs
everyone out of that environment as soon as the app restarts.

**This is a gap in `W0-T30`, not a property of this ticket**, and §7 files it rather than fixing it
here.

## 4. What does not change

- `agents/policies/human-boundaries.md`. This tool does not relax the rule; it is built so the rule
  cannot be broken by running it.
- `REQUIRED` in `scripts/deploy/config.ts`, which stays the single list of what each environment
  needs. This reads it and never edits it.
- The deploy guard's behaviour when a secret is missing: report unconfigured, skip, create nothing.
- Nothing in `apps/`. This is a developer tool and ships in no bundle.

## 5. Acceptance criteria

- **AC1** — Entropy comes from `node:crypto` `randomBytes`. `Math.random` appears nowhere in the
  credential path, and 200 successive values are distinct.
- **AC2** — A generated value clears the floor its variable declares in `EnvSchema`, read from
  `config.ts` at test time rather than duplicated. Every value matches `^[A-Za-z0-9_-]+$`.
- **AC3** — `writeSecret` passes the value on **stdin**; the argument array it builds does not
  contain the value. A failed write reports the failure without echoing what it tried to write.
- **AC4** — `outputIsCaptured` is true for a non-TTY stdout and for `CI` set to anything but empty
  or `false`; false for a TTY. In `main`, the capture check precedes the call to `generate`.
- **AC5** — The `--write` branch contains no `console` call carrying the value; the print-only
  branch is the sole place a value reaches stdout.
- **AC6** — Every name in `REQUIRED` is either generatable or explicitly in `ISSUED_ELSEWHERE`;
  the two sets are disjoint; nothing is listed that no environment requires.
- **AC7** — A secret belonging to one environment resolves without `--env`; one belonging to
  several refuses without it; an `--env` the secret does not belong to is refused; a name absent
  from `REQUIRED` is refused.
- **AC8** — The rotation note for a `*_SEED_DEMO_PASSWORD` says rotation is **not** immediate and
  names the ledger; the note for a `*_BETTER_AUTH_SECRET` says it is.
- **AC9** — `--env value` and `--env=value` both parse; `--list` needs no name.

## 6. For the operator

```bash
tsx scripts/secrets/generate.ts --list                               # what it can and cannot make
tsx scripts/secrets/generate.ts PREVIEW_SEED_DEMO_PASSWORD           # prints it, to paste
tsx scripts/secrets/generate.ts PREVIEW_SEED_DEMO_PASSWORD --write   # sets it, never shows it
```

`--write` needs `gh auth login` with access to the repository's environments. Run it in a real
terminal — piping it anywhere is refused, deliberately.

## 7. Out of scope

- **Making `*_SEED_DEMO_PASSWORD` actually rotatable.** §3.4 — the seeder's ledger row makes a new
  value inert. Filed as **`W0-T32`**: either a `--force <id>` that deletes a ledger row and re-runs
  one seeder, or an explicit decision that demo credentials rotate by re-branching the database.
- **Rotating anything automatically**, on a schedule or otherwise. Rotation of a live credential is
  a human action with a blast radius; this makes the value, nothing more.
- **Reading a secret back.** GitHub does not expose one after it is set, and this tool should not be
  the thing that makes people want it to.
- **Vendor credentials.** `FLY_API_TOKEN` and friends are issued elsewhere; §3.2 records that as
  data so the tool can refuse them by name.
- **`.env` for local development.** `.env.example` holds the local values and none of them is
  secret; that is the point of the file.
