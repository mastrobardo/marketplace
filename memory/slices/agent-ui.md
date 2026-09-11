# Slice memory — agent-ui

Durable knowledge for this slice only. Written and owned by this agent alone. Read it at the start
of every task; add to it at the end of every task that taught you something reusable.

Entry format (see `agents/policies/memory.md`):

```markdown
### <short title>
- **id**: MEM-<date>-<n>
- **scope**: slice:S10
- **fact**:
- **why**:
- **apply**:
- **evidence**: <PR / file:line / ADR / intervention id>
- **status**: active
```

Keep it to facts that changed how you would work. Task-specific detail stays in the session file.

---

### A route module exports the route contract and nothing else
- **id**: MEM-2026-09-11-01
- **scope**: slice:S10
- **fact**: `apps/web/src/routes/*.tsx` exports `Component` and, where relevant, `loader`,
  `action`, `ErrorBoundary`, `meta`, `handle`, `shouldRevalidate`. A helper, a constant or a second
  component belongs in `apps/web/src/shared/`. `apps/web/tests/route-modules.test.ts` imports every
  route module **in a node environment with no DOM** and fails on both counts.
- **why**: ADR-011's claim that server rendering is a switch rather than a rewrite is only true if
  every route written between now and `W12-T14` is shaped for it. A route that needs a browser to
  *import* is the most common SSR migration failure and is invisible in an app that only ever loads
  in a browser.
- **apply**: Adding a page? Add a module under `src/routes/`, export `Component`, and wire it into
  `src/app/routes.tsx`. Do not re-create `src/pages/`.
- **evidence**: `docs/specs/S10/W12-T01-ui-package-and-route-rules.md` AC8–AC10; ADR-011 R1
- **status**: active

### The route rules are a local ESLint plugin, and deliberately narrow
- **id**: MEM-2026-09-11-02
- **scope**: slice:S10
- **fact**: `apps/web/eslint/route-rules.js` holds three rules — `no-module-scope-browser-global`
  (R2), `no-module-scope-mutable` (R5), `no-fetch-in-component` (R3) — applied by
  `apps/web/eslint.config.js` to `src/routes/**` and `src/features/**` only. R5's rule flags `let`,
  `var` and `new Map/Set/WeakMap/WeakSet` at module scope; it does **not** flag a constant array or
  object.
- **why**: `no-restricted-globals` and `no-restricted-syntax` cannot see scope, and R2 has to allow
  inside an effect what it bans at module scope. And a rule that flags a frozen constant is an
  obstacle rather than a gate — the narrowing is what keeps it switched on.
- **apply**: Extending them? `tests/route-rules.test.ts` has both halves — `RuleTester` for the
  logic and a lint through the app's *real* config for the wiring. Keep both; a rule attached to no
  glob is green forever. When `packages/contracts` exports a client, `no-fetch-in-component` gains
  a banned-import list (spec §10 Q2). When `W9` becomes a second consumer, the rules move to
  `packages/config` as an `agent-devops` change (§10 Q1).
- **evidence**: `docs/specs/S10/W12-T01-ui-package-and-route-rules.md` §4.3, AC11–AC14
- **status**: active

### Tokens are served from source, not from the build
- **id**: MEM-2026-09-11-03
- **scope**: slice:S10
- **fact**: `@marketplace/ui/tokens.css` maps to `src/styles/tokens.css`, not to `dist/`. The `.`
  entry is built (Vite library mode for JS, `tsconfig.build.json` for declarations — the base
  preset sets `noEmit`, which cannot be combined with `emitDeclarationOnly`).
- **why**: Plain custom properties have nothing to compile, and a consumer that must build the
  package before it can read a colour is a consumer that will hardcode the colour.
- **apply**: Keep `src/styles` in `files`. Compiled CSS Modules output is a *separate* export
  (`./styles.css`) added by `W12-T02`; do not move the tokens behind the build to unify them.
- **evidence**: `packages/ui/package.json`; spec §4.1; `apps/web/tests/ui-package.test.ts`
- **status**: active

