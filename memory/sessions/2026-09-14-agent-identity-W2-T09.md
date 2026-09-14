---
task:    W2-T09
agent:   agent-identity
session: 2026-09-14
status:  open
---

# Session — W2-T09

## Goal
The account pages: `/:lang/signup`, `/:lang/login`, `/:lang/verify-email` and password reset
(request + set), plus the entry points — a real header link and an `AuthWall` that leads somewhere.
`W2-T01` shipped the auth API and no door to it.

## Current state
Branch `W2-T09-account-pages` off `main` at `11b5ed4` (#245 and #246 both merged). Nothing written
yet beyond this file and the spec.

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

## Blocked / escalations
None.

## Handoff
Spec is `docs/specs/S2/W2-T09-account-pages.md`. Next action: the red phase — `apps/web/tests/auth.test.tsx`.
Do **not** re-derive the better-auth route shapes above or re-ask the two operator decisions.
