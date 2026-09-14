# W2-T09 — The account pages

- **Slice**: S2 Identity (`agent-identity`), with one deliberate visit to `packages/ui` (§4.8)
- **Issue**: (to be filed — `W2` has no issues yet)
- **Decides**: two things `TODO.md` left open and the operator settled on 2026-09-14 — **ADR-005
  Q1** (§2.1) and **where the form schemas live** (§4.2).
- **Depends on**: `W2-T01` (merged, #246). Not blocked on `W2-T02`.
- **Unblocks**: `M1`'s exit criterion — *"anyone can sign up as client/manitas/pro on staging"* —
  which no ticket described a door for.

---

## 1. Purpose

`W2-T01` shipped the auth API and **no way for a person to reach it**. The header has Home and a
language switcher. There is no `/login`, no `/signup`. The two `AuthWall`s — on `become-a-pro` and
on the provider profile — say the product stops here and offer nowhere to go. Today a user can only
register with `curl`.

That was honest while there was no form. Now that there is an API it reads as broken, and it is the
one gap between a storefront that looks finished and a product anybody can try. Operator,
2026-09-14: *"I need to test the Auth flow, so next task should be the register/login pages."*

### 1.1 What makes this more than five forms

Three properties of the API decide most of the UI, and each one is a place where the obvious form
would be wrong:

**a. A duplicate signup is a `200`.** `W2-T01` §4.5 made re-registering an existing address return
a synthetic user — `roles: null`, no row written — so the API cannot be used to discover which
addresses are registered. A page that says *"that address is taken"* hands back exactly the fact
the response exists to hide. So signup has **one** success state, and it is the same sentence for a
new account and for a duplicate.

**b. Every sign-in failure is byte-identical, except one.** Wrong password, unknown address,
suspended, soft-deleted — one `401`, one message, no branching. The exception is
`403 EMAIL_NOT_VERIFIED`, which is deliberately distinguishable: better-auth throws it *after* the
password check, so it reveals only something the person who typed the right password already knows.
A user must be able to tell *"check your inbox"* from *"you are locked out"*.

**c. No deployed environment can send mail until `OPS-14`.** Sign-up still returns `200` and still
writes the row; the mail throws and better-auth does not fail the request. So in preview and
staging the account is **stranded**: sign-in refuses, re-registering is the synthetic `200`, resend
is a `500`. The pages must handle "nothing arrived" without lying about why — see §4.6. The whole
flow works end to end **locally**, against Mailpit.

### 1.2 What this ticket is not

- **Not a tier or plan step.** Signup is free for everyone. Both sides get paid tiers later
  (`BD-16`), and auctions/presupuestos sit behind a paywall on the free tier (`BD-03`) — none of it
  is in the schema, and `W5-T07`/`W5-T08` are both `[B]`. A tier belongs to a subscription, not to
  an account, so the form does not ask and adding one later is an addition rather than a rewrite.
- **Not the provider signup.** See §2.1.
- **Not session policy.** Rotation, revocation and the suspended-user-keeps-their-cookie gap are
  `W2-T02`.
- **Not an account settings page.** Changing an email or a password while signed in is `W2-T03`.
- **Not social login.** `ADR-005` rule 6 keeps Google as a *second* method, and there is no second
  method yet.

---

## 2. User stories

1. As a visitor, I see **Log in** and **Sign up** in the header on every page, so I do not have to
   guess that an account exists.
2. As a new user, I fill in name, email and password, and I am told to check my inbox.
3. As a user who clicks the link in that email, I land on a page that tells me my address is
   confirmed and lets me continue — signed in, because `autoSignInAfterVerification` is on.
4. As a user whose link expired, I am told **that** rather than shown a generic error, and I can
   ask for a new one.
5. As a user who never received the mail, I can resend it from the verify page — and if the resend
   fails I am told it failed, not told it worked.
6. As a returning user, I sign in and the header shows my name and a way out.
7. As a user who signs in before verifying, I am told to check my inbox rather than told my
   password is wrong.
8. As a user who forgot my password, I request a link, set a new password, and sign in with it.
9. As a visitor who hits an `AuthWall`, I am taken to signup rather than left at a full stop.

### 2.1 ADR-005 Q1, settled: signup always creates a `CLIENT`

**Operator, 2026-09-14: always create a client; becoming a pro is a separate upgrade.** There is no
client-vs-provider choice on the form.

This is not only a product call, it is the only one that works today: `W2-T01` made `roles`
`input: false` precisely so that a sign-up body carrying `roles: ["ADMIN"]` is not a privilege
escalation, which means a sign-up body cannot ask for `PROVIDER` either. Postgres supplies
`[CLIENT]` by default. The fork would need a route that changes roles — that is `W2-T03`, and it
does not exist.

So `become-a-pro` keeps its own identity: it is the *upgrade* entry point (`W2-T05`), and its
`AuthWall` sends a visitor to signup as the first half of a journey it still owns the second half
of.

---

## 3. Routes

Untranslated segments — the language is the only translated one (ADR-011 Amendment 1).

| Route | What it is |
|---|---|
| `/:lang/signup` | name · email · password. One success state (§1.1a). |
| `/:lang/login` | email · password. One failure message, plus the verification branch. |
| `/:lang/verify-email` | where the emailed link **lands**, and where a resend is asked for. |
| `/:lang/reset-password` | request a reset link. One success state, always. |
| `/:lang/reset-password/set` | where the emailed reset link lands; sets the new password. |

`/:lang/reset-password/set` rather than a token in the path: better-auth's own callback
(`GET /api/auth/reset-password/:token?callbackURL=…`) consumes the path token and redirects to
`callbackURL?token=…`, so the token arrives as a **query parameter** whatever we do. A second
spelling in the path would be a second place to read it from.

### 3.1 Entry points — half the ticket

- **Header**: signed out → `Log in` and `Sign up`. Signed in → the user's name and `Log out`.
  Rendered from the shell's loader (§4.7), so it is correct on first paint and does not flash.
- **`AuthWall`** gains an optional action (§4.8). `become-a-pro` and the provider profile pass one,
  pointing at `/:lang/signup`.

---

## 4. Design

### 4.1 React Hook Form owns the fields; a router `action` owns the write

**They do not compete, and this is the part that would otherwise be re-derived.** RHF holds field
state, focus and client-side validation. The submit goes through a React Router **`action`** —
never `useMutation`.

`ADR-011 R3` says data comes from the loader and a component never fetches on mount. An `action` is
the write-side of that same rule: it is the router's own write entry point, it is what `W12-T14`'s
framework-mode/SSR switch keeps, and a `useMutation` buried in a component is exactly what that
switch would have to unpick. React Query's job on a write is what happens *after*: invalidate the
session query so the header re-reads it.

Mechanically: RHF validates, and on a valid submit hands the values to `useSubmit()` /
`<Form method="post">`; the `action` calls the API through `context.api` (§4.3) and returns either
a redirect or a result the component renders. The action is also where a *server* error becomes a
field-level or form-level message, because the server is the only thing that knows about them.

### 4.2 The form schemas are local to `apps/web`

**Operator, 2026-09-14.** `apps/web/src/features/auth/schema.ts`, with zod + `@hookform/resolvers`.

`TODO.md` left this open because there is no contracts schema for auth input — better-auth owns
those routes and `W1-T03`/`W1-T04` are unstarted. Local wins on two counts: these schemas validate
a **form**, not a wire contract we publish (the wire contract is better-auth's, and it is not ours
to restate); and `packages/contracts` is the frozen seam `agent-contracts` owns under **L3**, so
putting them there means an ADR for shapes nothing else consumes. `packages/ui` may not import
`packages/contracts` at all (`W12-T07`), which is the same reason the forms live in the app and only
the primitives come from the design system.

Password rules are the API's, mirrored: better-auth's `minPasswordLength` default is 8 and
`maxPasswordLength` 128. The schema states both, so the browser says it before the network does —
and §6 still handles the server saying it, because a mirrored rule that drifts must fail loudly
rather than silently disagree.

### 4.3 One data module, still

Auth calls go into `apps/web/src/shared/api.ts` alongside `search` and `getProvider` — **not**
through better-auth's client SDK.

ADR-011 §4 asks for exactly one module the storefront gets data from, and the existing one already
has the properties these calls need: same-origin by default (`baseUrl()` returns `/`, which is what
makes the `SameSite=Lax` cookie work through the dev proxy and through `W0-T28` in preview), one
place that turns a transport failure into `ApiError`, and one place to replace when `W1-T03`
generates the real client. Adding a second HTTP client for five endpoints would put the auth cookie
on a code path no other call uses, and the cookie is the thing most likely to break.

The methods, against the routes as they exist in better-auth 1.7.4 (read from the package, not
recalled):

| Method | Call |
|---|---|
| `signUp` | `POST /api/auth/sign-up/email` `{ name, email, password, callbackURL }` |
| `signIn` | `POST /api/auth/sign-in/email` `{ email, password }` |
| `signOut` | `POST /api/auth/sign-out` |
| `getSession` | `GET /api/auth/get-session` |
| `resendVerification` | `POST /api/auth/send-verification-email` `{ email, callbackURL }` |
| `requestPasswordReset` | `POST /api/auth/request-password-reset` `{ email, redirectTo }` |
| `resetPassword` | `POST /api/auth/reset-password` `{ newPassword, token }` |

`ApiError.status` is what the routes branch on. They never read an `AxiosError`, for the reason
that class exists.

### 4.4 `callbackURL` is how the emailed link lands on our page

better-auth builds the verification link as
`${baseURL}/verify-email?token=…&callbackURL=<encoded>`, and on success or failure it **redirects**
to that `callbackURL` — adding `?error=<CODE>` when the token is bad. So the signup action passes
`callbackURL: '/<lang>/verify-email'` and the emailed link lands on our page in the user's own
language, with `?error=TOKEN_EXPIRED` when it has expired. Relative paths are explicitly allowed
(`allowRelativePaths`), so no `trustedOrigins` entry is needed.

The same mechanism gives the reset flow `redirectTo: '/<lang>/reset-password/set'`, which arrives
as `?token=…` or `?error=INVALID_TOKEN`.

**`BETTER_AUTH_URL` is the web origin, and that is load-bearing.** `.env.example` already sets it to
`http://127.0.0.1:5173`. Two things depend on it: the emailed links resolve against it, so they must
point at the app (which proxies `/api` back), not at the API's own port; and `trustedOrigins`
defaults to its origin, which is what the origin check compares the browser's `Origin` header
against on every cookie-carrying POST. Pointing that variable at the API would produce dead links
in email *and* a `403 INVALID_ORIGIN` on sign-out — both at a distance from the change. Recorded
here because it is the first thing someone will "fix".

### 4.5 One success state, and one failure message

- **Signup** renders the same "check your inbox" panel for a new account and for a duplicate. The
  page never inspects `roles: null`, because a page that can tell the difference is one edit away
  from showing it.
- **Login** renders one message for every `401`. The only branch is `403` + `EMAIL_NOT_VERIFIED`,
  which renders the inbox panel with a resend button instead.
- **Password reset request** renders the same panel whether or not the address exists — the API
  already answers identically, and the UI must not be the side that leaks.

### 4.6 The verify page tells the truth about mail

It has four states, and it reaches them from the query string:

| State | Reached by |
|---|---|
| **Pending** | arriving from signup (or login's unverified branch) — "we sent a link to `<address>`" |
| **Verified** | better-auth redirected back with no `error` |
| **Expired / invalid** | `?error=TOKEN_EXPIRED` · `INVALID_TOKEN` · `USER_NOT_FOUND` |
| **Resend failed** | the resend call threw |

The resend is `POST /api/auth/send-verification-email`, which works **without** a session — it is
constant-time floored at 500 ms and answers `200` for an unknown or already-verified address, so the
success panel is again one panel. It throws only when the *send* throws, which is what
`ECONNREFUSED 127.0.0.1:1025` does in every deployed environment until `OPS-14`.

**That failure must be visible.** The page says the message could not be sent and that this is a
known gap in preview and staging, not that the mail is on its way. A success panel over a `500` is
the specific lie this section exists to prevent — the account is already stranded, and telling the
user to check an inbox that will stay empty makes it their problem instead of ours.

### 4.7 The session in the shell

`root.tsx`'s loader already fetches categories; it gains the session, through `ensureQueryData` on a
`queryKeys.session(locale)` key, so R3 still holds and the header is correct on first paint rather
than after a flash. A `401`/missing session is **not** an error: it is the signed-out state, and it
renders the two links. The session request failing for any other reason degrades the same way the
categories list already does (`shared/categories.ts`) — the header shows signed-out rather than the
whole shell failing, because "we could not reach the API" must not read as "you are logged out
of something you were logged in to"… and must not take the page down either.

After sign-in, sign-out and verification, the action invalidates that key. That is React Query's
whole job here.

### 4.8 `AuthWall` gains an action

`packages/ui`'s `AuthWall` renders nothing interactive today, and `W12-T12` was right to do that:
the three ways to end a flow that does not exist are a live control that 404s, a disabled control,
and a sentence — and only the sentence is honest while there is no form.

**The form now exists, which is the condition that was missing.** So the wall takes an optional
`action: { label, href }` and renders a link when it is given one. Without it the component is
unchanged, and `provider.tsx`'s wall — which is about contacting a provider, a thing that still does
not exist — keeps its sentence.

This is `packages/ui`, outside `agent-identity`'s boundary. The ticket assigns it here explicitly
("`AuthWall` gaining an action so the two existing walls go somewhere"); it is flagged for
`agent-ui` review on the PR rather than done quietly. The component still holds **no copy** — label
and href are props, like every other string in the design system.

### 4.9 No MSW

`W2-T01` AC23: `/api/auth/*` does not appear in the storefront's MSW handlers. These pages talk to
the real API, and the dev proxy (§4.7 of that spec) is what makes the cookie work locally. Route
tests stub the `ApiClient` interface through the router context, which is what
`tests/app-harness.tsx` already does for every other page — a stub at the seam, not a fake server.

---

## 5. Permissions

| Actor | May |
|---|---|
| anonymous | reach all five pages; sign up; sign in; request a reset; set a password with a valid token; resend a verification mail |
| signed in | reach `/signup` and `/login` (they render normally — a second session is not an error), and sign out |

Nothing here is role-gated. The route guard matrix is `W2-T03`.

---

## 6. Error cases

| Case | API | The page |
|---|---|---|
| Duplicate signup | `200`, `roles: null` | the inbox panel, same as a new account |
| Weak/short password | `400 PASSWORD_TOO_SHORT` | field-level message on `password` |
| Any sign-in refusal | `401 INVALID_EMAIL_OR_PASSWORD` | one form-level message |
| Unverified sign-in | `403 EMAIL_NOT_VERIFIED` | the inbox panel, with resend |
| Bad verify token | redirect `?error=TOKEN_EXPIRED` / `INVALID_TOKEN` | "this link has expired", with resend |
| Resend with no SMTP | `500` | "we could not send it" — never the success panel |
| Reset request, unknown address | `200` | the same panel as a known one |
| Bad reset token | `400 INVALID_TOKEN`, or `?error=INVALID_TOKEN` | "ask for a new link", linking back to the request page |
| Network failure | `ApiError` with `status: undefined` | "we could not reach the service, try again" — distinct from a refusal |

No password, and no value derived from one, reaches a log, a query string or an error message.

---

## 7. Acceptance criteria

**Routes and rendering**
- **AC1** `/es/signup`, `/es/login`, `/es/verify-email`, `/es/reset-password` and
  `/es/reset-password/set` all render inside the shell; the English spellings are identical.
- **AC2** Each new route module exports only the route contract (`Component`, `action`, and
  `loader`/`ErrorBoundary` where it has one) — `route-modules.test.ts`'s existing rule, extended.
- **AC3** No new segment is translated: the route table has no `registro`, `acceder` or similar.

**Signup**
- **AC4** A valid signup calls `POST /api/auth/sign-up/email` once, with a `callbackURL` pointing at
  `/<lang>/verify-email`.
- **AC5** A duplicate signup (synthetic `200`, `roles: null`) renders the **same** panel as a new
  account. Asserted on the rendered text, not on a branch.
- **AC6** The word for "already registered"/"ya registrado" appears in no locale catalogue. The test
  reads the catalogues, so the assertion cannot be defeated by a component-level edit.
- **AC7** Client-side validation rejects an empty name, a malformed address and a password under 8
  characters without a request being made.

**Login**
- **AC8** A `401` renders one message; four different refusals (wrong password, unknown address,
  suspended, deleted) all produce the identical rendered output.
- **AC9** A `403 EMAIL_NOT_VERIFIED` renders the inbox panel with a resend control, not the `401`
  message.
- **AC10** A successful sign-in invalidates the session query and navigates to the language home.

**Verification**
- **AC11** Landing with no `error` renders the verified state.
- **AC12** `?error=TOKEN_EXPIRED` renders the expired state with a resend control; `INVALID_TOKEN`
  and `USER_NOT_FOUND` render the same, and none of them renders the verified state.
- **AC13** A resend that resolves renders the sent panel; a resend that throws renders the failure
  state and **not** the sent panel. Both directions asserted — the untested one is the one that
  ships broken.

**Password reset**
- **AC14** The request page sends `redirectTo: '/<lang>/reset-password/set'` and renders one panel
  for a known and an unknown address alike.
- **AC15** The set page reads `?token=` and posts it with the new password; `?error=INVALID_TOKEN`
  renders the "ask for a new link" state instead of a form that cannot work.
- **AC16** The two password fields must match client-side; a mismatch makes no request.

**Entry points**
- **AC17** The header renders `Log in` and `Sign up` when signed out, and the user's name plus
  `Log out` when signed in — from the loader, with no post-mount fetch.
- **AC18** Sign-out calls the API, invalidates the session query, and the header returns to the
  signed-out state.
- **AC19** A session lookup that fails renders the signed-out header and does **not** reach the
  shell's `ErrorBoundary`.
- **AC20** `AuthWall` with an action renders a link to its `href`; without one it renders exactly
  what it renders today (the existing snapshot/axe stories stay green).
- **AC21** `become-a-pro`'s wall links to `/<lang>/signup`.

**The rules that outlive the pages**
- **AC22** No component calls `fetch`/`axios` directly and no write goes through `useMutation`:
  every submit is a router `action`. Asserted by `route-rules.test.ts`, extended.
- **AC23** `/api/auth/*` appears in no MSW handler (`W2-T01` AC23 still holds).
- **AC24** Every new user-visible string has a key in both `es.ts` and `en.ts` — the existing i18n
  parity test covers this once the keys exist.
- **AC25** Every new page passes axe with no violations.
- **AC26** No password value appears in any URL, log or error message produced by these pages.

---

## 8. Out of scope

`W2-T02` sessions · `W2-T03` account settings and route guards · `W2-T05` the pro upgrade ·
`W2-T08` GDPR · social login (`ADR-005` rule 6) · tiers and plans (`BD-03`, `BD-16`) ·
rate limiting on the auth endpoints (identity's charter asks for it; it belongs on the API, and the
ticket for it is `W2-T02`'s neighbourhood, not a form's).

---

## 9. Open questions

- **Q1** Should `/signup` and `/login` redirect a signed-in visitor to the home page? §5 says they
  render normally — a redirect hides the URL and a second sign-in is not an error. Revisit in
  `W2-T03`, which owns guards; no decision is baked into the schema either way.
- **Q2** The verification and reset emails are **English** (`W2-T01`'s known gap): `app_user.locale`
  exists, and wiring a locale through better-auth's callbacks is its own decision about where
  message catalogues live for a service with no React in it. The pages are Spanish-first; the mails
  are not. Still open, still recorded.
- **Q3** After verification, `autoSignInAfterVerification` leaves the user signed in on the verify
  page. It links onward rather than redirecting, so the person can see what happened. If that reads
  as a dead end in use, the redirect is a one-line change.
