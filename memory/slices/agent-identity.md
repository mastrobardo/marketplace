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
