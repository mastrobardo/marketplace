# W2-T09 — run record

- **Branch**: `W2-T09-account-pages`, off `main` at `11b5ed4`
- **Spec**: `docs/specs/S2/W2-T09-account-pages.md`
- **Session**: `memory/sessions/2026-09-14-agent-identity-W2-T09.md`

---

## 1. The two decisions, taken before any code

Both were open in `TODO.md` and both were put to the operator first, because each one shapes a form
that is then expensive to reshape.

1. **`ADR-005` Q1 — signup always creates a `CLIENT`.** No role fork. `W2-T01` made `roles`
   `input: false`, so a sign-up body cannot ask for `PROVIDER`; the alternative needed API surface
   that `W2-T03` has not built. `become-a-pro` keeps its own identity as the upgrade entry point.
2. **The form schemas stay local to `apps/web`.** They validate a form, not a wire contract we
   publish — and `packages/contracts` is the frozen seam under **L3**.

Verified against the running API afterwards: a fresh sign-up returns `"roles":["CLIENT"]`, supplied
by the column default, with no role in the request.

## 2. Red phase

Tests first, run, watched to fail, then implemented. Full output in the session scratch; the shape
of it:

```
 ❯ tests/auth-api.test.ts (13 tests | 10 failed) 12ms
 ❯ tests/auth.test.tsx   (29 tests | 28 failed) 2567ms

 Test Files  2 failed (2)
      Tests  38 failed | 4 passed (42)

TypeError: createApiClient(...).signIn is not a function
TypeError: api.resendVerification is not a function
TestingLibraryElementError: Unable to find a label with the text of: /^Nombre/
```

and in `packages/ui`:

```
 ❯ tests/auth-wall.test.tsx (7 tests | 2 failed)
   × renders a link to where the flow continues
   × holds no copy of its own for the action
```

**The four that passed were the honest kind of vacuous**, and they are worth naming because two of
them are gates: `AC6` (no catalogue may say an address is taken) iterated a catalogue with no
`auth.` keys in it yet, and `AC22`/`AC23` walked source trees where the offending pattern did not
exist. Each became load-bearing the moment the implementation landed; none of them could have been
written *after* the code without being written to fit it.

## 3. What was built

| | |
|---|---|
| `apps/web/src/routes/` | `signup`, `login`, `verify-email`, `reset-password`, `reset-password-set` — each a `Component` + an `action` |
| `apps/web/src/features/auth/` | `schema.ts` (zod, messages as translation keys), `form.tsx` (RHF ↔ router `action`), `actions.ts` (the shared decisions), `InboxPanel.tsx` |
| `apps/web/src/shared/` | `session.ts` (new), auth methods on `api.ts`, `queryKeys.session()` |
| `apps/web/src/routes/root.tsx` | the session in the loader, the two doors in the header, sign-out as the layout route's `action` |
| `packages/ui` | `AuthWall` gains an optional `action`; one story, pinned |
| i18n | 46 new keys, ES and EN |

New dependencies in `apps/web`: `react-hook-form`, `@hookform/resolvers`, `zod` (pinned to the
`^4.5.4` the rest of the workspace is on).

## 4. Six things measured rather than assumed

Everything below was read out of the installed `better-auth@1.7.4` or driven against the running
stack. Each one changed the code.

### 4.1 `ensureQueryData` ignores invalidation — the sign-out bug

The action invalidated the session query correctly and the header still showed the signed-out user.
`queryClient.ensureQueryData` reads `query.state.data` and **returns it whenever it is defined**,
fetching only when the cache is empty (query-core 5.102, `queryClient.ts:75`). `invalidateQueries`
marks a query stale; it does not clear its data. So the loader answered from the cache it had just
been told was wrong.

`loadSession` uses **`fetchQuery`**, which honours `staleTime` — fresh data returned without a
request, stale or invalidated data refetched and awaited. `shared/categories.ts` still uses
`ensureQueryData` and is still right to: nothing invalidates the category list.

### 4.2 `BETTER_AUTH_URL` is the web origin, and two different things break if it is not

`.env.example` already sets it to `http://127.0.0.1:5173`, and both halves of why are now measured:

- the emailed link came through as
  `http://127.0.0.1:5173/api/auth/verify-email?token=…&callbackURL=%2Fes%2Fverify-email` — it
  resolves against `baseURL`, so pointing that at the API's own port produces mail whose links
  bypass the app entirely;
