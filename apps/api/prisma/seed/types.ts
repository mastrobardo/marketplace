import { type Prisma } from '@prisma/client';

/**
 * What a seeder is handed. It is a **transaction** client, not the root client: the seeder's work
 * and the ledger row that records it are written together or not at all (AC16).
 */
export interface SeedContext {
  readonly db: Prisma.TransactionClient;
}

/**
 * One unit of seed data.
 *
 * A seeder runs at most once per database, ever. That is the whole contract: it does not need to
 * be internally idempotent, because the ledger decides whether it runs — which means a seeder can
 * safely `create` rather than contorting itself into an `upsert` on a natural key it may not have.
 */
export interface Seeder {
  /** Stable, dotted, and permanent — it is the ledger key. Renaming one re-runs it. */
  readonly id: string;
  /** Why this data exists. Stored in the ledger, so `SELECT * FROM _seed_run` reads as a history. */
  readonly description: string;
  /**
   * True when this seeder must never touch anything but a local database.
   *
   * The reason is `W0-T20`: preview and staging databases are branched from sanitised data, and a
   * developer-convenience fixture must not be the thing that puts a fake licence number in an
   * environment somebody demos.
   */
  readonly localOnly?: boolean;
  run(context: SeedContext): Promise<void>;
}

/** What `runSeeders` reports back. */
export interface SeedResult {
  /** Ids that ran in this invocation, in order. */
  readonly ran: string[];
  /** Ids that were already in the ledger and were skipped. */
  readonly skipped: string[];
  /** The ledger after the run: seeder id → when it first ran. */
  readonly ledger: Record<string, Date>;
}

/** Machine-readable failures. The code is the first token of the message, so logs are greppable. */
export type SeedErrorCode = 'SEED_DUPLICATE_ID' | 'SEED_UNSAFE_TARGET';

export class SeedError extends Error {
  override readonly name = 'SeedError';
  constructor(
    readonly code: SeedErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}
