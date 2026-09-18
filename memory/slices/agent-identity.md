# Slice memory — agent-identity

Durable knowledge for this slice only. Written and owned by this agent alone. Read it at the start
of every task; add to it at the end of every task that taught you something reusable.

Entry format (see `agents/policies/memory.md`):

```markdown
### <short title>
- **id**: MEM-<date>-<n>
- **scope**: slice:S2
- **fact**:
- **why**:
- **apply**:
- **evidence**: <PR / file:line / ADR / intervention id>
- **status**: active
```

Keep it to facts that changed how you would work. Task-specific detail stays in the session file.

---

### `BETTER_AUTH_URL` is the web origin, and two unrelated things break if it is not
- **id**: MEM-2026-09-14-1
- **scope**: slice:S2
- **fact**: `baseURL` is what the emailed verification and reset links resolve against, *and* what
  `trustedOrigins` defaults to. Point it at the API's own port and the mail contains links that
  bypass the application, while every cookie-carrying `POST` from the web origin answers
  `403 INVALID_ORIGIN`.
- **why**: the two failures look unrelated and neither names the variable. `.env.example` has had
  the right value (`http://127.0.0.1:5173`) since `W2-T01`, and `TODO.md`'s `W2-T02` line said the
  opposite in prose — which is the version a reader would have believed.
- **apply**: before changing it, remember it is the *public* URL of the app, not the address of the
  API. In preview and production that is what `W0-T28` is for.
- **evidence**: measured 2026-09-14 against the local stack — `curl -H 'Origin: http://evil.example'`
  on `/api/auth/sign-out` with a session cookie → `403 INVALID_ORIGIN`; run record §4.2.
- **status**: active

### better-auth's refusals, as they arrive at a browser
- **id**: MEM-2026-09-14-2
- **scope**: slice:S2
- **fact**: `get-session` with no cookie is `200` with a literal `null` body, not `401`. Errors carry
  a machine code in the body (`{"code":"EMAIL_NOT_VERIFIED"}`), and `403` is *not* unique to it —
  the origin check answers `403` too. A `POST` that announces `application/json` with an empty body
  never reaches better-auth: Fastify's own JSON parser answers `400` first, because
  `plugins/auth.ts` registers its pass-through parser as `*`, which Fastify uses only for content
  types that have no parser of their own.
- **why**: each one makes a plausible client wrong in a way no test would catch — a signed-out
  visitor rendered as an error, "check your inbox" shown for a CSRF failure, a sign-out that 400s.
- **apply**: branch on status **and** code together; treat a null session as a state, not a failure;
  send `{}` rather than nothing.
- **evidence**: `W2-T09` run record §4.3–§4.5, measured against the running API.
- **status**: active

### A loader that must reflect a write cannot use `ensureQueryData`
- **id**: MEM-2026-09-14-3
- **scope**: slice:S2
- **fact**: `queryClient.ensureQueryData` returns cached data whenever the cache has data — it
  fetches only when `query.state.data` is `undefined`. `invalidateQueries` marks a query stale
  without clearing it, so the two do not compose: the loader answers from the cache it was just
  told is wrong. `fetchQuery` honours `staleTime` and is what a write-then-reload wants.
- **why**: cost a real bug — the header kept showing a signed-out user after a successful sign-in,
  with the action invalidating correctly.
- **apply**: `ensureQueryData` is right for data nothing invalidates (`shared/categories.ts`);
  anything a write changes goes through `fetchQuery`.
- **evidence**: query-core 5.102 `queryClient.ts:75`; `W2-T09` run record §4.1.
- **status**: active

### `requireEmailVerification` is also the anti-enumeration switch
- **id**: MEM-2026-09-14-4
- **scope**: slice:S2
- **fact**: better-auth 1.7.4 computes
  `shouldReturnGenericDuplicateResponse = requireEmailVerification || autoSignIn === false`. So the
  option that forces verification is *also* what makes a duplicate sign-up return the synthetic
  `200` — and what makes a genuine sign-up return `token: null`, since it skips auto sign-in for
  everyone.
