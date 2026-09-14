# W0-T28 — One origin: route `/api/*` from Cloudflare to Fly

- **Slice**: S0 Platform (`agent-devops`)
- **Decides**: how a deployed browser reaches the API. Nothing about the application changes —
  `apps/web/src/shared/api.ts` has defaulted `baseUrl()` to `/` since `W12-T08`, and this is the
  platform half of that default.
- **Unblocks**: `W2-T02` (session policy), and `W2-T09`'s pages working anywhere but a laptop.

---

## 1. Purpose

**A preview deploy cannot sign anybody in, and until `W2-T09` there was nothing that tried.**

The web app is served from `<branch>.marketplace-web-ane.pages.dev` and the API from
`marketplace-api-pr-<n>.fly.dev`. Two things break, in that order:

1. **CORS.** The preview builds the SPA with `VITE_API_URL` pointing at the Fly app, so every call
   is cross-origin. The API's `BETTER_AUTH_URL` is its *own* origin, so better-auth's trusted-origin
   list contains only itself and the response carries no `Access-Control-Allow-Origin`. Observed on
   #247: *"blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present"*.
2. **The cookie**, which would fail next even with the header. `pages.dev` and `fly.dev` are
   different **registrable** domains, so a `SameSite=Lax` cookie is never sent. `ADR-005` rule 3
   chose one origin over credentialed CORS precisely to avoid this, and noted that production
   (`api.<domain>` under `.<domain>`, `OPS-16`) would look fine while every preview was broken —
   which is exactly how it played out.

So the fix is not a header. It is making the browser see **one origin**.

### 1.1 Why not the other three options

- **CORS + `SameSite=None; Secure`.** Gets past the error message and still fails: third-party
  cookie blocking is on by default in the browsers this product's users have. It also makes the one
  environment where auth is *developed* the only one whose cookie behaviour matches nothing that
  ships.
- **`_redirects`.** Cloudflare Pages' `_redirects` cannot rewrite to another host with a `200`; it
  can only redirect, and a redirect changes the origin the browser sees, which is the whole problem.
- **A Cloudflare Worker with a route.** Correct for production on a real domain (`OPS-16`), and
  unavailable for `*.pages.dev` previews, which cannot carry custom Worker routes.

## 2. Design

### 2.1 A Pages advanced-mode worker

`_worker.js` in the deployed directory puts a Worker in front of the whole site. It forwards
`/api/*` to the Fly app and hands everything else to the static assets binding:

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return fetch(new Request(new URL(url.pathname + url.search, API_ORIGIN), request));
    }
    return env.ASSETS.fetch(request);
  },
};
```

`new Request(target, request)` keeps the method, the headers (`Origin`, `Cookie`,
`Content-Type`) and the body, and the response comes back with its `Set-Cookie` intact. The cookie
better-auth sets carries no `Domain`, so it becomes a host cookie for the Pages hostname — which is
the origin the browser is on. `SameSite=Lax` is then satisfied by construction rather than relaxed.

### 2.2 The origin is baked at build time, not configured at runtime

`wrangler pages deploy` cannot set an environment variable for the deployment it is creating, and a
Pages project variable is one value shared by every preview — while each preview has its own API.
So the Vite build emits `_worker.js` with the origin substituted. The build already knows which API
it is for; a placeholder that resolves at runtime would need configuration that does not exist.

**No origin configured, no worker emitted.** A local `vite preview` and any build that is already
same-origin get a plain static site, because a worker pointing at nothing is worse than no worker:
it turns every `/api/*` call into a 5xx from the edge instead of an honest 404.

### 2.3 `BETTER_AUTH_URL` becomes the web URL, and the deploy is reordered for it

better-auth builds its own URLs from `baseURL` **and** derives `trustedOrigins` from it. With one
origin, both wants the same answer: the Pages URL.

That URL is only known after `wrangler pages deploy` prints it, and this workflow refuses to
construct a `*.pages.dev` name rather than guess one (`W0-T24`: a guessed hostname gave every
reviewer a dead link). So the order changes:

```
migrate → build web → deploy web → read the URL → set the API's secrets → deploy the API
```

The migration still precedes the API deploy, which is what `AC16` asks. The web build no longer
needs `VITE_API_URL` at all — `baseUrl()` returns `/` — and instead takes the API origin for the
worker, which preflight already knows from the PR number.

### 2.4 The deploy checks its own work

A worker that failed to deploy is silent: `/api/*` falls through to the SPA's `index.html`, and the
first symptom is a JSON parse error in a browser nobody has opened yet. So the workflow curls
`<pages-url>/api/health` after deploying and fails the job unless it gets the API's own JSON.

That single request proves the whole seam — Pages served the worker, the worker resolved the origin,
Fly answered, and the response came back through the edge.

### 2.5 Preview and staging; production waits for `OPS-16`

Both deploy `*.pages.dev` + `*.fly.dev`, so both get the worker. **Production is left alone**: it has
no domain yet (`OPS-16`), nothing to verify against, and the moment it has one the right answer may
be a Worker route on the real domain rather than this file. Changing it now would be a change
nobody can test, in the environment where that is least acceptable.

## 3. Acceptance criteria

- **AC1** With an API origin configured, the build emits `_worker.js` at the root of the output.
- **AC2** With none configured, it emits no `_worker.js`.
- **AC3** The emitted module — loaded and executed, not string-matched — forwards `/api/health` to
  the configured origin, preserving method, headers and body.
- **AC4** It forwards `/api` itself, and does **not** forward `/apiary` or `/es/api`.
- **AC5** Everything that is not `/api/*` goes to the assets binding, and the worker adds no headers
  of its own to it.
- **AC6** A `Set-Cookie` on the API's response survives the round trip unmodified.
- **AC7** `apps/web`'s `baseUrl()` still returns `/` when `VITE_API_URL` is unset — the application
  half of this, unchanged and asserted here because this ticket is what makes it load-bearing.
- **AC8** `deploy-preview.yml` and `deploy-staging.yml` set no `VITE_API_URL` for the web build.
- **AC9** Both set `BETTER_AUTH_URL` to the **web** URL, taken from the Pages deploy step's output,
  never to a `fly.dev` URL.
- **AC10** In both, the web deploy step precedes the step that sets the API's secrets, which
  precedes the API deploy.
- **AC11** Both verify `<web-url>/api/health` after deploying and fail if it does not answer.
- **AC12** `release-production.yml` is unchanged, and the spec says why.
- **AC13** The preview comment tells a reviewer that auth now works there — and that mail still does
  not, until `OPS-14`.

## 4. Out of scope

`OPS-16` (a real domain) · production's routing · edge caching of anything · rate limiting at the
edge · the Storybook workbench deploy, which has no API and needs no worker.

## 5. Open questions

- **Q1** The worker forwards every `/api/*` request, including ones that could be cached at the
  edge. Nothing is cacheable today (auth and `/health`); when `GET /search` lands, a `Cache-Control`
  on the API side is the lever, not a rule in this worker.
- **Q2** Production still points the SPA at the API's own origin. When `OPS-16` lands, the choice is
  this worker with a different origin, or a Worker route on the real domain. Both are one line; the
  decision needs the domain to exist first.
