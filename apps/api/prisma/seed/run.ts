import { PrismaClient } from '@prisma/client';
import { SeedError, type SeedResult, type SeedTarget, type Seeder } from './types.js';

/**
 * Hosts a `localOnly` seeder may write to. Anything else is somebody's shared environment.
 * `db` is the compose service name, which is how the API reaches Postgres from inside the network.
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', 'db']);

/**
 * Is this connection string pointed at somebody's laptop?
 *
 * The single definition of "local" in the seed pipeline. `assertSafeTarget` asks it to decide
 * whether a `localOnly` fixture may run; `runSeeders` asks it to fill `SeedContext.target`, which
 * is how `auth.demo-users` knows not to write a published password (`W0-T30` §3.3).
 *
 * A malformed URL is **not local**. Failing closed matters more here than a precise error: the
 * caller that cannot be parsed is the caller we know least about.
 */
export function isLocalTarget(databaseUrl: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(databaseUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Reject a registry with a repeated id **before** anything connects.
 *
 * A duplicate is not a race or a bad row: the ledger is keyed by id, so the second seeder would be
 * skipped forever and its data would simply never exist, in every environment, silently.
 */
export function assertUniqueSeederIds(seeders: readonly Seeder[]): void {
  const seen = new Map<string, string>();
  for (const seeder of seeders) {
    const previous = seen.get(seeder.id);
    if (previous !== undefined) {
      throw new SeedError(
        'SEED_DUPLICATE_ID',
        `two seeders share the id "${seeder.id}" — "${previous}" and "${seeder.description}". ` +
          'Ids are the ledger key and must be unique and permanent.',
      );
    }
    seen.set(seeder.id, seeder.description);
  }
}

/**
 * Narrow the registry to the ids a caller asked for — `pnpm db:seed --only <id>[,<id>…]`.
 *
 * **Order comes from the registry, never from the argument.** `providers.demo-world` resolves slugs
 * that `categories.taxonomy` writes, and `registry.ts` is the one place that ordering is stated; a
 * filter that honoured the caller's order would move that decision to a command line, where it has
 * no reviewer.
 *
 * An id nothing declares is a **refusal**, not an empty run. The failure this prevents is a typo in
 * a deploy workflow that seeds nothing, succeeds, and is discovered by whoever opens the storefront
 * — which is the exact shape of the bug `W0-T30` exists to fix.
 *
 * Returning the registry untouched for `undefined` keeps `pnpm db:seed` meaning what it always did.
 */
export function selectSeeders(
  seeders: readonly Seeder[],
  only: readonly string[] | undefined,
): readonly Seeder[] {
  if (only === undefined) return seeders;

  const wanted = new Set(only);
  if (wanted.size === 0) {
    throw new SeedError(
      'SEED_UNKNOWN_ID',
      '--only was given no seeder ids. Name at least one, or drop the flag to run the registry.',
    );
  }

  const known = new Set(seeders.map((seeder) => seeder.id));
  const unknown = [...wanted].filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new SeedError(
      'SEED_UNKNOWN_ID',
      `no seeder declares ${unknown.map((id) => `"${id}"`).join(', ')}. ` +
        `Registered ids: ${seeders.map((seeder) => seeder.id).join(', ')}.`,
    );
  }

  return seeders.filter((seeder) => wanted.has(seeder.id));
}

/**
 * Refuse to run a `localOnly` seeder against anything but a local database.
 *
 * Checked before connecting, so the refusal costs nothing and cannot half-apply. This is the hook
 * `W0-T20` grows into: today it only asks "is this my laptop?", and the answer is enough to stop a
 * fixture reaching a preview environment.
 *
 * **`W0-T30`: it judges the seeders it is given**, which is the selection after `selectSeeders`,
 * not the registry. It used to be handed the registry unconditionally, so one `localOnly` fixture
 * refused every seeder beside it — including ones deliberately marked safe to travel — and
 * `pnpm db:seed` could not reach a deployed database at all. Naming a `localOnly` seeder in
 * `--only` is still refused: the gate got accurate, not weaker.
 */
export function assertSafeTarget(databaseUrl: string, seeders: readonly Seeder[]): void {
  const guarded = seeders.filter((seeder) => seeder.localOnly === true);
  if (guarded.length === 0) return;

  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    throw new SeedError('SEED_UNSAFE_TARGET', `DATABASE_URL is not a URL, so its host is unknown`);
  }

  if (isLocalTarget(databaseUrl)) return;

  throw new SeedError(
    'SEED_UNSAFE_TARGET',
    `refusing to run ${String(guarded.length)} local-only seeder(s) against host "${host}": ` +
      `${guarded.map((seeder) => seeder.id).join(', ')}. ` +
      'Non-local data comes from the sanitised pipeline (W0-T20), never from a fixture.',
  );
}

export interface RunSeedersOptions {
  readonly databaseUrl: string;
  readonly seeders: readonly Seeder[];
  /**
   * Run only these ids, in registry order — `--only` on the command line (`W0-T30` §3.1).
   *
   * Undefined runs the whole registry, which is what a developer's `pnpm db:seed` does.
   */
  readonly only?: readonly string[];
  /** `SEED_DEMO_PASSWORD`. Passed to every seeder through `SeedContext`; only one reads it. */
  readonly demoPassword?: string;
  /** Injected by tests. Otherwise a client is built and closed by this function. */
  readonly client?: PrismaClient;
}

/**
 * Run every seeder that is not already in the ledger, in registry order.
 *
 * Each seeder runs **inside a transaction together with its own ledger row**, so a seeder that
 * throws leaves neither its data nor a record claiming it ran (AC16). The alternative — record
 * afterwards — turns any crash into a database that is permanently half-seeded and cannot be
 * repaired by re-running.
 *
 * `only` narrows *which* seeders run, never the ledger's authority over them: a selected seeder
 * already recorded is still skipped, which is what makes the deploy step idempotent across every
 * push to a branch.
 */
export async function runSeeders(options: RunSeedersOptions): Promise<SeedResult> {
  const { databaseUrl } = options;

  // Uniqueness is asserted over the **whole registry**, before any filtering. A duplicate id is a
  // defect in the registry whether or not this particular run happens to select both copies.
  assertUniqueSeederIds(options.seeders);

  const seeders = selectSeeders(options.seeders, options.only);
  assertSafeTarget(databaseUrl, seeders);

  const target: SeedTarget = { isLocal: isLocalTarget(databaseUrl) };

  const client = options.client ?? new PrismaClient({ datasourceUrl: databaseUrl });
  const owned = options.client === undefined;

  try {
    const existing = await client.seedRun.findMany({ select: { id: true, ranAt: true } });
    const ledger = new Map(existing.map((row) => [row.id, row.ranAt]));

    const ran: string[] = [];
    const skipped: string[] = [];

    for (const seeder of seeders) {
      if (ledger.has(seeder.id)) {
        skipped.push(seeder.id);
        continue;
      }

      const row = await client.$transaction(async (db) => {
        await seeder.run({ db, target, demoPassword: options.demoPassword });
        return db.seedRun.create({
          data: { id: seeder.id, description: seeder.description },
          select: { id: true, ranAt: true },
        });
      });

      ledger.set(row.id, row.ranAt);
      ran.push(seeder.id);
    }

    return { ran, skipped, ledger: Object.fromEntries(ledger) };
  } finally {
    if (owned) await client.$disconnect();
  }
}
