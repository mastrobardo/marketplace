# Run record — W0-T04 web skeleton

|                  |                                                                |
| ---------------- | -------------------------------------------------------------- |
| **Agent**        | `agent-devops`                                                  |
| **Model**        | `claude-opus-5`                                                 |
| **Charter rev**  | 1                                                               |
| **Skills used**  | `test-driven-development`, `frontend-ui-engineering`, `api-and-interface-design`, `incremental-implementation` |
| **Started**      | 2026-09-09T01:06Z                                               |
| **Finished**     | 2026-09-09T01:40Z                                               |
| **Branch**       | `W0-T04-web-skeleton` (from `main` @ a0dbbc5)                   |
| **Issue**        | https://github.com/mastrobardo/marketplace/issues/36            |
| **Spec**         | [`W0-T04-web-skeleton.md`](W0-T04-web-skeleton.md)              |
| **Session file** | `memory/sessions/2026-09-09-agent-devops-W0-T04.md`             |

---

## Prompts

### 1. Task assignment (operator, verbatim)

> continue with the task. For this session: go from w0-t1 to W0-T04 directly. Branch the  3
> branches from main. Everything is autoapproved, however be sure to include a plan step before
> each execution. The plan will be reported on the run file

The same assignment covers `W0-T02`, `W0-T03` and `W0-T04`. No design steer, so every choice is the
agent's and is argued in the spec.

### 2. Plan (agent, presented before any file was written)

> 1. Branch `W0-T04-web-skeleton` from `main`.
> 2. Spec → `docs/specs/S0/W0-T04-web-skeleton.md`.
> 3. Session memory file.
> 4. **Red**: tests for router + layout shell, ES/EN resolution, missing-key failing the build (not
>    rendering the key), and theme tokens. Stubs first so assertions actually run.
> 5. **Green**: Vite + React + react-router, layout shell, i18n with ES as source of truth and EN
>    type-checked against it, CSS custom-property tokens.
> 6. Full `pnpm verify` + a real `vite build` and a browser-less render check.
> 7. Run record with this plan, session handoff, memory promotion.
> 8. Commit, push, PR against #36 — not merged.

Followed as written. Step 4's "stubs first" was carried over deliberately from `W0-T03`, where the
first red turned out to be a module-resolution error rather than a failing assertion.

### 3. Corrections

No corrective re-prompt from the operator. Five reversals inside the task, all driven by tool
output; see *Deviations*.

---

## Red phase

Module surface created first as stubs that throw `not implemented`, so every assertion actually ran:

```
 × tests/tokens.test.ts > AC14 … namespaces every custom property and covers the four token families
 × tests/tokens.test.ts > AC15 … gives every colour token a dark counterpart
 × tests/tokens.test.ts > AC16 … has no raw colour literal in any component stylesheet
 × tests/i18n.test.ts   > AC7/AC8 … has exactly the same keys in both languages
 × tests/i18n.test.ts   > AC7/AC8 … has a non-empty string for every key in both languages
 × tests/i18n.test.ts   > AC9/AC10/AC11 … compiles a fixture that uses only real keys
 × tests/i18n.test.ts   > AC9/AC10/AC11 … refuses a component that translates a key nobody defined
 × tests/i18n.test.ts   > AC9/AC10/AC11 … refuses a catalogue that is missing a key the source of truth defines
 × tests/i18n.test.ts   > AC12 … throws rather than rendering the raw key
 × tests/shell.test.tsx > AC1/AC2/AC3 … renders the home page with exactly one h1
 × tests/shell.test.tsx > AC1/AC2/AC3 … renders the not-found page inside the shell, not instead of it
 × tests/shell.test.tsx > AC1/AC2/AC3 … exposes the landmarks the nightly axe run will look for
 × tests/shell.test.tsx > AC5/AC6/AC13 … starts in Spanish and says so in the document
 × tests/shell.test.tsx > AC5/AC6/AC13 … switches the whole shell to English
 × tests/shell.test.tsx > AC5/AC6/AC13 … ignores an unknown locale rather than blanking the ui

⎯⎯⎯⎯⎯⎯ Failed Tests 15 ⎯⎯⎯⎯⎯⎯⎯
 Test Files  3 failed (3)
      Tests  15 failed (15)
```

## Green phase

```
$ pnpm --filter @marketplace/web test
 Test Files  3 passed (3)
      Tests  15 passed (15)

$ pnpm --filter @marketplace/web build
vite v8.2.2 building client environment for production...
✓ 110 modules transformed.
dist/index.html                   0.49 kB │ gzip:   0.32 kB
dist/assets/index-B6gFQXa6.css    3.31 kB │ gzip:   1.09 kB
dist/assets/index-CPUQu08f.js   335.49 kB │ gzip: 106.53 kB
✓ built in 444ms

$ pnpm verify        # typecheck · lint · format:check · test · build
 @marketplace/web:test:  Test Files  3 passed (3)   Tests  15 passed (15)
 Test Files  2 passed (2)      Tests  22 passed (22)    (root workspace suite)
verify -> 0
```

jsdom renders the real `App` with the real router and the real catalogues, but it does not prove
the *bundle* is right, so the production build was served and inspected:

```
$ npx vite preview --port 4173 & curl -s http://127.0.0.1:4173/
<html lang="es">   … <div id="root"></div>

$ grep -o "Encuentra a un profesional de confianza" dist/assets/*.js   # ES catalogue shipped
$ grep -o "Find a professional you can trust"       dist/assets/*.js   # EN catalogue shipped
$ grep -o -- "--mp-color-accent:#[0-9a-f]*"         dist/assets/*.css
--mp-color-accent:#b4531f      # light
--mp-color-accent:#e8935c      # dark
```

