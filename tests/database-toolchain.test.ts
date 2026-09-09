import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

interface Manifest {
  scripts?: Record<string, string>;
  prisma?: { seed?: string };
}

function manifest(path: string): Manifest {
  return JSON.parse(readFileSync(join(root, path), 'utf8')) as Manifest;
}

/** Spec §4 — the command set is the public surface of this task. */
const COMMANDS = [
  'db:generate',
  'db:migrate',
  'db:migrate:deploy',
  'db:migrate:status',
  'db:seed',
  'db:reset',
] as const;

describe('AC20 — the database commands exist at the workspace root', () => {
  const scripts = manifest('package.json').scripts ?? {};

  for (const command of COMMANDS) {
    it(`exposes pnpm ${command}`, () => {
      expect(scripts[command], `root package.json has no "${command}" script`).toBeDefined();
    });
  }

  it('delegates each one to the api package rather than reimplementing it', () => {
    for (const command of COMMANDS) {
      expect(scripts[command]).toContain('@marketplace/api');
    }
  });

  it('keeps them out of the local gate, which must stay daemon-free', () => {
    const verify = scripts['verify'] ?? '';
    expect(verify, 'verify would now need a running database').not.toMatch(/\bdb:/);
  });

  it('generates the client as part of install, so pnpm install stays the whole setup', () => {
    expect(scripts['prepare'] ?? '').toMatch(/db:generate|prisma generate/);
  });
});

describe('AC20 — the api package owns the implementations', () => {
  const api = manifest('apps/api/package.json');
  const scripts = api.scripts ?? {};

  for (const command of COMMANDS) {
    it(`implements ${command}`, () => {
      expect(scripts[command], `apps/api/package.json has no "${command}" script`).toBeDefined();
    });
  }

  it('points prisma at the seed entrypoint, so migrate reset seeds too', () => {
    expect(api.prisma?.seed).toBeDefined();
  });

  it('never lets migrations run implicitly on start — ADR-006 wants a separate approved step', () => {
    expect(scripts['start'] ?? '').not.toMatch(/migrate/);
    expect(scripts['dev'] ?? '').not.toMatch(/migrate/);
  });
});

describe('AC21 — the generated client is never committed', () => {
  it('ignores prisma generation output', () => {
    const ignored = readFileSync(join(root, '.gitignore'), 'utf8');
    expect(ignored).toMatch(/\.prisma|generated/);
  });
});
