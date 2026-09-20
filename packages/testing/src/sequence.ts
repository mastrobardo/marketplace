/**
 * Determinism primitives — the reason this package exists rather than thirteen inline fixtures.
 *
 * Everything here is a counter. There is no PRNG, seeded or otherwise (spec §4.1 Decision A): a
 * sequence is reproducible without a dependency, and the values it produces are *legible* —
 * `00000001-0000-4000-8000-000000000003` reads as "the third user" in a failure message, which is
 * worth more in a test than data that looks real.
 */

/**
 * One 8-hex prefix per entity, so a user id can never equal an address id and a wrong-id bug names
 * its own entity. `AC10` fails if a model with an `id` column is missing from this table.
 *
 * `ProviderCategory` is absent and needs no entry: its primary key is the composite
 * `(providerProfileId, categoryId)` and it has no `id` column at all.
 */
export const ID_PREFIXES = {
  User: '00000001',
  ClientProfile: '00000002',
  ProviderProfile: '00000003',
  Address: '00000004',
  Category: '00000005',
  AuditRecord: '00000006',
  Job: '00000007',
  Quote: '00000008',
} as const satisfies Record<string, string>;

export type SeededEntity = keyof typeof ID_PREFIXES;

/**
 * The clock's origin. A fixed instant, never `new Date()` — a fixture whose timestamps move is a
 * fixture no two runs agree on.
 */
const EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

/**
 * One minute per step. Large enough that a human reading two timestamps can tell them apart, small
 * enough that a few hundred rows stay inside one day.
 */
const STEP_MS = 60_000;

const counters = new Map<string, number>();
let clockTicks = 0;

/**
 * Restore every sequence to its start. Call it in `beforeEach` — without it, a test's ids depend on
 * which tests ran before it, which is the one property this package exists to remove.
 *
 * It is not registered automatically because that would mean owning the vitest setup file, which
 * lives in `packages/config` and belongs to `agent-devops` (spec §4.1 Decision C).
 */
export function resetFactories(): void {
  counters.clear();
  clockTicks = 0;
}

/** The next ordinal for an entity, starting at 1. Exported for factories that need the raw count. */
export function nextOrdinal(entity: string): number {
  const next = (counters.get(entity) ?? 0) + 1;
  counters.set(entity, next);
  return next;
}

/**
 * A v4-*shaped* uuid — version nibble `4`, variant `8` — so it satisfies `@db.Uuid`, `z.uuid()` and
 * Postgres alike while carrying no randomness whatsoever.
 */
export function nextId(entity: SeededEntity): string {
  const prefix = ID_PREFIXES[entity];
  const ordinal = nextOrdinal(entity).toString(16).padStart(12, '0');
  return `${prefix}-0000-4000-8000-${ordinal}`;
}

/**
 * A distinct, strictly increasing instant on every call.
 *
 * Strictly increasing is load-bearing, not cosmetic: `W1-T02` froze keyset paging, and
 * `MEM-2026-09-10-07` records that keyset paging over a non-total order drops or repeats rows at
 * page boundaries. A paging test cannot demonstrate that with rows sharing a `createdAt`.
 */
export function nextAt(): Date {
  clockTicks += 1;
  return new Date(EPOCH + clockTicks * STEP_MS);
}
