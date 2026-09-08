# Repo memory — gotchas

Traps found the hard way. Each entry must carry evidence — a PR, a failing test, an incident, an
intervention id. **No speculation.** If it has not actually bitten us, it belongs in a spec's risk
section, not here.

Seed entries below are known-in-advance traps carried from planning; everything after them should
come from real experience.

### Google Maps is for display, PostGIS is for geography
- **id**: MEM-2026-09-07-07
- **scope**: repo
- **fact**: Radius and proximity queries run in PostGIS (`ST_DWithin` + GiST index). Maps is used
  for rendering and address autocomplete only, with geocoding results cached.
- **why**: Per-request Maps calls for search would dominate infrastructure cost at any real volume
  (`TODO.md` R9).
- **apply**: Never geocode inside a search request path. Never geocode the same address twice.
- **evidence**: `TODO.md` R9, `agents/roles/agent-discovery.md`
- **status**: active

### Photos of homes carry GPS coordinates
- **id**: MEM-2026-09-07-08
- **scope**: repo
- **fact**: Every uploaded image is EXIF-stripped before storage.
- **why**: Portfolio and job photos are taken inside people's homes. Publishing EXIF publishes
  their address.
- **apply**: Strip on the server, not the client. Applies to portfolio, job photos and message
  attachments alike.
- **evidence**: `agents/roles/agent-providers.md`, `agent-jobs.md`
- **status**: active

### Stripe webhooks arrive late, twice, and out of order
- **id**: MEM-2026-09-07-09
- **scope**: slice:S9
- **fact**: Handlers must be idempotent and order-independent, keyed on a stable idempotency key,
  with a dead-letter path.
- **why**: It is the default behaviour of the platform, not an edge case.
- **apply**: Every money handler has a replay test asserting the second delivery is a no-op.
- **evidence**: `TODO.md` W5-T03, `agents/roles/agent-money.md`
- **status**: active

### TypeScript is pinned to 5.9 — typescript-eslint cannot load under TS 7
- **id**: MEM-2026-09-08-01
- **scope**: repo
- **fact**: `typescript` is pinned `~5.9.3` in every `package.json`. Installing TS 7 (the native
  port, which the registry now serves as `latest`) breaks the `lint` gate with
  `Error: typescript-eslint does not support TS 7.0`, and breaks `tsup`'s `dts: true` with
  `TypeError: Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')` from
  `rollup-plugin-dts`.
- **why**: The lint gate is not optional (`agents/roles/agent-devops.md`). A caret range on
  `typescript` silently upgrades the whole workspace into a broken toolchain.
- **apply**: Do not widen the range. **Unpin when** `typescript-eslint` declares TS 7 support *and*
  `tsup`/`rollup-plugin-dts` builds declarations under it — verify with `pnpm verify` from a clean
  `node_modules`, not from cache. If only the dts half is still broken, the fallback is
  `tsup && tsc -p tsconfig.build.json --emitDeclarationOnly`.
- **evidence**: `docs/specs/S0/W0-T01-monorepo-skeleton.run.md` (deviations 1 and 2)
- **status**: active

### The canonical PostGIS and MailHog images are amd64-only
- **id**: MEM-2026-09-09-01
- **scope**: repo
- **fact**: `postgis/postgis` (all tags checked: `17-3.5`, `18-3.6`, and the `-alpine` variants)
  and `mailhog/mailhog:v1.0.1` publish `linux/amd64` only. `docker-compose.yml` therefore uses
  `imresamu/postgis` — the multi-architecture build from the same maintainer, linked from
  `postgis/docker-postgis` as the arm64 source — and `axllent/mailpit`, MailHog's maintained
  successor, in place of the images `TODO.md` §6 names.
- **why**: On an arm64 machine the canonical images run under emulation: slow, and for Postgres
  specifically not something to trust for anything timing- or concurrency-shaped.
- **apply**: Before adding any image to the stack, run
  `docker manifest inspect <image> | grep -A3 '"platform"'` and check `arm64` is listed. **Switch
  back when** `postgis/postgis` publishes arm64 itself.
- **evidence**: `docs/specs/S0/W0-T02-local-stack.run.md` (deviations 1 and 2)
- **status**: active

### Vitest 5 ignores the trailing-number test timeout
- **id**: MEM-2026-09-09-02
- **scope**: repo
- **fact**: `it('…', fn, 30_000)` is accepted and silently has no effect; the test still times out
  at the configured default and the failure still reports that default. Only the options-object
  form works: `it('…', { timeout: 30_000 }, fn)`.
- **why**: The old form is what most examples and muscle memory produce, and the failure message
  names the default timeout — so it reads as "the test really is hanging" rather than "your
  override was dropped", which is an expensive way to lose half an hour.
- **apply**: Any test that shells out, polls, or touches the network gets
  `{ timeout: <ms> }` as the **second** argument.
- **evidence**: `docs/specs/S0/W0-T02-local-stack.run.md` (AC10 test-side correction)
### A `@ts-expect-error` comment is a directive even when the rest of it is prose
- **id**: MEM-2026-09-09-09
- **scope**: repo
- **fact**: TypeScript treats any single-line comment **beginning** with the `@ts-expect-error`
  directive as a suppression, whatever follows it. A fixture written to prove that an unknown
  translation key fails the build carried the comment
  `// @ts-expect-error is deliberately NOT used: the point is that tsc fails.` — which suppressed
  the error it was describing. Because a real error was present, there was no "unused directive"
  warning either: the file compiled clean and the test that asserted the failure failed instead.
- **why**: The comment reads like documentation and behaves like code. It fails **open** — the
  check silently stops checking.
- **apply**: Never begin a comment with `@ts-expect-error` or `@ts-ignore` unless you mean the
  directive. Any test asserting that something *fails* to compile needs a sibling fixture asserting
  something *does* compile; without it, a check that always fails and a check that always passes are
  indistinguishable.
- **evidence**: `docs/specs/S0/W0-T04-web-skeleton.run.md` (test-side correction)
- **status**: active

### i18next's default separators break dotted keys
- **id**: MEM-2026-09-09-10
- **scope**: repo
- **fact**: Our translation keys are flat and dotted (`nav.home` is one key). i18next treats `.` as
  a path separator into nested resources and `:` as a namespace separator by default, so every
  lookup misses and it falls back to rendering **the key itself**. `apps/web/src/i18n/index.ts`
  sets `keySeparator: false` and `nsSeparator: false`.
- **why**: Rendering a raw key to a user is the exact failure `W0-T04` exists to prevent, and it is
  a silent one — no error, no warning, just `nav.home` on the page.
- **apply**: Do not remove those two options. If nested catalogues are ever wanted, that is a
  deliberate change to the key type in `es.ts` and to the parity test, not a config tweak.
- **evidence**: `docs/specs/S0/W0-T04-web-skeleton.run.md` (deviation 1)
- **status**: active
