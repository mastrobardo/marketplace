# W0-T27 — run record

- **Session**: 2026-09-26, `agent-devops` (same session as `W0-T33`)
- **Spec**: [W0-T27-mirror-repoint.md](W0-T27-mirror-repoint.md)
- **Outcome**: the whole stack pulls from this repository's registry; the mirror check works.

---

## 1. What the first mirror run actually did

Merging #293 fired `mirror-images` from its `push` path filter, with no dispatch needed. Run
[36266198605](https://github.com/mastrobardo/marketplace/actions/runs/36266198605): **all four
copies succeeded**, the check then failed on the fourth.

```
ghcr.io/mastrobardo/marketplace/postgis:17-3.5-alpine: linux/amd64 and linux/arm64 present
ghcr.io/mastrobardo/marketplace/mailpit:v1.27: linux/amd64 and linux/arm64 present
ghcr.io/mastrobardo/marketplace/garage:v2.4.1: linux/amd64 and linux/arm64 present
##[error]ghcr.io/mastrobardo/marketplace/alpine:3.22 is missing linux/amd64
```

The copy was not missing amd64. It is digest-for-digest identical to upstream:

```
alpine:3.22            upstream sha256:5291449c…  mirror sha256:5291449c…  identical
garage:v2.4.1          upstream sha256:9c96caa2…  mirror sha256:9c96caa2…  identical
postgis:17-3.5-alpine  upstream sha256:97a2ace7…  mirror sha256:97a2ace7…  identical
mailpit:v1.27          upstream sha256:e22dce5b…  mirror sha256:e22dce5b…  identical
```

## 2. Diagnosing it, including the mistake in the middle

The first hypothesis — `grep -q` closing the pipe and `pipefail` seeing SIGPIPE — did **not**
reproduce locally, so it looked wrong. It was right; the reproduction was. The Bash tool's shell
here is `zsh`, which handled it, and the runner uses `bash -euo pipefail`:

```
$ bash -c 'set -euo pipefail; docker buildx imagetools inspect …/alpine:3.22 | grep -qE "^ *Platform: *linux/amd64$"'
(exits non-zero, printing nothing — the script dies before the next line)
```

Then the fix reintroduced the identical bug one line later, as `awk '/^Digest:/{print $2; exit}'`,
and the local run caught it: `inspect upstream FAILED 255` — on alpine only, again.

The step is now verified by **extracting it verbatim out of the YAML** and running that, rather than
by running something resembling it:

```
$ bash scratchpad/check.sh
…/postgis:17-3.5-alpine: amd64 + arm64, sha256:97a2ace7… (identical to upstream)
…/mailpit:v1.27:         amd64 + arm64, sha256:e22dce5b… (identical to upstream)
…/garage:v2.4.1:         amd64 + arm64, sha256:9c96caa2… (identical to upstream)
…/alpine:3.22:           amd64 + arm64, sha256:5291449c… (identical to upstream)
step exit=0
```

A second latent bug surfaced on the way: alpine publishes `linux/arm64/v8`, so the anchored pattern
would have reported a false miss on arm64 even after the SIGPIPE fix.

## 3. The visibility claim, measured

`#293` asserted the packages were private and needed four manual flips. The operator said they
looked public. They were, and this is how that was settled — anonymously, without the daemon's
credentials being involved at all:

```
postgis  17-3.5-alpine  anonymous manifest: 200
mailpit  v1.27          anonymous manifest: 200
garage   v2.4.1         anonymous manifest: 200
alpine   3.22           anonymous manifest: 200
```

## 4. Verification of the repoint

`docker logout ghcr.io` first (and the daemon held no GHCR credentials to begin with), then every
stack image deleted locally, so the pulls below are anonymous and cold:

```
$ pnpm stack:up
objects-init: marketplace-uploads ready
pnpm stack:up  18.336 total

$ STACK_LIVE=1 pnpm vitest run tests/local-stack.test.ts   → 15 passed
$ pnpm vitest run tests/                                    → 322 passed, 6 skipped
$ STACK_LIVE=1 pnpm --filter @marketplace/api exec vitest run → 571 passed
$ pnpm typecheck && pnpm format:check                       → ok
```

## 5. What is left

Nothing in the repository. `W0-T27` and `W0-T33` are both closed by this. The mirror refreshes
weekly and on demand, and a pin change re-mirrors on the push that makes it.
