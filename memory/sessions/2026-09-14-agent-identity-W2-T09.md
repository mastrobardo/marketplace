---
task:    W2-T09
agent:   agent-identity
session: 2026-09-14
status:  closed
---

# Session — W2-T09

## Goal
The account pages: `/:lang/signup`, `/:lang/login`, `/:lang/verify-email` and password reset
(request + set), plus the entry points — a real header link and an `AuthWall` that leads somewhere.
`W2-T01` shipped the auth API and no door to it.

## Current state
**Done.** Branch `W2-T09-account-pages` off `main` at `11b5ed4`. Five routes, the header's doors,
sign-out, `AuthWall`'s action, 46 i18n keys in both catalogues, spec and run record on the branch.
`pnpm verify` green: 207/207 in `apps/web`, 250/250 in `packages/ui`. Driven end to end against the
local stack (API + Mailpit + dev proxy) and then in a real browser.

## Log
- 09:00 operator confirmed the two open decisions before any code:
  **ADR-005 Q1 → always create a `CLIENT`**, no role fork on the form (`roles` is `input: false`,
  so the second path needs API surface that does not exist); **form schemas stay local to
  `apps/web`**, not `packages/contracts` — they validate a form, not a wire contract, and the seam
  is agent-contracts' under L3.
- 09:10 read better-auth 1.7.4 out of `node_modules` rather than recalling its routes. What the
  pages actually depend on:
  - sign-up `POST /api/auth/sign-up/email` `{name,email,password,callbackURL?}`; the emailed link
    is `${baseURL}/verify-email?token=…&callbackURL=<encoded>`.
  - `GET /api/auth/verify-email?token=…&callbackURL=…` redirects to `callbackURL` on success and
    to `callbackURL?error=<CODE>` on failure (`TOKEN_EXPIRED`, `INVALID_TOKEN`, `USER_NOT_FOUND`).
  - resend `POST /api/auth/send-verification-email` `{email,callbackURL?}` works **without** a
    session, is constant-time floored at 500 ms, and answers `200` for an unknown or
    already-verified address. It throws only when the send itself throws — which is the 500 every
    deployed environment gives until `OPS-14`.
  - reset request `POST /api/auth/request-password-reset` `{email,redirectTo}`; always `200`.
    Emailed link `${baseURL}/reset-password/<token>?callbackURL=<redirectTo>` → `GET` redirects to
    `redirectTo?token=…` or `redirectTo?error=INVALID_TOKEN`. Set is `POST /api/auth/reset-password`
    `{newPassword, token}`.
  - session is `GET /api/auth/get-session`, sign-out `POST /api/auth/sign-out`.
- 09:20 **the origin check is why `BETTER_AUTH_URL` is the *web* origin.** `originCheckMiddleware`
  validates the `Origin` header against `trustedOrigins` (default: the `baseURL` origin) on every
  POST that carries a cookie. `.env.example` already sets `BETTER_AUTH_URL=http://127.0.0.1:5173`,
  so the dev proxy's `Origin: …:5173` is trusted and the emailed links land on the web app, which
  proxies `/api` back. Nothing to change — but it is the thing that breaks first if someone
  "fixes" that variable to the API's own port.
- 09:25 relative `callbackURL`/`redirectTo` are allowed (`allowRelativePaths`), so `/es/verify-email`
  needs no `trustedOrigins` entry.
- 09:30 `403 EMAIL_NOT_VERIFIED` is thrown *after* the password check, so it leaks only that the
  password was right. That is what makes it safe to be distinguishable, and it is the reason the
  login page may branch on it.

- 11:40 three findings that changed the code, all in the run record §4: `ensureQueryData` ignores
  invalidation (the sign-out bug); an empty `application/json` body is a `400` before better-auth
  sees it; the session must not retry, because the shell blocks on it. Promoted to
  `memory/slices/agent-identity.md`.
- 12:10 two gates earned their keep: `tokens.test.ts` AC6 and the Storybook axe run both failed the
  new `AuthWall` link on contrast, twice (3.96:1, then 4.19:1). It is the wall's text colour,
  underlined.
- 12:30 **found, not fixed**: `apps/web` never imports `@marketplace/ui/styles.css`, so the whole
  storefront renders with unstyled design-system components. Confirmed by adding the import and
  re-screenshotting, then reverted — L10. Filed as `W12-T20` and named in the `▶ NEXT` pointer.

## Blocked / escalations
None. One thing for the operator: **`chore-backlog-ticks` has three unmerged commits and is behind
`main`** — its `W2-T01`/`W2-T02` lines predate #246, so merging it as-is would revert them. Its
`W2-T09` commit is superseded by this branch.

## Handoff
Merged? Then the `▶ NEXT` pointer names `W12-T20` (the missing stylesheet, one line plus the review
of every page it changes), then `W3-T05`/`W3-T07`.

Do **not** re-derive: the better-auth route shapes above, the two operator decisions, or any of the
six measurements in the run record — all six were made against a running stack, not reasoned.
