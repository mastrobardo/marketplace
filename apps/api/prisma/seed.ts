/**
 * `pnpm db:seed` — and the command Prisma runs after `migrate reset` (see package.json `prisma`).
 *
 * Deliberately thin: everything worth testing lives in `seed/run.ts`, which takes its database URL
 * as an argument. This file is the only part that knows there is a process.
 */
import { loadConfig } from '../src/config.js';
import { seeders } from './seed/registry.js';
import { runSeeders } from './seed/run.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const result = await runSeeders({ databaseUrl: config.DATABASE_URL, seeders });

  if (result.ran.length === 0 && result.skipped.length === 0) {
    console.warn('seed: nothing registered — the registry is empty (W0-T05 ships the pipeline).');
    return;
  }
  console.warn(
    `seed: ran ${String(result.ran.length)} (${result.ran.join(', ') || '—'}), ` +
      `skipped ${String(result.skipped.length)} already applied.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
