---
task:    W0-T28
agent:   agent-devops
session: 2026-09-14
status:  open
---

# Session — W0-T28

## Goal
Make a deployed browser see one origin: `/api/*` served from the Pages host, forwarded to Fly. Until
this lands, no deployed environment can sign anybody in.

## Current state
Branch `W0-T28-one-origin` off `main` at `11b5ed4`. Spec written; nothing implemented.

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

## Blocked / escalations
None.

## Handoff
Spec is `docs/specs/S0/W0-T28-one-origin.md`. Next action: the red phase —
`apps/web/tests/api-proxy.test.ts` (load the emitted module and exercise it) and the workflow
assertions in `tests/cd-workflows.test.ts`.
