import { PrismaClient } from '@prisma/client';
import { SeedError, type SeedResult, type Seeder } from './types.js';

/**
 * Hosts a `localOnly` seeder may write to. Anything else is somebody's shared environment.
 * `db` is the compose service name, which is how the API reaches Postgres from inside the network.
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', 'db']);

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
 * Refuse to run a `localOnly` seeder against anything but a local database.
 *
 * Checked before connecting, so the refusal costs nothing and cannot half-apply. This is the hook
 * `W0-T20` grows into: today it only asks "is this my laptop?", and the answer is enough to stop a
 * fixture reaching a preview environment.
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

  if (LOCAL_HOSTS.has(host)) return;

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
 */
export async function runSeeders(options: RunSeedersOptions): Promise<SeedResult> {
  const { databaseUrl, seeders } = options;

  assertUniqueSeederIds(seeders);
  assertSafeTarget(databaseUrl, seeders);

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
        await seeder.run({ db });
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
