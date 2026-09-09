/**
 * `pnpm db:reset` — drop, re-migrate, re-seed.
 *
 * Wrapped rather than calling `prisma migrate reset` directly because `--force` is required to run
 * it non-interactively, and `--force` on the wrong `DATABASE_URL` is how a production database is
 * lost. The guard below is the whole reason this file exists.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export class ResetRefused extends Error {
  override readonly name = 'ResetRefused';
}

export interface ResetEnvironment {
  readonly NODE_ENV?: string | undefined;
}

/** Throw unless this environment may be destroyed. */
export function assertResettable(env: ResetEnvironment): void {
  if (env.NODE_ENV === 'production') {
    throw new ResetRefused(
      'RESET_IN_PRODUCTION: refusing to drop the database because NODE_ENV is "production". ' +
        'A production schema changes by `pnpm db:migrate:deploy` and nothing else (ADR-006).',
    );
  }
}

function main(): void {
  assertResettable(process.env);
  execFileSync('prisma', ['migrate', 'reset', '--force'], { stdio: 'inherit' });
}

/** True only when this file is the process entrypoint — importing it from a test must not reset. */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
