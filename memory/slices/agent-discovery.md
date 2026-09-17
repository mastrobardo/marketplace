# Slice memory — agent-discovery

Durable knowledge for this slice only. Written and owned by this agent alone. Read it at the start
of every task; add to it at the end of every task that taught you something reusable.

Entry format (see `agents/policies/memory.md`):

```markdown
### <short title>
- **id**: MEM-<date>-<n>
- **scope**: slice:S5
- **fact**:
- **why**:
- **apply**:
- **evidence**: <PR / file:line / ADR / intervention id>
- **status**: active
```

Keep it to facts that changed how you would work. Task-specific detail stays in the session file.

---

### The search radius is the provider's, not the search's

- **id**: MEM-2026-09-17-12
- **scope**: slice:S5
- **fact**: `GET /api/search` matches a provider when **they cover the searched point** —
  `ST_DWithin(address.location, :centre, provider_profile.service_radius_metres)` — so a provider
  60 km away who travels 80 km is a result and one 5 km away who travels 2 km is not. A provider
  with a null `base_address_id` or a null `service_radius_metres` is not searchable at all.
- **why**: "Who will travel to me" is the question a client is actually asking; "who is near me"
  returns people who will not come. The column exists for this and carries its own
  `CHECK (> 0 AND <= 200000)`, and `schema.prisma:127` already stated the consequence. The flat
  40 km radius in `apps/web/mocks/search.ts` was a stand-in for a catalogue with no radius data,
  never the intended semantics.
- **apply**: Keep the three searchability preconditions together — they are one rule, and a filter
  that drops one silently changes who exists. `W3-T08` adds licence gating on top of this set, not
  beside it.
- **evidence**: `apps/api/src/modules/search/repository.ts`;
  `docs/specs/S5/W3-T05-geo-search.md` §2.3
- **status**: active

### Geocoding is a port with one adapter, and no table

- **id**: MEM-2026-09-17-13
- **scope**: slice:S5
- **fact**: `where` becomes a centre through `resolvePlace(where)` in
  `apps/api/src/modules/search/places.ts` — a compiled-in gazetteer of the 52 provincial capitals
  plus every Spanish postal code through its first two digits, which *are* the province code. No
  table, no migration, no seeder. An unresolvable place is a `400` naming `where`, never a default
  centre and never an empty list.
- **why**: The operator's constraints, taken before implementation: the database stays clean because
  a real address lookup may end up driven by the frontend; no Maps vendor is chosen because Google
  costs materially more than the alternatives; and the role file already required that geocoding be
  cached rather than re-fetched. A lookup in memory is the strongest form of that cache. Defaulting
  an unknown place to Madrid would answer a search for a town we cannot find with a confident list
  of providers 400 km away, and nothing in the response would say so.
- **apply**: `resolvePlace` is the whole surface a real geocoder has to satisfy — swap the adapter,
  not the query layer. **If the frontend ever resolves the address itself it must send a
  coordinate, and `where: z.string()` is frozen by `W12-T08`** — so that day costs an ADR and a
  contract amendment. Budget for it in `W3-T06` rather than discovering it mid-task.
- **evidence**: `apps/api/src/modules/search/places.ts`;
  `docs/specs/S5/W3-T05-geo-search.md` §2.2
- **status**: active