### React Aria conveys invalidity by linking the message, not with `aria-invalid`
- **id**: MEM-2026-09-11-04
- **scope**: slice:S10
- **fact**: On `Select` the trigger is a `button`, so React Aria does not put `aria-invalid` on it.
  It links the error message with `aria-describedby`, marks the wrapper `data-invalid` for styling,
  and puts the constraint on the hidden native select. `TextInput` *does* get `aria-invalid`,
  because there the control is an input.
- **why**: I asserted the attribute I expected, React Aria dropped the prop, and the test failed —
  correctly. Forcing the attribute through would have produced markup that looks right in a diff and
  is not what the ARIA practices say.
- **apply**: Assert the linked message and `data-invalid`, not the attribute. More generally: when a
  React Aria prop seems not to work, read the rendered DOM before working around it.
- **evidence**: `packages/ui/tests/primitives.test.tsx` AC11; `docs/specs/S10/W12-T02-ui-primitives.md` §7
- **status**: active

### React Aria filters uncontrolled collections only, and its own strings are English
- **id**: MEM-2026-09-11-05
- **scope**: slice:S10
- **fact**: A `ComboBox` given controlled `items` does **not** filter — that is the caller's job
  (`useFilter`, `sensitivity: 'base'`, which matches *València* for `valencia`). It also closes a
  menu with an empty collection unless `allowsEmptyCollection` is set, which otherwise makes both
  the loading and the no-match states unreachable. Separately, React Aria's built-in strings default
  to English: a `Select` with no placeholder renders *"Select an item"*.
- **why**: Each of the three is invisible until a specific state happens, and two of them are states
  an ES-first product hits on day one.
- **apply**: Controlled combobox → filter it yourself, locale-aware. Empty states →
  `allowsEmptyCollection`. And wrap `apps/web` in `<I18nProvider locale="es-ES">` when the shell is
  built (`W12-T09`).
- **evidence**: `packages/ui/src/primitives/Combobox.tsx`; spec §10 Q2 and Q3
- **status**: active

### The design system holds no copy and bundles no React Aria
- **id**: MEM-2026-09-11-06
- **scope**: slice:S10
- **fact**: Every user-visible string in `packages/ui` is a prop with a Spanish default —
  `pendingLabel`, `loadingLabel`, `emptyLabel`, `suggestionsLabel`, `placeholder`. And the library
  build lists `react-aria*` as `external`, with `sideEffects: ["*.css"]`.
- **why**: Copy in the design system means an i18n dependency in a package that must stay
  domain-free. And inlining React Aria made the entry point 339 KB — `apps/web` would have pulled
  all of it in to use one `Button`, failing ADR-011's ≤170 KB budget one task later and looking like
  the page's fault. External: 8.81 KB.
- **apply**: Adding a component? Its strings are props. Adding a dependency to this package? Ask
  whether the consumer should bundle it instead, and check `dist/index.js` in the build output.
- **evidence**: `packages/ui/vite.config.ts`; `docs/specs/S10/W12-T02-ui-primitives.run.md`
- **status**: active

### The workbench is two Vitest projects, and one command runs both
- **id**: MEM-2026-09-11-07
- **scope**: slice:S10
- **fact**: `packages/ui/vitest.config.ts` declares `unit` (jsdom: behaviour, boundaries, tokens,
  wiring) and `storybook` (real Chromium via `@storybook/addon-vitest`: every story with its `play`).
  `pnpm test` runs both, so a browser is a genuine prerequisite —
  `pnpm --filter @marketplace/ui exec playwright install chromium`, and a step in CI's `unit` job.
  Storybook ≥10.3 applies `preview.tsx`'s annotations to the browser project itself: **do not** add
  a setup file that calls `setProjectAnnotations`.
- **why**: A separate `test:stories` script is a suite that stops running the first time someone
  forgets to call it — and from `W12-T04` that suite is the accessibility gate. The browser
  prerequisite is the price of the gate being real.
- **apply**: Adding a component? Its stories are its browser tests; nothing else to wire. Assertions
  a browser cannot make — a story that was never written — stay in the jsdom project.
