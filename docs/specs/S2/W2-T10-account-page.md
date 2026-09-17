# W2-T10 — The account page, and a usable sign-up while there is no mail

- **Slice**: S2 Identity (`agent-identity`)
- **Decides**: what a signed-in header looks like, where sign-out lives, and how an account becomes
  usable in an environment that cannot send email.
- **Depends on**: `W2-T09` (merged, #247). Independent of `W0-T28` (#248), which it will conflict
  with textually in `apps/web/src/shared/api.ts`.
- **Reverts at**: `OPS-14` — §2 is temporary by construction and says so in three places.

---

## 1. Purpose

Two gaps, both found by using the thing.

**A new account cannot be used.** Verification is required to sign in and no deployed environment
can send mail until `OPS-14`, so every sign-up strands its account: sign-in refuses, re-registering
returns the anti-enumeration `200`, and a resend is a `500`. Operator, 2026-09-14: *"once the user
signup, we should set it as 'verified' for the time being."*

**A signed-in visitor is still offered the two doors.** `W2-T09`'s header shows the user's name and
a sign-out control next to `Log in` and `Sign up` — which is the wrong offer to somebody who is
already in. Operator: *"the ui should change when a user login. No more login or signup, but the
name of the user and a button to open settings. this will lead after to an 'improve subscription
tier' page at minimum."*

## 2. Trusting the address at sign-up — and what it must not break

### 2.1 Not by turning verification off

The obvious move is `requireEmailVerification: false`. It is wrong, and reading better-auth 1.7.4
says why:

```js
shouldReturnGenericDuplicateResponse = requireEmailVerification || autoSignIn === false;
```

**That flag is what creates the synthetic duplicate `200`.** Turn it off and a second sign-up for a
known address answers with a real "user already exists" error — the enumeration oracle `W2-T01` §4.5
exists to close, deleted as a side effect of a convenience setting. The same line is also why a
genuine sign-up returns `token: null` today: with verification required, better-auth skips auto
sign-in **for everyone**, so new and duplicate sign-ups are shaped alike.

### 2.2 So: verification stays required, and the user arrives verified

`AUTH_TRUST_EMAIL_ON_SIGNUP`, a boolean in `EnvSchema`, **default `false`**. When it is on, the
`databaseHooks.user.create.before` hook that already keeps `email_verified_at` in step with
`email_verified` also sets the flag itself. Nothing else changes: the duplicate response, the
uniform `token: null`, the verification mail (locally it still sends, and the link still works), the
reset flow.

What it costs is stated plainly rather than hidden: **an address is no longer proven to belong to
the person who typed it.** That is acceptable only because the alternative today is an account
nobody can use at all, and only until `OPS-14` gives us a sender. The flag is `false` by default, so
every environment that has it on shows it in a diff, and `buildApp` warns at boot when it is on
outside development — the same treatment `MAIL_SMTP_HOST` gets for the same reason.

### 2.3 Sign-up signs you in, and the page never learns which mode it is in

The sign-up action already holds the credentials, so it **chains a sign-in**:

- the account is usable → a session, and the browser lands on the home page signed in;
- verification is genuinely required and the address is not verified → `403 EMAIL_NOT_VERIFIED`,
  and the page renders the same inbox panel it renders today.

So one code path serves both modes and the storefront needs no flag plumbed into it. A duplicate
sign-up with a wrong password answers `401`, which renders the inbox panel too — the page stays
uniform, and an attacker learns nothing they could not learn by calling sign-in directly.

Sign-up therefore costs two requests. Sign-in still costs one (`W2-T09` §7b): these are two
operations, not one made slower.

## 3. The signed-in header, and where sign-out went

| State | Header |
|---|---|
| signed out | `Log in` · `Sign up` (unchanged) |
| signed in | the user's name, as a link to `/:lang/account` |

**Sign-out moves off the header and onto the account page.** A person signs out rarely and reaches
for it deliberately; a name that opens an account area is the affordance every other product has
trained them on. The root route keeps its `action` — it is still the shell's write — and the account
page posts to it.

## 4. `/:lang/account`

The smallest honest page: who you are, the way out, and a named place for the thing that does not
exist yet.

- **Name and email**, from the session the shell already loaded — no second request (R3).
- **Sign out**, posting to the layout route's action.
- **Your plan** — an `AuthWall` with **no action**. Subscription tiers are `BD-16`/`BD-03` and
  `W5-T07`/`W5-T08` are both `[B]`: there is no tier in the schema, no price, and no decision about
  what a paid one buys. The wall is where "improve your plan" will go, and until it exists a
  sentence is the honest control (`W12-T12`'s argument, unchanged).
- **The loader redirects to `/:lang/login` when there is no session.** One route guard, not a
  permissions matrix — `W2-T03` owns that, and this is the page that cannot render without a user.

## 5. Acceptance criteria

**Trusted sign-up**
- **AC1** `AUTH_TRUST_EMAIL_ON_SIGNUP` parses as a boolean and defaults to `false`.
- **AC2** With it off, a created user is unverified — today's behaviour, unchanged.
- **AC3** With it on, a created user has `emailVerified` **and** `emailVerifiedAt` set, together.
- **AC4** With it on, the sign-up response is still the same shape for a new address and a duplicate
  (`token: null`, and `roles: null` only on the duplicate), so §2.1's oracle stays closed.
- **AC5** With it on, sign-in immediately after sign-up succeeds.
- **AC6** `buildApp` warns at boot when it is on and `NODE_ENV` is not `development`.
- **AC7** `.env.example` carries it, and `tests/env-example.test.ts` still passes.

**Sign-up in the browser**
- **AC8** A successful sign-up that can sign in lands on the language home page, signed in.
- **AC9** A sign-up whose sign-in answers `403 EMAIL_NOT_VERIFIED` renders the inbox panel, with
  resend — `W2-T09`'s behaviour, preserved.
- **AC10** A sign-up whose sign-in answers `401` renders the inbox panel too, not an error.

**The header**
- **AC11** Signed in, the header renders neither `Log in` nor `Sign up`.
- **AC12** Signed in, it renders the user's name as a link to `/:lang/account`.
- **AC13** Signed out, it renders both links and no account link.

**The account page**
- **AC14** Renders the name and the email from the loader, with no extra request.
- **AC15** Sign-out works from it and returns the header to the signed-out state.
- **AC16** Signed out, `/es/account` redirects to `/es/login`.
- **AC17** The plan section renders an `AuthWall` with no interactive element.
- **AC18** Every new string has a key in both catalogues, and the page passes axe.

## 6. Out of scope

Editing an email or password (`W2-T03`) · the permissions matrix (`W2-T03`) · addresses and client
profile (`W2-T04`) · what a paid tier buys (`BD-16`, `BD-03`) · the upgrade flow itself
(`W5-T07`/`W5-T08`, both `[B]`) · deleting an account (`W2-T08`).

## 7. Open questions

- **Q1** Accounts created *before* the flag was switched on stay unverified and unusable. Nothing
  migrates them, deliberately: a backfill that verifies addresses nobody checked is a worse thing to
  own than a few dead preview accounts. Preview databases are branched per pull request anyway.
- **Q2** The account page has no "change password" control, which is the first thing a person looks
  for there. `W2-T03`, and the reset flow already works from the login page in the meantime.
