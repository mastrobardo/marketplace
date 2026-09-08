# Spec — W0-T04 web skeleton

|               |                                                      |
| ------------- | ---------------------------------------------------- |
| **Task**      | `W0-T04` `[A]`                                       |
| **Slice**     | S0 Platform                                          |
| **Owner**     | `agent-devops`                                       |
| **Reviewers** | `agent-ui`, `agent-contracts`, `agent-qa`            |
| **Issue**     | https://github.com/mastrobardo/marketplace/issues/36 |
| **Status**    | draft                                                |

---

## 1. Purpose

`apps/web` is currently one exported string. Every user-facing slice — discovery, jobs, auctions,
emergency, payments — drops React features into it, and `TODO.md` §5.3 requires of all of them that
there be "i18n keys for ES and EN, no hardcoded strings". A definition of done nobody can
mechanically check is a definition of done nobody meets: a Spanish string typed straight into JSX
looks identical in review to one that came from a catalogue, and the missing English translation is
found by a user, in production, in the wrong language.

So the point of this task is not "a React app exists". It is that **the shell makes the rule
enforceable**: one place strings come from, a type system that refuses an unknown key, a build that
fails when a translation is missing, and colours that can only come from tokens.

Without it, `agent-ui` inherits a design system with no tokens to build on, `agent-discovery` has no
layout to render a map into, and the first Spanish-only string ships silently.

## 2. User stories

- **As a client in Spain**, I want the app in Spanish by default, so that the product speaks my
  language without me configuring anything.
- **As an English-speaking user**, I want to switch language and have the whole shell follow, so
  that I am not reading a half-translated page.
- **As a slice agent**, I want `t('some.key')` to be a **compile error** when the key does not
  exist, so that I cannot ship a missing translation.
- **As a slice agent**, I want to add a route and have it render inside the existing shell, so that
  my first PR is a feature and not a layout.
- **As `agent-ui`**, I want a token layer already in place, so that the design system is a
  refinement of something rather than a rewrite of everyone's hardcoded colours.
- **As a screen-reader user**, I want landmarks and a single `h1` per page, so that the app is
  navigable — and `TODO.md` §7 puts axe in the nightly suite, which needs something to pass.
- **As a reviewer**, I want a raw colour literal in a component to fail the build, so that "use the
  tokens" is a gate rather than a comment.

## 3. State machine

The only stateful thing in the shell is the active language:

| from | event                | to | guard                | side effect                                   |
| ---- | -------------------- | -- | -------------------- | --------------------------------------------- |
| `es` | `switchLanguage(en)` | `en` | `en` is a known locale | `<html lang>` updated; catalogue swapped     |
| `en` | `switchLanguage(es)` | `es` | `es` is a known locale | `<html lang>` updated; catalogue swapped     |
| *any* | `switchLanguage(x)` | unchanged | `x` unknown       | none — an unknown locale is ignored, not fatal |

`es` is the initial state: Spain first (`TODO.md` §1). Persisting the choice across reloads is out
of scope — it needs a user preference, which needs a user (`W2-T04`).

## 4. API surface

No HTTP surface; this task consumes none and defines none. The public surface is what a slice agent
imports:

| Import                                | Kind      | Contract                                                       |
| ------------------------------------- | --------- | -------------------------------------------------------------- |
| `useTranslation()` (`react-i18next`)  | hook      | `t` accepts **only** known keys; unknown keys are type errors    |
| `src/i18n/locales/es.ts`              | catalogue | **the source of truth**; its keys define the `TranslationKey` type |
| `src/i18n/locales/en.ts`              | catalogue | must satisfy the ES key set exactly — no missing, no extra      |
| `src/app/routes.tsx`                  | route table | where a slice adds its routes                                  |
| `src/app/RootLayout.tsx`              | component | header / `<main>` / footer shell every route renders into       |
| `src/styles/tokens.css`               | CSS       | every design value, namespaced `--mp-`                          |

## 5. Permissions matrix

No authentication and no roles yet (`W2-T03`). The enforceable constraint is charter ownership:

| Actor             | `apps/web/src/features/**` | `apps/web/src/app/**`, `src/i18n/**`, `src/styles/**` |
| ----------------- | -------------------------- | ------------------------------------------------------ |
| `agent-devops`    | **forbidden**              | write (this task)                                      |
| `agent-ui`        | propose                    | write (design system is theirs from here)              |
| slice agents      | write (their own feature)  | propose                                                |

Nothing in this task may be written under `apps/web/src/features/**` — it is `forbidden:` in the
`agent-devops` charter.

## 6. Error cases

| Condition                                            | Surfaces as                                | Expected behaviour                                     |
| ---------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| A key exists in `es` but not in `en`                 | English users see a Spanish string, or the key | **`pnpm typecheck` fails**, naming the key         |
| A key exists in `en` but not in `es`                 | dead translation nobody renders            | `pnpm typecheck` fails — `es` is the source of truth    |
| `t('does.not.exist')` in a component                 | the raw key rendered to a user             | compile error; and at runtime in dev/test, a throw      |
| A catalogue value is an empty string                 | a blank label in the UI                    | test `every value is a non-empty string` fails          |
| An unknown route is requested                        | blank page or a crash                      | the not-found page renders **inside the shell**         |
| A component hardcodes `#3b82f6`                      | a colour outside the design system         | test `no stylesheet contains a raw colour literal` fails |
| A colour token has no dark-theme counterpart         | unreadable text in dark mode               | test `every colour token has a dark counterpart` fails   |
| An unknown locale is requested                       | a blank UI                                 | ignored; the current language stays active              |