- **evidence**: `docs/specs/S10/W12-T03-storybook-workbench.md` §4.3; `packages/ui/vitest.config.ts`
- **status**: active

### A theme is a file, and a scheme is `color-scheme` — not a second copy of the palette
- **id**: MEM-2026-09-11-08
- **scope**: slice:S10
- **fact**: `@marketplace/ui/tokens.css` is an entry point that `@import`s four layers:
  `scale.css` (primitive, no colour), `themes/default.css` and `themes/contrast.css` (the
  `--mp-palette-*` ramp plus the semantic mapping over it), and `components.css`
  (`--mp-button-*`, read by one component). `[data-theme]` picks the theme, `[data-scheme]`
  overrides `prefers-color-scheme`, and each colour is written **once** as
  `light-dark(light, dark)`. Both selectors are deliberately unanchored — a theme applies to a
  subtree, not only to the document.
- **why**: The obvious alternative — a dark palette under the media query and again under a
  `[data-scheme='dark']` selector — is a palette maintained in two places, which is how one of them
  ends up missing a token. And `light-dark()` resolves against the *consuming* element's
  `color-scheme`, which is what lets one page show all four `theme × scheme` combinations at once.
- **apply**: Adding a colour? It goes in **both** theme files, as a role, and `tokens.test.ts` fails
  if only one has it. Adding a component? Its tokens go in `components.css` and read the semantic
  layer — a `var(--mp-palette-…)` outside a theme file is a build failure. Styling a container that
  needs its own theme? Put the attribute on the container; it works.
- **evidence**: `packages/ui/src/styles/`; `docs/specs/S10/W12-T05-token-layers-and-themes.md` §4
- **status**: active

### The token gate resolves the graph now, so "it is declared somewhere" is no longer evidence
- **id**: MEM-2026-09-11-09
- **scope**: slice:S10
- **fact**: `tests/token-graph.ts` parses the four stylesheets, models the cascade for a given
  `theme × scheme` (`:root`, `[data-theme]`, `[data-scheme]`, `prefers-color-scheme`, specificity
  then source order), and follows `var()` and `light-dark()` to a literal. `tokens.test.ts` uses it
  to check layering, completeness in both directions, that every `var(--mp-…)` names something, and
  WCAG AA on six colour pairs in all four combinations. It **throws** on a broken chain rather than
  returning `undefined`.
- **why**: The old gate matched strings — a token was "defined for dark" if its name appeared after
  the media query. With two themes and three layers that proves nothing, and ADR-012 §3's word is
  *resolves*.
- **apply**: Need to know what a token actually equals in a theme? `resolve(graph, token, {theme,
  scheme})`. Writing a new token gate? Extend this rather than re-deriving a parser. And the model
  is a model: the runtime check is `Foundations/Themes`' `play` function, which asks a real browser.
- **evidence**: `packages/ui/tests/token-graph.ts`; `packages/ui/src/styles/Theme.stories.tsx`
- **status**: active

### Three of five red-phase failures were the test, not the code
- **id**: MEM-2026-09-11-10
- **scope**: slice:S10
- **fact**: `W12-T05`'s first full red run failed five ways. `--trigger-width` is React Aria's own
  property and not ours to resolve; a theme's `--mp-palette-*` references resolve only *inside* that
  theme, so sweeping every reference in every combination asks the contrast ramp to exist under the
  default theme; and the `:root[data-scheme='…']` assertion had been written from the plan, which
  the implementation had correctly moved past.
- **why**: A gate written before the code is a gate written against an imagined shape. That is the
  point of writing it first — but it means a red run is evidence about *both* sides, and reaching
  for the implementation first would have anchored the design to a guess.
- **apply**: When a new gate fails, ask which of the two is wrong before fixing either. And when you
  loosen an assertion to make it pass, loosen it *precisely* — the scheme selector assertion grew a
  negative lookbehind so that re-anchoring it to `:root` still fails.
- **evidence**: `docs/specs/S10/W12-T05-token-layers-and-themes.run.md` §Red phase
- **status**: active

