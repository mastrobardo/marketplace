# W0-T27 — the stack pulls from a registry this repository owns

- **Slice**: S0 Platform (`agent-devops`)
- **Decides**: where `pnpm stack:up` gets its images, and what a copy has to prove before it counts
  as a mirror.
- **Completes**: `W0-T33` (#293), which landed the workflow and left the repoint behind a human step
  that turned out not to exist.

---

## 1. Purpose

`#293` added `.github/workflows/mirror-images.yml` and `docker/mirror.images`, and deliberately did
**not** repoint `docker-compose.yml` at the copies. The stated reason: GHCR packages are created
private, `GITHUB_TOKEN` cannot change that, so repointing before four manual visibility flips would
pass CI — which has a token — and break every clone, which does not.

**That reason was wrong, and it was never measured.** The packages were public the moment the
workflow first pushed them: a package published by Actions and linked to a **public** repository
inherits that visibility, while "the default is private" describes a package scoped to a personal
account. An anonymous token plus a manifest `GET` answers 200 for all four (`MEM-2026-09-26-6`).

The same run also went red, and not because a copy was bad. Every copy was correct on the first
attempt; the workflow's own verification step was broken (§3.1).

## 2. What changes

`db` and `mail` in `docker-compose.yml`, and both `FROM` lines in `docker/garage/Dockerfile`, pull
from `ghcr.io/mastrobardo/marketplace/…`. Nothing about what runs changes: the copies are the same
bytes as their upstreams, which §3.2 now asserts rather than assumes.

## 3. Design

### 3.1 A check that fails closed is still a broken check

The verification step reported `alpine:3.22 is missing linux/amd64` for an index that contains it.
Two independent bugs, both of which report a false miss:

- **`grep -q` under `set -o pipefail`.** `grep -q` exits at its first match; `docker buildx
  imagetools inspect` is then writing into a closed pipe, dies of SIGPIPE (255), and `pipefail`
  makes the pipeline fail. It is timing, so it presents as flake — it hit `alpine`, the longest of
  the four listings, and spared the three shorter ones. Fixed by capturing each listing into a
  variable once and matching against that, never through a pipe into an early-exiting consumer.
  `MEM-2026-09-26-7` carries the trap, including that it reproduces under `bash` and not `zsh`.
- **`linux/arm64/v8`.** Alpine publishes arm64 with a variant suffix; the others publish plain
  `linux/arm64`. The pattern now accepts an optional `/vN`.

### 3.2 A copy is a mirror only if it is the same bytes

`imagetools create` copies the manifest rather than rebuilding it, so the mirror's index digest
equals the upstream's. Every image is therefore pinned to the **upstream digest**, which makes the
pin do double duty: it is the usual protection against a re-pointed tag, and it is a check that the
copy was not altered. The workflow asserts the equality on every run, so the day that stops being
true is the day it goes red rather than the day someone notices.

## 4. Acceptance criteria

1. **Every image in the stack resolves to `ghcr.io/mastrobardo/marketplace/…`**, pinned by tag and
   upstream digest.
2. **A cold `pnpm stack:up` works with no GHCR credentials** — the daemon logged out, every stack
   image deleted locally first.
3. **`W0-T02`'s twelve criteria pass unchanged**, live, plus the repo and `apps/api` suites.
4. **The mirror workflow's own check passes**, and fails if a copy loses `linux/amd64` or
   `linux/arm64` (variant-tolerant) or stops matching its upstream digest.
5. **The false claim is corrected where it was made** — run record, backlog row, and
   `MEM-2026-09-26-5` superseded rather than deleted.
