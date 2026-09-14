# W2-T10 — run record

- **Branch**: `W2-T10-account-page`, off `main` at `e56177d`
- **Spec**: `docs/specs/S2/W2-T10-account-page.md`
- **Session**: `memory/sessions/2026-09-14-agent-identity-W2-T10.md`

---

## 1. Recovered work — read this first

**`W2-T09`'s "login is one API call" commit never reached `main`.** It was pushed at 17:37:43 and
#247 was squash-merged at 17:35:26 — two minutes earlier — so the merge took the branch without it.
`main` carries the account pages with the original three-call login.

It is **cherry-picked onto this branch** (`fd578c2`), unchanged: `signIn` returns the authenticated
user, the login action seeds the session cache instead of invalidating, sign-out seeds `null`, and a
*failed* write still invalidates because it has told us nothing. The call-count assertions came with
it (`AC27`, `AC18`, `AC28`).

Nothing was lost, but nothing was recoverable from `main` either — worth knowing the next time a PR
is merged while an agent is still pushing to it.

## 2. Trusting the address — and the shortcut that would have broken more than it fixed

`requireEmailVerification: false` is the obvious way to make a new account usable. Reading
better-auth 1.7.4 rather than assuming showed why it is wrong:

```js
shouldReturnGenericDuplicateResponse = requireEmailVerification || autoSignIn === false;
```

**That option is what creates the synthetic duplicate `200`.** Turning it off deletes `W2-T01`
§4.5's anti-enumeration answer as a side effect of a convenience setting — the API would start
telling anyone who asked which addresses are registered. The same line is also why a genuine sign-up
returns `token: null` today: with verification required, better-auth skips auto sign-in for
*everyone*, so new and duplicate sign-ups are shaped alike.

So `AUTH_TRUST_EMAIL_ON_SIGNUP` marks the user verified in the `user.create` hook instead, and
`auth-config.test.ts` now pins `requireEmailVerification: true` in the source so nobody takes the
shortcut later. Verified against a live database: with the flag on, a duplicate sign-up is still
`200` with the same keys and `token: null`, and still writes no second row (`AC4`).

The flag is `false` by default, on in `.env.example` (local) and in the preview and staging deploys,
never in production, and `buildApp` warns at boot whenever it is on outside development.

## 3. A runtime import cycle, found by a crash that pointed somewhere else

Chaining the sign-in made `/es/signup` render the 500 page with **no logged error**. The cause:

```
api.ts  →  session.ts  →  query.ts  →  api.ts
```

`W2-T09` added the first edge when the client started parsing a session, and the last one has been
there since `W12-T08` (`query.ts` needs `ApiError` for its retry policy). A cycle does not fail on
its own — it fails depending on which module is entered first, which is why `login.tsx` worked and
`signup.tsx` died with `seedSession is not a function` on a line that had nothing to do with it.

`ApiError` now lives in `shared/api-error.ts`; `api.ts` re-exports it so no caller changed, and
`query.ts` imports the class from there and only a *type* from `api.ts` — type imports are erased,
so there is no runtime edge back. An error class was never "the API client" anyway.

## 4. Sign-up signs you in, and the page never learns which mode it is in

The action already holds the credentials, so it chains `signIn`: a usable account gets a session and
the home page; `403 EMAIL_NOT_VERIFIED` (or a `401`, which is a duplicate whose password is not the
account's) gets the inbox panel. One code path, both modes, and no flag plumbed into the browser —
so nothing here changes the day `OPS-14` lets us turn the flag off.

Only an `ApiError` is caught. Anything else is rethrown: a bug or a service that is down must not
render "check your inbox", which is the same lie `W2-T09` §4.6 refuses about mail.

## 5. One existing assertion changed, deliberately

`AC5` asserted that a duplicate sign-up rendered the same panel as a new account, because both ended
there. Now a usable account goes to the home page, so the pair that must stay indistinguishable is
the other one: an unverified new account (`403`) and a duplicate with the wrong password (`401`).
The test asserts exactly that, with the address masked, and says why it changed.

## 6. Driven in a browser, locally, with the flag on

```
signup    POST /api/auth/sign-up/email · POST /api/auth/sign-in/email   → the home page, signed in
header    Inicio · Ana Pérez            (no "Acceder", no "Crear cuenta")
account   Tu cuenta — Ana Pérez | Correo electrónico | t10-…@example.com | Tu plan
sign-out  → Inicio · Acceder · Crear cuenta
login     POST /api/auth/sign-in/email                                   → one call
no console errors
```

Signing out navigates to the home page: the form posts to the layout route, and staying on a page
whose loader requires a session would only bounce to the login form.

## 7. The gates

`pnpm verify` green — 10/10 workspace tasks. The live auth suite (`STACK_LIVE=1`) is 25 tests, four
of them new, against a real database.

Two existing assertions had to be updated rather than worked around: `config.test.ts`'s exhaustive
defaults object (a new variable has to be added there, which is exactly where somebody notices a
flag that has grown a default), and the two sign-out tests, which now click the control where it
lives.

## 8. Known gaps

- **Accounts created before the flag was on stay unverified**, and nothing migrates them. A backfill
  that verifies addresses nobody checked is a worse thing to own than a few dead preview accounts;
  preview databases are branched per pull request anyway.
- **No "change password" on the account page**, which is the first thing a person looks for there.
  `W2-T03`; the reset flow works from the login page meanwhile.
- **This branch touches `apps/web/src/shared/api.ts`, and so does #248.** Whichever merges second
  needs a rebase — textual, and the third time this pair of files has collided.

## 9. Open questions

- **Q1** Sign-up now costs two requests where sign-in costs one. They are two operations, not one
  made slower, but if the second ever becomes a problem the API could return a session from sign-up
  when the address is trusted — which would also re-open the shape difference §2 is careful about.
- **Q2** The account page is the whole of "settings" today. `W2-T03` and `W2-T04` will want tabs or
  sections rather than one article; the URL (`/:lang/account`) is chosen so those can nest under it.
