# ADR-006: Hosting, environments and data protection

## Status
Accepted — 2026-09-07

## Context
We need three environments (ephemeral per feature branch → staging → production) on the cheapest
reliable footing, with database encryption as a hard requirement and per-branch database isolation
so agents working in parallel never share state. Code lives on **GitHub**, with CI on **GitHub
Actions**.

## Decision

| Layer | Choice | Cost (Sept 2026) |
|---|---|---|
| Postgres | **Neon** | Free tier: 0.5 GB + 100 CU-h/mo. Launch: $0.106/CU-hour, storage $0.35/GB-month, no monthly minimum |
| API | **Fly.io** | `shared-cpu-1x` 512MB ≈ $1.94/mo, 1GB ≈ $5.70/mo; volumes $0.15/GB-mo; egress $0.02/GB. No mandatory plan fee |
| Web | **Cloudflare Pages** | Free. **Unlimited concurrent preview deployments**; 500 builds/mo, 1 concurrent build |
| Objects | **Cloudflare R2** | Zero egress fees |
| Feature flags | **Flagsmith** (free cloud) | Unlimited flags **and unlimited environments**, 50k requests/mo, 1 team member — see ADR-007 |
| Errors | **Sentry** free tier | 5k errors/mo |
| CI | **GitHub Actions** | Free for public repos; 2,000 min/mo on free private |

**Estimated run cost**: dev + staging **$15–30/mo**; adding production at beta scale **$25–50/mo**.

### Environment topology

| Env | App | Database | Flags | Trigger |
|---|---|---|---|---|
| **dev** (`feat/XXX`) | Fly app per PR, scale-to-zero, + Cloudflare Pages preview URL | **Neon branch from the sanitised staging branch** — copy-on-write, created in <1s | all OFF except this branch's own flag, forced ON | PR opened/updated; **destroyed on merge or close** |
| **staging** | Fly app, always-on | Neon `staging` branch, seeded demo data | toggleable per env | auto-deploy on merge to `main` |
| **production** | Fly app, ≥2 machines | **Separate Neon project** (not a branch) | default OFF; rollout by flag, not by deploy | **manual**: tag a commit, promote the tested artifact |

Two deliberate constraints:
1. **Production is a separate Neon project, never a branch.** Separate keys, separate blast radius,
   and structurally impossible to branch a preview off real customer data.
2. **Preview branches come from a sanitised staging branch.** Licence documents and PII must never
   reach an ephemeral environment. Sanitisation is part of the seed pipeline, not a manual step.

Production releases promote the **same artifact** already tested on staging — no rebuild. Migrations
run as a separate, approved, observable step; never implicitly on boot.

### Data protection
- **In transit**: TLS everywhere; Postgres connections use `sslmode=verify-full` with a pinned CA.
  `require` is not sufficient — it does not verify the server.
- **At rest**: Neon and R2 are AES-256 encrypted at rest by default.
- **Application-level**: envelope encryption on genuinely sensitive columns — licence numbers,
  document keys, phone numbers — with a per-environment data key stored in Fly secrets. Keys never
  enter the repo, CI logs, or memory files.
  **Tradeoff**: encrypted columns cannot be indexed or searched. For lookup fields (email, phone)
  store a keyed hash alongside the ciphertext.
- **Licence documents**: private R2 bucket, no public URLs ever, short-lived presigned GETs, access
  logged, AV-scanned, EXIF-stripped (see `memory/repo/gotchas.md` MEM-2026-09-07-08).
- **Backups**: Neon PITR. A restore drill is part of the `W10-T08` runbooks — an untested backup is
  not a backup.
- Distinct keys and credentials per environment. No credential is ever shared across envs.

### Local development
Both paths, deliberately:
- `docker-compose` Postgres + PostGIS for unit/integration tests — fast, free, offline, and what CI
  uses.
- `neonctl branches create --name dev/<you>` for a personal cloud branch when real data shape
  matters. Same connection-string shape, so nothing in the app knows the difference.

## Alternatives considered

**Codeberg for hosting the repo.** Considered and rejected for now: Forgejo Actions requires a
self-hosted runner, and Codeberg CI (Woodpecker) uses a different workflow syntax from everything
this plan assumes. The friction is not worth it at MVP; revisit if we want off GitHub later. Nothing
in the stack depends on GitHub beyond the CI workflow files.

**Hetzner VPS (~€4/mo) + Coolify + Postgres container.** Roughly 1/5 the cost. Rejected for the MVP:
we would lose instant DB branching (requiring scripted `CREATE DATABASE … TEMPLATE` clones) and take
on backups, patching, encryption configuration and uptime ourselves — poor trade when agents perform
the ops and encryption is a stated hard requirement.

**Supabase.** Also offers branching, but bundles auth and APIs we are deliberately building
ourselves; more surface than we need.

**Vercel + Neon.** Excellent preview DX, but commercial use requires a paid plan, and we are not
running Next.js.

## Consequences
- Fly has **no Madrid or Spain region** — nearest are Paris and Amsterdam (~25ms from Madrid).
  Acceptable for this product; revisit if latency becomes a complaint.
- Cloudflare Pages' single concurrent build on the free tier can queue previews when several agents
  push at once. Watch it; $5/mo lifts the limit if it bites.
- Flagsmith free is capped at 50k requests/month and **one team member** — evaluate flags
  server-side with local caching, never per-request from the client (see ADR-007).
- Neon is plain Postgres, so a later move to self-hosted is a `pg_dump` away. **This is not a
  lock-in decision.**

## Rollback
Each layer is independently replaceable: Fly → Railway/Render/Hetzner; Cloudflare Pages → Netlify;
Neon → any managed or self-hosted Postgres; GitHub → Codeberg/GitLab (rewriting the workflow files). The only genuinely coupled piece is Neon's branching
automation in CI, which is ~50 lines of workflow.
