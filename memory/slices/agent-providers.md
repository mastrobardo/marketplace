# Slice memory — agent-providers

Durable knowledge for this slice only. Written and owned by this agent alone. Read it at the start
of every task; add to it at the end of every task that taught you something reusable.

Entry format (see `agents/policies/memory.md`):

```markdown
### <short title>
- **id**: MEM-<date>-<n>
- **scope**: slice:S3
- **fact**:
- **why**:
- **apply**:
- **evidence**: <PR / file:line / ADR / intervention id>
- **status**: active
```

Keep it to facts that changed how you would work. Task-specific detail stays in the session file.

---

### A profile is not a search hit, and three exclusions do not carry over
- **id**: MEM-2026-09-17-12
- **scope**: slice:S3
- **fact**: `GET /api/providers/:id` serves providers that `GET /api/search` excludes by design: a
  null `service_radius_metres` (unsearchable), a null `hourly_rate_cents` (`mode=booking` filters
  it), and any provider outside the radius the searcher used. The endpoint has no centre, so
  `distanceMetres` is omitted from `ProviderProfileSchema` entirely.
- **why**: A profile URL has to survive being pasted into WhatsApp (ADR-011 §1). A 404 because the
  person opening the link happens to be far away, or because the provider has not set a rate, is
  the endpoint applying a search's filters to something that is not a search.
- **apply**: When copying a projection from the discovery slice, copy the *fields* and re-derive the
  *filters*. `W3-T05` §2.3's exclusions belong to the radius query, not to the provider.
- **evidence**: `docs/specs/S3/W3-T07-provider-profile-api.md` §2.5;
  `apps/api/tests/provider.test.ts`
- **status**: active

### `select`, not `include`, wherever the omissions are the security boundary
- **id**: MEM-2026-09-17-13
- **scope**: slice:S3
- **fact**: `modules/providers/repository.ts` reads its row with an explicit Prisma `select` listing
  every column it serves, including inside both nested relations. `include` would return whole rows
  — `userId` and `baseAddressId` on the profile, `line1`/`line2` on the address.
- **why**: This slice's projections are the place a private column leaks, and a `select` makes the
  exclusion structural: a column added to `provider_profile` or `address` tomorrow does not appear
  on the wire, and adding one to the response is a visible edit rather than an inherited default.
  The outbound `ProviderProfileSchema.parse` is the second gate, not the first — relying on it
  alone means the private column is in memory and one spread away from the response.
- **apply**: In this slice, `include` is a review failure unless the comment beside it says why the
  whole row is wanted. Portfolio (`W3-T03`) and availability (`W3-T09`) inherit this.
- **evidence**: `apps/api/src/modules/providers/repository.ts`;
  `apps/api/tests/provider-live.test.ts` ("never carries an address line…")
- **status**: active

### The endpoint's module is `providers/`, and the charter used to say otherwise
- **id**: MEM-2026-09-17-14
- **scope**: slice:S3
- **fact**: This slice's API modules live under `apps/api/src/modules/providers/`. The charter's
  `owns:` glob said `professionals/**` until `W3-T07` corrected it in both copies
  (`agents/roles/` and `.claude/agents/`).
- **why**: The route is `/api/providers/:id`, the table is `provider_profile`, the contract is
  `ProviderProfileSchema`, and `glossary.md` states the rule — *`provider` covers both manitas and
  pro*. A module named `professionals` would be the one place in the stack claiming the licensed
  half of the market, in the slice that owns the distinction.
- **apply**: `providers/` for anything this slice adds to the API. If a charter and four artefacts
  disagree, the artefacts are the evidence — but fix the charter in the same PR and say so in the
  spec, because editing one's own boundary should be visible in review.
- **evidence**: `docs/specs/S3/W3-T07-provider-profile-api.md` §2.1, §5 Q3
- **status**: active

