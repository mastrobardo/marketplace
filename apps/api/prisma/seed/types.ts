import { type Prisma } from '@prisma/client';

/**
 * Where this run is pointed, as far as a seeder needs to care.
 *
 * `isLocal` is computed once by `run.ts` from the same `LOCAL_HOSTS` set `assertSafeTarget` uses,
 * so "local" has one definition and two consumers rather than two definitions that drift.
 */
export interface SeedTarget {
  readonly isLocal: boolean;
}

/**
 * What a seeder is handed. It is a **transaction** client, not the root client: the seeder's work
 * and the ledger row that records it are written together or not at all (AC16).
 */
export interface SeedContext {
  readonly db: Prisma.TransactionClient;
  /** Where the run is pointed. `W0-T30` §3.3 — a fixture may need to behave differently off-laptop. */
  readonly target: SeedTarget;
  /**
   * `SEED_DEMO_PASSWORD`, when the environment set one.
   *
   * On the context rather than read from `process.env` by the seeder that wants it: `config.ts`
   * owns every variable this system reads, and a module reaching into the ambient environment is a
   * review failure. Undefined is the normal local case, not an error — `auth.demo-users` decides
   * what to do about that, because it is the only thing that knows both this and the target.
   */
  readonly demoPassword: string | undefined;
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
   *
   * **No registered seeder declares this today** (`W0-T30` §3.2). `auth.demo-users` used to, for
   * its published password, and now resolves one from the environment instead — which is a better
   * answer than not travelling, because staging needs an account somebody can sign in as. The flag
   * stays for `W0-T20`'s real cases: anything carrying sanitised or personal data.
   *
   * Since `W0-T30` the gate judges the seeders **selected for this run**, not the whole registry,
   * so one such fixture no longer refuses everything alongside it.
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
export type SeedErrorCode =
  'SEED_DUPLICATE_ID' | 'SEED_UNSAFE_TARGET' | 'SEED_UNKNOWN_ID' | 'SEED_WEAK_CREDENTIAL';

export class SeedError extends Error {
  override readonly name = 'SeedError';
  constructor(
    readonly code: SeedErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
  }
}