## 7. Acceptance criteria

**Shell and routing**

1. **Given** the app at `/`, **when** it renders, **then** the home page content appears inside the
   layout, and the document contains exactly one `<h1>`.
2. **Given** the app at `/definitely-not-a-route`, **when** it renders, **then** the not-found page
   appears **and** the layout's header and footer are still present — an unknown URL is not a
   broken app.
3. **Given** the layout, **when** it renders, **then** it exposes a `banner`, a `navigation`, a
   `main` and a `contentinfo` landmark — the structure axe will check in the nightly suite.
4. **Given** the app at `/`, **when** the user activates the not-found link and returns, **then**
   routing happens client-side: the router renders the new route without a document reload.

**Internationalisation**

5. **Given** no configuration, **when** the app renders, **then** the language is `es` — Spain
   first — and `<html lang>` is `es`.
6. **Given** the app, **when** the language is switched to `en`, **then** the shell's visible text
   changes to the English catalogue **and** `<html lang>` becomes `en`.
7. **Given** the `es` and `en` catalogues, **when** their keys are compared, **then** the two sets
   are exactly equal — no key missing from either, no extra in either.
8. **Given** either catalogue, **when** its values are enumerated, **then** every one is a
   non-empty string.
9. **Given** a source file that calls `t()` with a key **not** in the catalogue, **when**
   `tsc` runs over it, **then** compilation **fails** and the message names the bad key.
10. **Given** a catalogue that omits a key the source of truth defines, **when** `tsc` runs over
    it, **then** compilation **fails** — this is what "a missing translation fails the build"
    means, and it is asserted by compiling a fixture, not by inspection.
11. **Given** a fixture using only valid keys, **when** `tsc` runs over it, **then** it
    compiles — the check in 9 and 10 discriminates rather than always failing.
12. **Given** the running app, **when** an unknown key is requested at runtime, **then** the
    handler throws rather than returning the key as text — a dynamically built key cannot be caught
    by the compiler, and a raw key rendered to a user is worse than a loud failure in dev.
13. **Given** an unknown locale, **when** it is requested, **then** the active language does not
    change.

**Theme tokens**

14. **Given** `tokens.css`, **when** its custom properties are enumerated, **then** every one is
    namespaced `--mp-` and there is at least one of each of colour, spacing, radius and typography.
15. **Given** `tokens.css`, **when** the light and dark blocks are compared, **then** every colour
    token defined for light has a counterpart in dark.
16. **Given** every stylesheet in `src/`, **when** it is scanned, **then** no raw colour literal
    (hex, `rgb(`, `hsl(`) appears outside `tokens.css` — components consume `var(--mp-…)` only.

## 8. Data

No Prisma models, no migrations, no API calls. The app renders from static catalogues; the
generated API client arrives with `W1-T03`.

## 9. Out of scope

- **The design system** — `agent-ui` owns `packages/ui`. This task provides the token layer and
  the shell those components will be built against, and nothing else. No buttons, no inputs, no
  component library.
- **Anything under `apps/web/src/features/**`** — `forbidden:` to this agent.
- **Any real page.** Home and not-found exist to prove the shell and the router work. They are not
  product screens; `W3` onward replaces them.
- **Data fetching, the generated API client, auth state** — `W1-T03`, `W2-T02`.
- **Persisting the language choice** — needs a user preference (`W2-T04`). The switcher changes the
  language for the session only.
- **Locale-aware formatting of dates, numbers and currency.** `i18next` is configured so `W1-T06`
  (money) and the slices can add it; no formatter is defined here, because defining EUR formatting
  without the Money value object would pre-empt that task.
- **Full axe/WCAG conformance** — `W10-T05`, nightly. Criteria 1 and 3 assert the landmark and
  heading structure that makes the audit meaningful; they are not the audit.
- **Routing for real slices, code splitting, error boundaries per route.** Added by the slices that
  need them.

## 10. Open questions

None blocking. Two decisions taken by the owning agent, recorded so a reviewer does not re-open
them:

- **`react-i18next` rather than a hand-rolled `t()`.** A bespoke typed lookup would satisfy criteria
  9–11 with less machinery, but Spanish needs plurals and interpolation almost immediately
  (`1 presupuesto` / `3 presupuestos`), and re-implementing that badly is the predictable outcome.
  `i18next`'s TypeScript augmentation gives the compile-time key safety the issue asks for, so
  nothing is traded away.
- **Spanish is the source of truth, not English.** `es.ts` defines the key type and `en.ts` must
  satisfy it. The market is Spain (`TODO.md` §1); the language a feature is specified in should be
  the one it is written in, and it makes an untranslated English string a compile error rather than
  the reverse.
