---
task:    W0-T28
agent:   agent-devops
session: 2026-09-14
status:  closed
---

# Session — W0-T28

## Goal
Make a deployed browser see one origin: `/api/*` served from the Pages host, forwarded to Fly. Until
this lands, no deployed environment can sign anybody in.

## Current state
**Done.** `_worker.js` emitted by the web build, both deploy workflows reordered and checking their
own work, every client path under `/api`. `pnpm verify` green. Driven end to end through a real
`wrangler pages dev` worker — including the cookie-carrying POST that 403s when origins differ.

## Log
- 15:40 the operator hit it live on #247's preview: *"blocked by CORS policy: No
  'Access-Control-Allow-Origin' header"*. Confirmed the cause in the workflow rather than guessing:
  `deploy-preview.yml:278` builds the web with `VITE_API_URL=https://<app>.fly.dev`, and
  `:245` sets the API's `BETTER_AUTH_URL` to its own Fly origin — so better-auth trusts only itself
  and echoes no ACAO for the Pages host.
- 15:45 fixing the header alone would not help: `pages.dev` and `fly.dev` are different registrable
  domains, so the `SameSite=Lax` cookie is never sent either. Measured locally that the origin check
  is live — a foreign `Origin` with a cookie is `403 INVALID_ORIGIN`.
- 15:50 `_redirects` cannot rewrite to another host with a 200, and `*.pages.dev` cannot carry a
  Worker route. Pages **advanced mode** (`_worker.js` in the deployed directory) is the mechanism.
- 15:55 the origin has to be baked at build time: `wrangler pages deploy` cannot set a variable for
  the deployment it creates, and a project-level variable is one value shared by every preview,
  while each preview has its own API.

- 16:20 `/api/health` is a 404: the API serves `/health` at its root and the edge forwards only
  `/api/*`. Probe is `/api/auth/get-session` — better proof anyway.
- 16:25 the storefront called `categories`/`search`/`providers/:id` at the root; with one origin
  those hit the SPA. Prefixed all three, and `AC7` derives the check from the source.
- 16:35 `AC29` and `AC31` both rejected the smoke step (`cat` is not an installed CLI; `|| true`
  swallows errors). `curl --retry --retry-all-errors --retry-connrefused` removes the loop, the
  `sleep` and the `cat` at once.
- 16:40 `release-production.yml` deploys no web app — the AC that assumed otherwise now asserts the
  fact instead.

## Blocked / escalations
None.

## Handoff
Verify the **browser** half on #247's preview once this lands: the auth pages do not exist on
`main`, so nothing here could click them. Staging is the same change in a workflow only `main` can
run — the first merge is its first real exercise.

Do not re-derive: the mechanism (advanced-mode `_worker.js`; `*.pages.dev` cannot take a Worker
route, `_redirects` cannot rewrite cross-host), why the origin is baked at build time, or the
`/api` prefix rule. All three are in `memory/slices/agent-devops.md`.