## Deviations from spec

1. **`keySeparator: false` and `nsSeparator: false` are mandatory, not stylistic.** Our keys contain
   dots — `nav.home` is one key, not `home` nested inside `nav`. At i18next's defaults, `.` is a
   path separator and `:` a namespace separator, so every lookup would miss and fall back to
   rendering **the key itself** — precisely the failure this task exists to prevent. The
   configuration is what makes flat dotted keys safe.

2. **Two test suites are pinned to the `node` environment.** `tests/i18n.test.ts` and
   `tests/tokens.test.ts` read the filesystem and shell out to `tsc`; under jsdom `import.meta.url`
   is an `http:` URL and `fileURLToPath` rejects it (`ERR_INVALID_URL_SCHEME`). A
   `// @vitest-environment node` docblock is cheaper than a second vitest project.

3. **`tests/setup.ts` had to be guarded with `typeof document !== 'undefined'`.** `setupFiles` runs
   for *every* suite, including the node-environment ones, so an unguarded `document` reference
   there fails three suites at collection — with an error that points at the setup file and says
   nothing about the environment.

4. **`apps/web` builds with `vite build`, not `tsc`.** The `W0-T01` stub used `tsc` with an
   `outDir`; a Vite app's build output is a bundle, and typechecking is a separate `tsc --noEmit`.
   Same shape as the change made to `apps/api` in `W0-T03`, for the same reason: `tsconfig.json`
   now covers `src` **and** `tests`, so test files are typechecked.

5. **`AppProps.initialEntries` exists purely for tests**, which is a compromise worth naming: the
   component under test differs from the shipped one by which router factory it calls. The
   alternative — wrapping routes in a `MemoryRouter` in the test — would have tested a *different*
   component tree than the one that ships, and would not have exercised `routes.tsx` at all.

One test-side correction, and it is the most instructive thing in this task:

- **A comment silenced the test.** The `unknown-key` fixture carried the line
  `// @ts-expect-error is deliberately NOT used: the point is that tsc fails.` TypeScript treats a
  comment **beginning** with that directive as a directive regardless of the prose after it, so the
  comment suppressed the exact error the fixture exists to produce — and because a real error was
  present, there was no "unused directive" warning either. The fixture compiled cleanly and the
  test failed with `an unknown translation key compiled`. Fixed by rewording; the fixture now
  carries an explicit warning not to put a suppression comment above that line.

- **Related, same suite**: `starts in Spanish` and `ignores an unknown locale` were order-dependent.
  `i18next` is a module singleton, so the language set by the "switches to English" test leaked into
  the tests after it. Both now establish their own precondition in `beforeEach`, and the default is
  asserted against `i18next.options.lng` directly rather than against whatever the previous test
  left behind.

## Human input received

- The task assignment in *Prompts §1*, including the standing "everything is autoapproved"
  authorisation.
- Nothing else. No account, credential or content was needed. **The Spanish and English copy in the
  catalogues was written by the agent** and is placeholder product copy — it is not legal text
  (`W10-T07`, `[H]`), but a human should read it before it is shown to a user.

## Notes for `agent-ui`

`src/styles/tokens.css` is yours from here. Three things were decided in it that are cheap to
change now and expensive later:

1. **Colour tokens are semantic, not shades** — `--mp-color-danger`, never `--mp-color-red-500`, so
   the palette can change without renaming anything.
2. **The `--mp-` namespace** exists because a Maps widget and a Stripe Element will share this
   document and neither namespaces its own properties.
3. **`:focus-visible` is styled once, globally.** Removing the focus ring is the most common
   accessibility regression in a design system; it is set in one place so a component cannot quietly
   drop it.

The token test enforces two rules you will feel: every `--mp-color-*` needs a dark counterpart, and
no stylesheet outside `tokens.css` may contain a colour literal.

## Self-assessment

- **Weakest part of this change**: the language choice is not persisted, so a reload returns an
  English-speaking user to Spanish. The spec puts persistence in `W2-T04` because it belongs to a
  user preference — but there is a real gap before that lands, and `localStorage` would have closed
  it in five lines. Deliberate (`L10`, no scope creep), but a reviewer may reasonably disagree.
- **Second weakest**: AC16's colour check is a regex over `.css` files. It does not see a colour in
  an inline `style` prop, in a styled-component, or in an SVG `fill` — and the moment `agent-ui`
  introduces any of those, the gate silently stops covering the new surface.
- **What a reviewer should look at hardest**: the three compile-failure fixtures in
  `tests/fixtures/`. They are the entire enforcement mechanism for "a missing translation fails the
  build", they are not covered by anything else, and one of them was silently broken by a comment
  during this task. In particular check that `valid/` still compiles — a fixture set where
  everything fails proves nothing.
- **What I would tell the next agent working in this slice**: add your route as a child of the
  layout route in `src/app/routes.tsx` so you inherit the shell. Add your strings to `es.ts` first —
  the build will then tell you exactly what to translate in `en.ts`. Never write a colour literal;
  add a token. And your page owns its own single `<h1>`; the layout deliberately has none.
- **Not verified**: nothing runs in CI (`W0-T06`), and nothing has been opened in a real browser —
  the evidence is jsdom plus a served production build. No axe run (`W10-T05`), no responsive or
  visual check, and no keyboard walkthrough beyond the skip link and focus ring being present in
  the markup. The bundle is 335 kB uncompressed with no code splitting; that is fine for a shell
  and will not be fine later.