### The search bar is a declaration, and the query string is a pure function of it
- **id**: MEM-2026-09-11-11
- **scope**: slice:S10
- **fact**: `packages/ui/src/patterns/search/` holds `schema.ts` (field descriptors and `fieldsFor`),
  `query.ts` (`toSearchQuery`, `serializeSearchQuery`, `parseSearchQuery`, `missingRequiredFields`)
  and one `SearchBar` with a `rendering` prop — `hero`, `header`, `filters`. The descriptors are
  domain-free: a field's `name` is a `string` and its options arrive as `Option[]`, because AC15
  forbids importing `packages/contracts` here. `SearchQuery` in this package is the *structure*
  (declared keys → strings); the *meaning* is `SearchQuerySchema` in contracts (`W12-T08`), and the
  application composes them: `SearchQuerySchema.parse(toSearchQuery(schema, values))`.
- **why**: Three pages are about to build three search surfaces in three pull requests. One
  declaration is what stops "the filter exists in the rail but not the hero", and a pure
  `SearchSchema → SearchQuery` is what lets ADR-011 §3 be true — the UI *defines* the endpoint's
  input instead of guessing at it a milestone later.
- **apply**: Adding a filter? One descriptor, and it appears in every rendering. Need the value in a
  loader? `parseSearchQuery(schema, new URL(request.url).searchParams)` — it is DOM-free and a test
  asserts that. Need validation? `missingRequiredFields` returns names; the sentence is yours.
- **evidence**: `packages/ui/src/patterns/search/`; `docs/specs/S10/W12-T07-search-schema.md`
- **status**: active

### A form in this system reports validation, it does not police the submit
- **id**: MEM-2026-09-11-12
- **scope**: slice:S10
- **fact**: `SearchBar` renders React Aria's `Form` with `validationBehavior="aria"`. With the
  default (`native`), `isRequired` puts `required` on the hidden input and the browser refuses the
  submit and shows its own bubble.
- **why**: That bubble is copy this product does not own, in a style the design system cannot reach,
  in whatever language the browser chose — against the ES-first rule and against "errors are
  announced, and the application owns the sentence".
- **apply**: Any new form pattern in `packages/ui` takes the same prop. The caller gets the values
  and decides: `missingRequiredFields` names what is empty, `errors` puts a message on a field.
- **evidence**: `packages/ui/src/patterns/search/SearchBar.tsx`;
  `docs/specs/S10/W12-T07-search-schema.run.md` §Findings
- **status**: active

### A story that opens an overlay is a story the axe gate has never seen before
- **id**: MEM-2026-09-11-13
- **scope**: slice:S10
- **fact**: `useComboBox` calls `ariaHideOutside` while its listbox is open: siblings get
  `aria-hidden` and keep their tab order, which fails axe's `aria-hidden-focus`. `isNonModal` on the
  popover does not change it — the call is in the hook. One story-scoped rule exclusion exists
  (`SearchBar` → `SuggestionsLoading`), with issue **#226** open against the primitive.
- **why**: `W12-T02`'s combobox stories focus the input but never open it, so `W12-T04`'s gate had
  not met the state until the first pattern needed it. A gate only covers what a story reaches.