- `trustedOrigins` defaults to its origin, and the origin check is live. A cookie-carrying `POST`
  with a foreign `Origin` answers `403 {"code":"INVALID_ORIGIN"}`. Every signed-in write from the
  dev server would fail that way if the variable named the API.

### 4.3 A `POST` with `Content-Type: application/json` and no body is a `400`

Sign-out is the one call with nothing to send, and it answered
`400 VALIDATION_FAILED, "Body cannot be empty when content-type is set to 'application/json'"` —
from **our** error envelope, not better-auth's. `plugins/auth.ts` registers its pass-through parser
as `*`, which Fastify uses only for content types that have no parser of their own, so
`application/json` still goes through the built-in one. `signOut()` posts `{}`.

*(A side observation, not acted on: this means `W2-T01` §4.3's "the bytes we forward are the bytes
we received" does not hold for `application/json` — Fastify parses and the plugin re-attaches the
parsed object. Nothing signs the body today, so nothing is broken. Left for `agent-identity`'s next
task rather than fixed here — L10.)*

### 4.4 The error body carries the code, in two shapes

`403 {"message":"Email not verified","code":"EMAIL_NOT_VERIFIED"}` from better-auth;
`{"error":{"code":"VALIDATION_FAILED",…}}` from ours. `api.ts`'s `call()` now lifts whichever is
present into `ApiError.message`, so the login page can require **both** the `403` and the code
before it says "check your inbox" — a bare `403` is also what an origin check produces.

### 4.5 `get-session` answers `200` with a literal `null`

Four bytes, not a `401`. A client that treated the signed-out state as a failure would render the
500 page to every first-time visitor. `SessionSchema` is `.nullable().catch(null)`.

### 4.6 The shell must not retry the session

The session call blocks the first paint (a header that flips from "log in" to a name is worse than
one that is right a moment later). With the default retry policy a network failure put **a full
second of blank page** in front of the visitor — `AC19` failed on the timeout — to answer a question
whose fallback is already the safe one. `retry: false`, and the fallback is signed-out.

## 5. Driven end to end, locally

Against `pnpm stack:up` + the API + the dev server, through the Vite proxy — the path a browser
takes. Sign-up `200` with `roles:["CLIENT"]` → Mailpit → the emailed link `302`s to
`/es/verify-email` → sign-in `200` and a `better-auth.session_token` cookie → `get-session` returns
the user → reset request `200` → the reset link `302`s to
`/es/reset-password/set?token=…` → `reset-password` `200` → sign-in with the new password `200`.

The three refusals, unprompted and identical: wrong password and unknown address both
`401 INVALID_EMAIL_OR_PASSWORD`, byte for byte. A duplicate sign-up returned `200` with
`"roles":null`. A reset request for an address with no account returned the same `200` and the same
sentence as one with.

Then the same flow in a real browser (Playwright, chromium): header → signup → inbox panel →
unverified login → inbox panel → emailed link → verified page, with the header now reading
**Ana Pérez · Salir** → sign-out → the two links back → `become-a-pro`'s wall → `/es/signup`. One
console error, and it is the `403` of the deliberately-unverified sign-in.

## 6. One existing test changed, and why

`home.test.tsx` AC26 asserted that `become-a-pro`'s wall contains **no link**. That assertion was
correct when it was written — there was no signup page, so a link would have been a 404 with better
manners — and this ticket removes its premise rather than its principle. It now asserts the link
goes to `/es/signup` and that there is exactly one: the pro upgrade (`W2-T05`) still does not exist
and is still a sentence rather than a control. The change is called out in the test itself.

## 7. The gates

`pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm build` — all green.
**250/250** in `packages/ui`, **207/207** in `apps/web`, 10/10 workspace tasks.

Two gates caught real defects rather than passing politely:

- `tokens.test.ts` AC6 and the Storybook axe run both failed the new wall link at **3.96:1** against
  the muted surface (`--mp-color-accent-strong`), and again at **4.19:1** with `--mp-color-primary`.
  It is now the wall's own text colour, underlined — and the underline is the better answer anyway,
  because a link distinguished only by colour fails for the people the contrast rule is for.
- `visual-coverage.test.ts` refused the new story until it was pinned. **The baseline for
  `patterns-authwall--with-action` does not exist yet** — the nightly (`W12-T16`) generates it.

## 7b. One API call per write — operator, 2026-09-14

*"The whole login flow should be 1 api call."* It was three, measured in a browser rather than
guessed:

