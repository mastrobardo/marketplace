/**
 * `pnpm db:seed` — and the command Prisma runs after `migrate reset` (see package.json `prisma`).
 *
 * Deliberately thin: everything worth testing lives in `seed/run.ts`, which takes its database URL
 * and its selection as arguments. This file is the only part that knows there is a process.
 */
import { loadSeedConfig } from '../src/config.js';
import { seeders } from './seed/registry.js';
import { runSeeders } from './seed/run.js';

/**
 * Read `--only a,b` / `--only=a,b` out of the arguments.
 *
 * Hand-rolled rather than pulled from a parser library: one flag does not justify a dependency in
 * the seed path, and the failure modes that matter — an unknown id, an empty list — are `run.ts`'s
 * to report, with the registry in the message.
 *
 * Returns `undefined` when the flag is absent, which is what makes a bare `pnpm db:seed` mean
 * exactly what it always meant.
 *
 * ⚠ **Pass it after `--`** from the repository root: `pnpm db:seed -- --only categories.taxonomy`.
 * The root script delegates through a second `pnpm --filter`, and pnpm consumes flags it
 * recognises before the script ever sees them. See `memory/slices/agent-devops.md`.
 */
export function parseOnly(argv: readonly string[]): string[] | undefined {
  const flag = argv.findIndex((arg) => arg === '--only' || arg.startsWith('--only='));
  if (flag === -1) return undefined;

  const inline = argv[flag]?.startsWith('--only=') === true;
  const raw = inline ? (argv[flag]?.slice('--only='.length) ?? '') : (argv[flag + 1] ?? '');

  return raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
}

async function main(): Promise<void> {
  // `loadSeedConfig`, not `loadConfig`: a seeder needs a database and a password, not an auth
  // signing key. Asking for the whole schema made every deployed seed run fail on a variable it
  // does not read — see `config.ts`.
  const config = loadSeedConfig();
  const only = parseOnly(process.argv.slice(2));

  const result = await runSeeders({
    databaseUrl: config.DATABASE_URL,
    seeders,
    ...(only === undefined ? {} : { only }),
    ...(config.SEED_DEMO_PASSWORD === undefined ? {} : { demoPassword: config.SEED_DEMO_PASSWORD }),
  });

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