- **why**: "just turn verification off so accounts work" looks like a convenience setting and is
  actually a deletion of `W2-T01` §4.5's enumeration defence, with no error and no symptom.
- **apply**: to make an account usable without mail, mark it verified in
  `databaseHooks.user.create.before` (`AUTH_TRUST_EMAIL_ON_SIGNUP`, off by default). Never flip
  `requireEmailVerification`. `auth-config.test.ts` asserts it stays `true`.
- **evidence**: `node_modules/better-auth/dist/api/routes/sign-up.mjs:162`; `W2-T10` run record §2
- **status**: active

### The storefront had a runtime import cycle, and it failed somewhere else
- **id**: MEM-2026-09-14-5
- **scope**: slice:S2
- **fact**: `api.ts → session.ts → query.ts → api.ts`. It crashed `signup.tsx` with
  `seedSession is not a function` — a real error pointing at an innocent line — while `login.tsx`
  worked, because a cycle resolves by entry order. `ApiError` now lives in `shared/api-error.ts`.
- **why**: the symptom names the wrong module, and the 500 page rendered with nothing in the log.
  An hour went into the wrong hypotheses before the import graph was the thing to look at.
- **apply**: `query.ts` may import only *types* from `api.ts`. If a shared module needs a value from
  the API client, that value belongs in its own module.
- **evidence**: `W2-T10` run record §3
- **status**: active


### How a route is guarded, and where a permission goes

- **id**: MEM-2026-09-18-5
- **scope**: slice:S2
- **fact**: `apps/api/src/modules/auth/` holds the whole authenticated boundary:
  `permissions.ts` (the matrix + `can()`) and `guard.ts` (`buildGuards` → `requireSession` /
  `requirePermission`, `buildSessionResolver`, `principalOf`). Guards take a `ResolveSession` port,
  so every 401/403 is assertable with a stub and no database (`guard.test.ts`); the adapter is
  asserted live (`guard-live.test.ts`). A route reads `principalOf(request)` —
  `{ userId, roles, sessionId }` and nothing else.
- **why**: the alternative was a guard per domain module, and the fifth copy is the one that reads
  `roles[0]`, or answers `404` where it meant `403`, or trusts a payload a suspended user still
  holds. `ADR-005` assigned the matrix to this slice for the same reason.
- **apply**: to guard a route, add the operation to `PERMISSIONS` **in the PR that adds the route**
  and pass `guards.requirePermission('…')` as its `preHandler`. Never call `can()` outside a
  `preHandler`. `ADMIN` has no bypass — an admin capability is a row somebody adds deliberately, and
  a money one comes with its own role (`MEM-2026-09-18-2`). Ownership is not the guard's job:
  prefer `/me` addressing so it is structural (`W2-T03` §3.6).
- **evidence**: `docs/specs/S2/W2-T03-route-guards.md` §3; `apps/api/src/modules/auth/guard.ts`
- **status**: active

### `principalOf` throws rather than answering 401, on purpose

- **id**: MEM-2026-09-18-6
- **scope**: slice:S2
- **fact**: `principalOf(request)` on a route with **no** guard throws a plain `Error` — a `500`
  through `app.ts`'s "anything else is a bug" branch — instead of returning `undefined` or being
  treated as unauthenticated.
- **why**: a missing `preHandler` is a programming error, and answering `401` would hide it behind a
  refusal that looks entirely plausible in a log. The route would appear to work, for everyone,
  until somebody signed in.
- **apply**: do not "handle" it. If a handler needs an optional principal (a page that renders
  differently when signed in), resolve the session explicitly rather than making the guard's
  contract optional.
- **evidence**: `apps/api/src/modules/auth/guard.ts`; `W2-T03` run record §"Self-assessment"
- **status**: active