```
GET  /api/auth/get-session      the shell's loader, on page load
POST /api/auth/sign-in/email    the sign-in
GET  /api/auth/get-session      after the redirect, because the action invalidated
```

The third is now gone. better-auth's sign-in response **carries the authenticated user**, so the
action seeds the session cache (`setQueryData`) with the server's own answer instead of invalidating
and asking for what it was just told. Sign-out does the same with `null`. Both are measured and
asserted by call count (`AC27`, `AC18`), not by outcome — an assertion on the header alone passes
either way.

```
== login ==      GET /api/auth/get-session · POST /api/auth/sign-in/email
== sign-out ==   POST /api/auth/sign-out
== navigating while signed in ==   (nothing)
```

**The asymmetry is deliberate and `AC28` holds it:** a write that *failed* has told us nothing, so
it falls back to invalidating. Seeding either answer there would be the client inventing one — which
is the thing `setQueryData` is usually wrong for, and the reason the distinction is written down in
`shared/session.ts` rather than left as a trick.

The remaining `get-session` is the page load, and every page pays it: it is the header knowing who
you are before it paints (R3). Navigating while signed in costs nothing — the 60-second cache.

**And the `/email` in those paths is not mail.** `sign-up/email` and `sign-in/email` are
better-auth's route names for the **email-and-password provider**; `/email` is the credential type.
No message is ever sent by the browser — `apps/api/src/auth/mail.ts` sends it, server-side, over
SMTP. The one mail-triggering endpoint the web can reach is `send-verification-email`, which is the
resend button, and the API still does the sending.

## 8. Known gaps

- **Auth does not work on a preview deploy, and `W0-T28` is why.** The preview builds the SPA with
  `VITE_API_URL` pointing at the Fly app, so the browser calls it cross-origin, and the API's
  `BETTER_AUTH_URL` is its *own* origin — so better-auth trusts only itself and sends no
  `Access-Control-Allow-Origin` for the Pages host. Observed by the operator on #247's preview:
  *"blocked by CORS policy"*. Fixing the header alone would not help: `pages.dev` and `fly.dev` are
  different registrable domains, so the `SameSite=Lax` session cookie is never sent either.
  `ADR-005` rule 3 chose one origin over credentialed CORS for exactly this reason.
- **No SMTP in any deployed environment until `OPS-14`.** Sign-up returns `200`, the mail throws,
  and the account is stranded — sign-in refuses, re-registering is the synthetic `200`, resend is a
  `500`. The verify page and the resend control say so; they do not claim a message is on its way.
  **Do not demo this from a preview deploy.** Locally, against Mailpit, it works end to end.
- The verification and reset **emails are English** (`W2-T01`'s gap, §10 Q2 there). The pages are
  Spanish-first; the mail is not.
- `patterns-authwall--with-action` has no visual baseline until the nightly runs.

## 9. Found on the way, not fixed here

**`apps/web` never imports `@marketplace/ui/styles.css`.** `main.tsx` imports `tokens.css` and the
app's own stylesheet; the design system's component CSS — `dist/ui.css`, the export
`W12-T02` §4 created for exactly this — is loaded by nothing. So every React Aria component in the
storefront renders as a raw browser control: the header's search box, every `Button`, and now these
forms. It has been that way since `W12`, and the suites did not notice because they assert semantics
and the visual baselines are *Storybook* screenshots, where the CSS is loaded.

Confirmed by experiment rather than by reading: adding the one import and re-shooting `/es/signup`
turns raw inputs and unstyled buttons into the designed system. The line was then **reverted** —
it changes the appearance of every existing page and wants its own review and its own baselines,
which is what L10 is for. **Filed as `W12-T20`**, and the backlog's `▶ NEXT` pointer names it —
a one-line fix whose cost is the review of every page it changes.

## 10. Open questions

- **Q1** Should `/signup` and `/login` redirect a signed-in visitor away? They render normally
  today. `W2-T03` owns guards; nothing in the schema depends on the answer.
- **Q2** The verify page links onward after verification rather than redirecting, so the user can
  see what happened. If that reads as a dead end in use, it is a one-line change.
- **Q3** Rate limiting on the auth endpoints — `agent-identity`'s charter asks for it and neither
  `W2-T01` nor this ticket has it. It belongs on the API, not on a form, and it is already filed as
  `W2-T07`. Worth pulling forward: these pages are the first thing that makes those endpoints
  reachable from a browser.
