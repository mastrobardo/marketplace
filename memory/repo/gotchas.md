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

### `app.register` encapsulates — a hook added inside one covers only that context
- **id**: MEM-2026-09-09-05
- **scope**: repo
- **fact**: In Fastify, `register` creates a new encapsulation context. A hook added inside a
  registered plugin does **not** apply to routes registered in a sibling context. Wrapping the
  request-id `onRequest` hook in a plugin produced an app where `/health` had no `x-request-id`
  header at all, while a test of the plugin in isolation would have passed.
- **why**: The failure mode is silent partial coverage, which is worse than a crash: a correlation
  header, an auth guard or a rate limiter that covers *some* routes looks like it works.
- **apply**: Anything that must apply to every route goes on the root instance with `app.addHook`,
  or through `fastify-plugin`, which breaks encapsulation deliberately. Use `register` only when
  you actually want the scoping. Assert cross-cutting behaviour on a route registered **elsewhere**
  than the thing under test.
- **evidence**: `docs/specs/S0/W0-T03-api-skeleton.run.md` (deviation 3)
- **status**: active

### A module-resolution failure is not a red phase
- **id**: MEM-2026-09-09-06
- **scope**: repo
- **fact**: `Cannot find module '../src/app.js'` with `Tests  no tests` means no assertion ran. It
  is the inverse of `W0-T01`'s vacuously-passing loops: a failure that is not evidence.
- **why**: L1 requires the red phase as proof the test can distinguish a working implementation
  from a missing one. A collection error proves only that a file is absent.
- **apply**: Create the module surface first as stubs that `throw new Error('not implemented')`,
  then observe red. Never build a `Config` or any other module-level value at import scope in a
  test file — it takes the whole file out of collection when it throws.
- **evidence**: `docs/specs/S0/W0-T03-api-skeleton.run.md` red phase
- **status**: active
