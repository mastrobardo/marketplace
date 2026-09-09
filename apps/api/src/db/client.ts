import { PrismaClient } from '@prisma/client';
import { type Config } from '../config.js';

export interface GetPrismaClientOptions {
  /**
   * Build a client that bypasses the process-wide cache. Only tests and one-shot scripts want
   * this — a request handler that opens its own pool per call exhausts Postgres connections.
   */
  fresh?: boolean;
}

let cached: PrismaClient | undefined;

function build(config: Config): PrismaClient {
  return new PrismaClient({
    // Explicit, from the validated `Config`. Prisma would otherwise read DATABASE_URL out of the
    // ambient environment itself, which is exactly the coupling `src/config.ts` exists to prevent:
    // the API would then have two sources of truth for where its database is.
    datasourceUrl: config.DATABASE_URL,
    log: config.LOG_LEVEL === 'trace' || config.LOG_LEVEL === 'debug' ? ['query'] : [],
  });
}

/**
 * The process-wide Prisma client, built from a validated `Config`.
 *
 * Constructing a client does **not** open a connection — Prisma connects lazily on the first
 * query — so calling this at the composition root would still be free. It is nevertheless not
 * called there: `buildApp` must stay usable in a test with no database, and a module that needs
 * data should receive a client rather than reach for one.
 */
export function getPrismaClient(
  config: Config,
  options: GetPrismaClientOptions = {},
): PrismaClient {
  if (options.fresh === true) return build(config);
  cached ??= build(config);
  return cached;
}

/** Close the cached pool. Safe to call when nothing was ever opened. */
export async function disconnect(): Promise<void> {
  const client = cached;
  cached = undefined;
  if (client !== undefined) await client.$disconnect();
}
