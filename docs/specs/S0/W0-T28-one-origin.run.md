# W0-T28 — run record

- **Branch**: `W0-T28-one-origin`, off `main` at `11b5ed4`
- **Spec**: `docs/specs/S0/W0-T28-one-origin.md`
- **Session**: `memory/sessions/2026-09-14-agent-devops-W0-T28.md`
- **Trigger**: the operator, on #247's preview — *"blocked by CORS policy: No
  'Access-Control-Allow-Origin' header is present"*. `W2-T09` is the first thing that ever tried to
  authenticate from a deployed browser, so this had been latent since `W0-T07`.

---

## 1. Red phase

```
 Test Files  1 failed (1)          tests/cd-workflows.test.ts
      Tests  8 failed | 97 passed (105)

Error: Cannot find module '../vite/api-proxy.js'
      Tests  no tests               apps/web/tests/api-proxy.test.ts
```

The eight are the workflow assertions (AC8–AC12); the module is the worker, which did not exist.

## 2. Four things the implementation found, three of them by running it

### 2.1 `/api/health` does not exist — the probe would have failed in CI

The obvious health check through the edge is `<web>/api/health`. The API serves **`/health`, at its
root**; the edge forwards only `/api/*`; so `/api/health` came back as the API's own
`404 NOT_FOUND` envelope. Found by running the worker locally rather than by reading.

The probe is `<web>/api/auth/get-session`, which is a better one anyway: `200` with a `null` body
proves Pages served the worker, the worker resolved the origin, Fly answered **and** better-auth is
mounted — the whole seam, in one request.

### 2.2 The storefront was calling the API at the root, not under `/api`

`shared/api.ts` asked for `categories`, `search` and `providers/:id` — no prefix. With one origin
those paths belong to the *application*, so the edge would have handed each one the SPA's
`index.html`: a `200` full of HTML that fails as a JSON parse error a long way from its cause. It
was invisible until now because `VITE_API_URL` pointed at the API's own host and MSW answered those
three in preview.

All three now carry the `api/` prefix, and `AC7` derives the check from the source so a fourth call
cannot be added without it. **This widens the ticket by three lines and it is not scope creep:** a
proxy that only forwards `/api/auth/*` would leave "the browser sees one origin" false for every
other call, and the first `W3` endpoint would break on deploy in exactly the way this ticket exists
to prevent. `W3-T01`/`W3-T05`/`W3-T07` must mount their routes under `/api`.

### 2.3 Two existing gates caught the smoke step, and both were right

`AC29` (every CLI is installed first) rejected `cat`, and `AC31` (never swallow the error you just
caused) rejected `cat body.json >&2 || true`. Rather than widening either gate, the retry loop was
replaced by `curl --retry 5 --retry-delay 5 --retry-all-errors --retry-connrefused`, which removes
the loop, the `sleep` and the `cat` together — and handles a machine that is still booting better
than the loop did.

### 2.4 Production deploys no web app at all

`AC12` was written as *"production still points the SPA at the API"*. It does not: the release
migrates and promotes the API image, and deploys no storefront. So the exemption rests on a fact —
there is no second origin to unify — and the assertion now says that, with a companion assertion
that preview and staging both still do deploy one, so the exemption cannot spread by accident.

## 3. Driven end to end, through a real edge worker

`wrangler pages dev` over the built `dist`, against the local API with
`BETTER_AUTH_URL=http://127.0.0.1:8788` (the edge's own origin, which is what the deploy now does):

```
GET  /es/signup                     200   (static, from the assets binding)
GET  /api/auth/get-session          200   null
POST /api/auth/sign-up/email        200   user created
     emailed link → http://127.0.0.1:8788/api/auth/verify-email?token=…&callbackURL=%2Fes%2Fverify-email
GET  that link                      302   Location: /es/verify-email
                                          Set-Cookie: better-auth.session_token=…; Path=/; HttpOnly; SameSite=Lax
POST /api/auth/sign-in/email        200   cookie stored for 127.0.0.1 — the web origin
GET  /api/auth/get-session          200   the session
POST /api/auth/sign-out             200   {"success":true}
```

The last line is the one that matters: a cookie-carrying `POST` with `Origin: <web>`, which is
precisely the request that answers `403 INVALID_ORIGIN` when the two hosts differ. The emailed link
points at the **web** origin, and the cookie is first-party because there is only one origin to be
first party to.

Before `BETTER_AUTH_URL` was corrected, the same sign-up through the same worker answered
`403 {"code":"INVALID_ORIGIN"}` — the failure mode this ticket removes, reproduced on purpose.

**What is not verified here:** the browser-UI half. `/es/signup` does not exist on `main` — it is
#247 — so a Playwright pass against the edge has nothing to click. It is the first thing to do on
#247's preview once this merges, and the preview comment now tells the reviewer to expect it to work.

## 4. The gates

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build` — all green, 10/10
workspace tasks. `tests/cd-workflows.test.ts` is 105 tests, 13 of them new.

## 5. Known gaps

- **Staging is unverified.** It is the same change as preview, in a workflow that only runs on a
  push to `main`, and nothing can exercise it from a pull request. The shared assertions cover the
  shape; the first merge to `main` is the first real run.
- **Mail still does not work anywhere deployed** (`OPS-14`). Auth now *functions* on a preview; a
  sign-up there still strands the account, and the preview comment says so.
- **This branch and #247 both edit `apps/web/src/shared/api.ts`.** Whichever merges second needs a
  rebase — the conflict is the `api/` prefix meeting the auth methods, and it is textual rather than
  semantic.

## 6. Open questions

- **Q1** Caching at the edge. The worker forwards everything; nothing is cacheable today. When
  `GET /api/search` lands, `Cache-Control` from the API is the lever, not a rule in the worker.
- **Q2** Production. When a storefront and a domain exist (`OPS-16`), the choice is this worker with
  a different origin, or a Worker route on the real domain. Both are one line, and neither can be
  decided before the domain exists.
- **Q3** `wrangler pages dev` warns that its bundled runtime predates the compatibility date the
  project asks for. It does not affect this worker — `fetch`, `Request` and `URL` are not new — but
  it is the reason the local proof is a proof of *this* logic rather than of the deployed runtime.
