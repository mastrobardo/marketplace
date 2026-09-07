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