- **apply**: Writing a play that opens an overlay? Expect this, and do not widen the exclusion
  globally — that is the one move that would make `parameters.a11y.test = 'error'` decorative. Also:
  select controls by accessible name (a combobox's ▾ trigger carries `aria-expanded` too), and press
  a disclosure with `.click()` — expanding moves controls under a synthetic pointer.
- **evidence**: `packages/ui/src/patterns/search/SearchBar.stories.tsx`; issue #226
- **status**: active

### `import.meta.env.DEV` does not keep a dynamic import out of the production bundle
- **id**: MEM-2026-09-11-14
- **scope**: slice:S10
- **fact**: `if (import.meta.env.DEV) { await import('../mocks/browser.js') }` in `src/main.tsx`
  shipped 511 KB of MSW and the whole seeded catalogue as `dist/assets/browser-*.js`, **referenced
  by the entry chunk**. Rollup resolves a dynamic import while building the module graph, before the
  `false` branch is minified away. `vite.config.ts` now carries a `stripMocks()` plugin that resolves
  `mocks/browser` to two empty exports under `mode === 'production'`, so the edge never exists.
- **why**: The guard is the documented Vite pattern and it reads as sufficient. It is not, and the
  failure is silent — a working app, a correct dev experience, and test data on the CDN.
- **apply**: Any dev-only dynamic import in this repo (mocks, debug panels, a11y tooling) needs the
  resolve-time stub, not the runtime guard. And assert it against `dist`, never against the source:
  every cheaper test asserts the source looks right, which is not the claim.
- **evidence**: `apps/web/vite.config.ts`; `apps/web/tests/mocks.test.ts` AC17;
  `docs/specs/S10/W12-T08-search-contract.run.md` §"AC17 caught a 511 KB mock bundle"
- **status**: active

### A nullable column cannot be a sortable field
- **id**: MEM-2026-09-11-15
- **scope**: slice:S10
- **fact**: `GET /search` offers one sort, `distanceMetres`. `ratingAvg` is `Decimal?` and
  `packages/contracts/src/pagination.ts:178` throws on a null sort value by design, because keyset
  paging over a nullable column loses exactly the rows whose value is null.
- **why**: The lost rows here are every unrated provider — on a marketplace that has not launched,
  almost all of them. The bug is invisible in a unit test seeded with five-star providers, and in
  production it is either a 500 or a silent disappearance.
- **apply**: Before adding anything to a `sortable` tuple, check the column's nullability in
  `schema.prisma`. If it is nullable, the fix is a non-null projection the response also carries
  (`COALESCE(rating_avg, -1) AS ratingSort`), never making the column `NOT NULL DEFAULT 0` — that
  ranks a new provider below a bad one.
- **evidence**: `packages/contracts/src/search.ts`;
  `docs/specs/S10/W12-T08-search-contract.md` §Q4
- **status**: active

### An error boundary belongs at the level that actually failed
- **id**: MEM-2026-09-11-16
- **scope**: slice:S10
- **fact**: `W12-T09` gives `legal/:doc` its own `ErrorBoundary` instead of letting its 404 reach the
  root. At the root, a mistyped `/es/legal/nonsense` unmounted the shell — header, compact search and
  footer gone — even though the shell's loader had succeeded. The root boundary is now reserved for
  the case where the shell itself threw (unknown `:lang`, categories request failed).
- **why**: A boundary re-renders from its own level down. Put it above the thing that failed and you
  discard working UI; put it *at* the thing that failed and the rest of the page survives.
- **apply**: Every route whose loader can throw a recoverable error gets its own `ErrorBoundary`.
  Also: a `throw new Response(…, { status: 404 })` is only a route error **from a loader** — thrown
  during render it is a React error that unmounts the tree, so route-param validation goes in the
  loader. And distinguish 404 from 500 in the boundary: "this will never exist" and "try again" are
  different advice, and only the 500 gets a retry button.
- **evidence**: `apps/web/src/routes/legal.tsx`; `apps/web/src/routes/root.tsx`;
  `apps/web/tests/routing.test.tsx` AC7/AC8
- **status**: active

### `/:lang` matches anything, so an unknown language is a soft 404
- **id**: MEM-2026-09-11-17
- **scope**: slice:S10
- **fact**: With the shell mounted at `/:lang`, `/nope` rendered the **Spanish home page at someone
  else's URL**, HTTP 200. The shell's loader now throws a 404 for a segment that is not a known
  locale. A sibling `path: '*'` does *not* fix this — it is unreachable beneath `/:lang`.
- **why**: A soft 404 is invisible to every check except a human reading the address bar.
- **apply**: Any route with a leading dynamic segment must validate it in the loader. Never add an
  unreachable catch-all to "handle" it — an unreachable route reads as handled and is worse than
  absent. Related: the SPA still answers 200 for *every* path including real 404s (measured with
  curl); a true status needs `W12-T14`'s SSR switch, and it is noted on that ticket.
- **evidence**: `apps/web/src/routes/root.tsx` loader; `apps/web/src/app/routes.tsx`;
  `docs/specs/S10/W12-T09-public-shell.md` §10 Q2
- **status**: active

### A `waitFor` whose condition is already true tests nothing
- **id**: MEM-2026-09-11-18
- **scope**: slice:S10
- **fact**: `W12-T09` AC5 clicked the English link then waited on `data-doc === 'terms'` — already
  true before the click, because the test starts on `/es/legal/terms`. The wait resolved instantly
  and the heading assertion raced i18next, which changes language in an effect one tick after the
  route renders. Passed locally every time, failed in CI.
- **why**: The `waitFor` looked like synchronisation and was a no-op. This class of test does not
  fail on the machine that wrote it; it fails on the slowest machine in the fleet.
- **apply**: Wait for the thing that *changes*, never for something already satisfied by the
  starting state. In this app that usually means the translated text, not a `data-` attribute or a
  route param. Related: there is a real one-tick window where the URL says `/en` and the text is
  still Spanish — the i18next singleton, `W12-T14`'s debt.
- **evidence**: `apps/web/tests/routing.test.tsx` AC5;
  `docs/specs/S10/W12-T09-public-shell.run.md` §5
- **status**: active

### `pnpm --filter <app> build` does not build the workspace packages the app imports
- **id**: MEM-2026-09-11-19
- **scope**: slice:S10
- **fact**: `deploy-preview.yml` and `deploy-staging.yml` built the web app with
  `pnpm --filter @marketplace/web build`. When `W12-T09` made `apps/web` a **runtime** consumer of
  `@marketplace/contracts` (which resolves to `dist/`), the deploy job failed with *"Rolldown failed
  to resolve import"* while every local build passed — `dist/` existed locally because something had
  built it earlier. Both workflows now use `pnpm turbo run build --filter=…`.
- **why**: `turbo.json`'s `build` declares `dependsOn: ["^build"]`; `pnpm --filter` has no such
  notion. The failure is invisible until a clean checkout, so it lands in CI, never in review.
- **apply**: Any CI step that builds one workspace package goes through `turbo`, not `pnpm --filter`.
  And when adding the first runtime dependency from an app to a built package, verify by deleting
  that package's `dist/` and building from clean — do not reason about it.
- **evidence**: `.github/workflows/deploy-preview.yml`; `.github/workflows/deploy-staging.yml`;
  `docs/specs/S10/W12-T09-public-shell.run.md` §7
- **status**: active

### The axe gate covers stories, and the shell is not a story
- **id**: MEM-2026-09-11-20
- **scope**: slice:S10
- **fact**: `W12-T04` runs axe through `@storybook/addon-vitest`, so it only ever sees what has a
  story file. The shell `W12-T09` built — skip link, landmark set, the header's compact search, the
  language switcher, the 404 and the 500 — has **no automated a11y coverage**. It is an application
  composition, not a component: making it a story would mean mounting the router and a `QueryClient`
  inside Storybook. Agreed with the operator on 2026-09-11 and written into **`W12-T16`**, which
  already stands up Playwright: the axe pass goes over the real routes (`/es`, `/en`, a legal slot,
  404, 500).
- **why**: "We have an axe gate" reads as "accessibility is covered", and the gap is exactly the part
  every page inherits — a broken skip link or a duplicated unnamed landmark is wrong on all of them
  at once. `shell.test.tsx` AC11 checks landmark presence and name-uniqueness by hand, which catches
  those two and nothing else.
- **apply**: When adding a11y coverage for anything that is not a single component, it goes in the
  Playwright pass, not Storybook. And do not read `W12-T04` as full a11y coverage — state which
  surface a gate actually covers.
- **evidence**: `TODO.md` `W12-T16`; `docs/specs/S10/W12-T09-public-shell.md` §9;
  `apps/web/tests/shell.test.tsx` AC11
- **status**: active

### A deployed page may not hard-depend on an endpoint that does not exist
- **id**: MEM-2026-09-11-21
- **scope**: slice:S10
- **fact**: `W12-T09`'s shell loader awaited `GET /categories` without a fallback. The endpoint is
  `W3-T01` and does not exist, so on the preview deploy it 404'd, the loader rejected, the root
  boundary caught it, and **the whole storefront was the 500 page** — over one empty dropdown. The
  loader now degrades to `[]`; `what` is optional in `SearchQuerySchema` and `where`/`when`/`mode`
  need no endpoint, so the search bar still works.
- **why**: Operator rule, stated 2026-09-11: *"only working apps should be deployed."* A page that
  cannot render without a missing endpoint is not shippable, and no unit test noticed — every one of
  them stubbed the API successfully.
- **apply**: A loader either mocks what does not exist or degrades without it, and there is a test
  for the degraded path. Never a bare `await` on an endpoint that is still in the backlog. Second
  trap from the same incident: `W12-T08`'s `stripMocks` fires on `mode === 'production'`, which
  includes *preview* — combined with a real `VITE_API_URL`, that deploy had neither a real endpoint
  nor a mocked one. `VITE_ENABLE_MOCKS=true` is now set for preview and staging and never for the
  production release.
- **evidence**: `apps/web/src/routes/root.tsx` loader; `apps/web/vite.config.ts`;
  `.github/workflows/deploy-preview.yml`; `routing.test.tsx` AC8a/b; `mocks.test.ts` AC19
- **status**: active

### Asserting only the absence of something lets its absence go unnoticed
- **id**: MEM-2026-09-11-22
- **scope**: slice:S10
- **fact**: `W12-T08` AC17 asserts the production bundle contains no MSW and no factory data. It
  passes just as happily when the mocks are *never* bundled at all — which is exactly what happened
  on the `W12-T09` preview. AC19 now asserts the other half: with `VITE_ENABLE_MOCKS=true`, the
  worker and the seeded catalogue **are** in the bundle.
- **why**: A one-sided assertion about a flag only tests one of its two states, and the untested
  state is the one that ships broken.
- **apply**: Any build flag with two meaningful outcomes gets a test per outcome. Both build tests
  are slow (~20 s each) and both are worth it — they are the only checks that look at what Rollup
  actually emitted rather than at what the source says.
- **evidence**: `apps/web/tests/mocks.test.ts` AC17 + AC19
- **status**: active

### Two renderings of one control must not disagree about what "incomplete" means
- **id**: MEM-2026-09-11-23
- **scope**: slice:S10
- **fact**: `SearchBar` sets `validationBehavior="aria"` deliberately — it reports `isRequired` to
  assistive technology and **lets the form submit**, because the sentence a user reads is the
  application's to own (`W12-T07`). `W12-T09`'s header never owned it, so an empty submit navigated
  to `/es/search?` — a query `SearchQuerySchema` rejects outright, since `where` is required. Found
  in `W12-T10` while writing the *hero's* version of that test. The guard is now one hook,
  `features/search/navigation.ts`, and both bars call it; `search.where.required` had been sitting in
  both catalogues since `W12-T07` with nothing rendering it.
- **why**: A component that deliberately delegates a decision has not made it — it has created an
  obligation, and an unmet obligation in a *shared* component is met differently by each consumer.
  Two controls built from one declaration that disagree about validity is the drift the whole
  `W12-T07`→`T09`→`T10` line exists to prevent.
- **apply**: When a `packages/ui` component documents that the application owns something, grep for
  every consumer before adding the second one. And a translation key with no renderer is a to-do
  someone wrote in the catalogue — treat it as a missing implementation, not as spare copy.
- **evidence**: `apps/web/src/features/search/navigation.ts`; `routing.test.tsx` AC3b;
  `home.test.tsx` AC3; `docs/specs/S10/W12-T10-home-page.md` §4.4
- **status**: active

### A second landmark of the same role needs its own name, and pages are where that first bites
- **id**: MEM-2026-09-11-24
- **scope**: slice:S10
- **fact**: `SearchBar` renders `role="search"` named by its `label`, and the shell puts one in the
  header of **every** page. `W12-T10`'s hero is therefore the second on one page — the case
  `SearchBar.tsx`'s own comment predicted for `W12-T11`, arriving a ticket early. The hero is
  `search.hero.label`; the header keeps `search.label`. `home.test.tsx` AC10 checks `region`, `search`
  and `navigation` together, resolving `aria-labelledby` the way assistive technology does rather than
  comparing `textContent` — comparing text passes for a landmark with no name at all, because every
  section's text differs.
- **why**: Duplicated landmarks with one name are an axe failure, and before that they are a
  screen-reader user hearing "search" twice with no way to tell which is which. A component cannot
  catch it; only the page that composes two of them can.
- **apply**: Any component that renders a landmark takes its accessible name as a prop, and the page
  that mounts two of anything is where the uniqueness assertion lives. Write the name check against
  the computed accessible name, never against `textContent`.
- **evidence**: `apps/web/src/routes/home.tsx`; `apps/web/tests/home.test.tsx` AC10;
  `packages/ui/src/patterns/search/SearchBar.tsx`
- **status**: active

### A pattern hands out a class; it does not render the application's link
- **id**: MEM-2026-09-11-25
- **scope**: slice:S10
- **fact**: `Card` takes `renderLink({ className, children })` rather than an `href` or an `onPress`.
  An `href` makes the card render an `<a>`, which is a full page reload inside an SPA; an `onPress`
  makes it a button pretending to be a link — no middle-click, no open-in-new-tab, no URL to copy —
  and a category card **is** a URL. The stretch is a `::after` overlay on the class the card hands
  out, so the whole surface is clickable with exactly one tab stop in it.
- **why**: ADR-012 §1 — `packages/ui` may not know what a router is, and `boundaries.test.ts` AC15 is
  that as a gate. The render prop is the only shape that keeps the package domain-free *and* gives
  the product real links.
- **apply**: Every future pattern that is "a surface someone navigates from" — `ResultRow`, the
  landing cards — takes the same render prop. Do not add an `href` prop to any of them.
- **evidence**: `packages/ui/src/patterns/card/Card.tsx`; `packages/ui/tests/card.test.tsx` AC14;
  `docs/specs/S10/W12-T10-home-page.md` §4.5
- **status**: active

### A missing endpoint removes a section, never the page — and a heading over nothing is worse than neither
- **id**: MEM-2026-09-11-26
- **scope**: slice:S10
- **fact**: `W12-T10`'s category region is **absent** when the list is empty, not an empty grid under
  a heading — and an empty list and a failed request produce the identical page (`home.test.tsx`
  AC7/AC8). The degrade itself moved into `shared/categories.ts` when the home page became the second
  loader needing it; `root.tsx` was refactored onto it.
- **why**: This is `MEM-2026-09-11-21` one level down. `GET /categories` is still `W3-T01`, so the
  degraded path is the *normal* path, and a naive `.map()` renders "Todos los servicios" above
  nothing every day until that ticket lands. Two copies of a degrade rule is one copy too many: the
  second is the one that gets forgotten.
- **apply**: A degrade rule lives in one function the moment there is a second caller. And the check
  is not `catch` — it is "what does this region look like with zero rows", asserted.
- **evidence**: `apps/web/src/shared/categories.ts`; `apps/web/tests/home.test.tsx` AC7/AC8
- **status**: active

### A child route owns its loader, on the parent's query key
- **id**: MEM-2026-09-11-27
- **scope**: slice:S10
- **fact**: `W12-T10`'s home page needs the shell's category list and does **not** read it with
  `useRouteLoaderData`. It calls `ensureQueryData` on the same key, so React Query answers from a warm
  cache and no second request is made.
- **why**: R3 then holds by construction rather than by the parent's good behaviour, the page stays
  self-contained, and `W12-T11`/`T12`/`T13` copy a pattern that still works when their data is *not*
  something the shell happens to have. Reading the parent's data couples every child page to the
  shell's loader shape for as long as the shape survives.
- **apply**: Storefront pages get their own loader. Share the *key*, never the loader data.
- **evidence**: `apps/web/src/routes/home.tsx` loader; `docs/specs/S10/W12-T10-home-page.md` §4.2
- **status**: active
