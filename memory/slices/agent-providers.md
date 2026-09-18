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


### The demo world is in Postgres, and it is not a fixture
- **id**: MEM-2026-09-18-1
- **scope**: slice:S3
- **fact**: `pnpm db:seed` runs `providers.demo-world`
  (`apps/api/prisma/seed/demo-providers.ts`): four categories and five Madrid providers with fixed
  uuids — categories `aaaa…0001`-`0004`, users `bbbb…`, addresses `cccc…`, profiles `dddd…`. Every
  provider has a base address and a radius, so none of them is the `404` of `W3-T07` §2.4 or the
  unsearchable row of `W3-T05` AC6. `Clima Costa` sits 29.8 km from Sol with a 50 km radius; the
  other four cover 15 km. Since `W3-T10` the storefront's MSW answers `GET /categories` and nothing
  else.
- **why**: `W3-T05` and `W3-T07` both shipped real endpoints and left their mocks in place, because
  a correct endpoint over an empty table is worse than a mock. This is what unblocked both
  deletions, and it is the data every later S3 ticket will develop against.
- **apply**: build against these rows rather than adding a fixture — `pnpm db:reset` then
  `pnpm db:seed` rebuilds the same world, so a uuid in a screenshot still resolves. The seeder is
  **not** `localOnly` (no credential, no personal data), so it may run in preview; anything with a
  password or a licence number that joins it must be a separate, `localOnly` seeder. The categories
  say `requiresLicence: false` and name `BD-07` — do not read that as an answer, and do not copy the
  pattern of encoding a legal flag in demo data.
- **evidence**: `docs/specs/S3/W3-T10-demo-provider-seeder.md` §2;
  `apps/api/tests/seed-live.test.ts`
- **status**: active

### The write path is `/me`, one transaction, and it answers the public projection

- **id**: MEM-2026-09-18-8
- **scope**: slice:S3
- **fact**: `PUT /api/providers/me` (`modules/providers/write-repository.ts`) upserts profile,
  address and the category set in **one** `prisma.$transaction`, resolves slugs *before* any write,
  and answers `ProviderProfileSchema` — the same projection `GET /api/providers/:id` serves.
  `GET /me` answers `ProviderProfileOwnSchema`: the public row plus the address the owner typed,
  with the coarse `point` dropped. Both projections are built from `PROVIDER_PUBLIC_SELECT` in
  `repository.ts`.
- **why**: `/me` resolves the row from the principal, so ownership is structural and the
  `403`-vs-`404` question never arises (`W2-T03` §3.6). Answering with the public projection makes a
  save tell you what a visitor will see. One `select` for both means a column added to the table
  cannot appear on the wire by accident in either.
- **apply**: add a column to `PROVIDER_PUBLIC_SELECT` for a public field, to `OWN_SELECT` only for
  a private one. A changed base address is a **new `address` row**, never an `UPDATE`: the old row
  may be where they live and `client_profile.default_address_id` may point at it. An identical
  address is reused, which is what keeps repeated saves from leaking rows.
- **evidence**: `docs/specs/S3/W3-T02-provider-profile-write.md` §3.4–§3.8;
  `apps/api/tests/provider-write-live.test.ts` (AC7/AC8/AC9)
- **status**: active

### `base_address_id` is `NOT NULL`, and the state `W3-T07` answered 404 for is gone

- **id**: MEM-2026-09-18-9
- **scope**: slice:S3
- **fact**: Migration `0009_provider_base_address_required` made the column `NOT NULL` and changed
  its foreign key from `ON DELETE SET NULL` to `RESTRICT`. `repository.ts`'s branch for a row with
  no base address is deleted; `provider-live`'s "nothing to serve" test and `search-live` AC6's
  address half moved into `core-schema.test.ts` as `23502`; `core-schema`'s own `AC-9` inverted —
  deleting a base address is now **refused** (`23503`) rather than absorbed.
- **why**: the nullable column permitted a row the product could not serve — unsearchable and
  unserialisable at once. Making it required deletes the state instead of handling it, which is why
  the code that handled it went with it (operator's rule, 2026-09-17).
- **apply**: a provider profile cannot be written without an address — in a test either.
  `createProviderProfile` composes one; supply `baseAddressId` only when the test is about a
  specific address. Never reintroduce a "provider without a base" fixture: it is a row Postgres
  refuses, not a case to cover.
- **evidence**: `apps/api/prisma/migrations/0009_provider_base_address_required/`;
  `docs/specs/S3/W3-T02-provider-profile-write.md` §8.1, §8.5
- **status**: active
