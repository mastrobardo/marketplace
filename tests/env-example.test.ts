import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLE = join(root, '.env.example');
const API_CONFIG = join(root, 'apps/api/src/config.ts');

interface Entry {
  key: string;
  value: string;
  /** Commented-out entries document an opt-in variable without setting it. */
  optedOut: boolean;
}

function entries(): Entry[] {
  return readFileSync(EXAMPLE, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .map((line): Entry | undefined => {
      const optedOut = line.startsWith('#');
      const body = optedOut ? line.replace(/^#\s*/, '') : line;
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(body);
      return match === undefined || match === null
        ? undefined
        : { key: match[1] as string, value: match[2] as string, optedOut };
    })
    .filter((entry): entry is Entry => entry !== undefined);
}

function keys(): string[] {
  return entries().map((entry) => entry.key);
}

/**
 * The API's environment schema, read from its source.
 *
 * Parsed rather than imported: `apps/api` owns `zod` and this suite runs from the workspace root,
 * where it is not resolvable. The shape being matched is narrow and the test fails loudly if
 * `EnvSchema` stops looking like this, which is the outcome we want anyway.
 */
function schema(): Array<{ name: string; required: boolean }> {
  const source = readFileSync(API_CONFIG, 'utf8');
  const block = /const EnvSchema = z\.object\(\{([\s\S]*?)\n\}\);/.exec(source);
  expect(
    block,
    'EnvSchema is no longer a z.object literal — this test needs updating',
  ).not.toBeNull();

  const declarations = [...(block?.[1] ?? '').matchAll(/^\s{2}([A-Z][A-Z0-9_]*):\s*(.+?),\s*$/gm)];
  expect(declarations.length, 'parsed no variables out of EnvSchema').toBeGreaterThan(0);

  return declarations.map((declaration) => ({
    name: declaration[1] as string,
    // A variable with a `.default(…)` is optional; one without it must be supplied.
    required: !(declaration[2] ?? '').includes('.default('),
  }));
}

/** Every `${{ secrets.NAME }}` any workflow reads. */
function workflowSecrets(): string[] {
  const dir = join(root, '.github/workflows');
  const names = readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) => [
      ...readFileSync(join(dir, file), 'utf8').matchAll(/secrets\.([A-Z][A-Z0-9_]*)/g),
    ])
    .map((match) => match[1] as string)
    .filter((name) => name !== 'GITHUB_TOKEN'); // provided by Actions, never set by a human
  return [...new Set(names)].sort();
}

/** The names the deploy guard checks for before it lets a deploy start. */
function guardSecrets(): string[] {
  const source = readFileSync(join(root, 'scripts/deploy/config.ts'), 'utf8');
  const block = /export const REQUIRED[\s\S]*?\n\};/.exec(source);
  expect(block, 'REQUIRED is no longer a literal — this test needs updating').not.toBeNull();
  const names = [...(block?.[0] ?? '').matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1] as string);
  return [...new Set(names)].sort();
}

/** The `${VAR}` interpolations docker-compose reads from the environment. */
function composeVariables(): string[] {
  const source = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
  return [
    ...new Set(
      [...source.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}/g)].map((m) => m[1] as string),
    ),
  ];
}

describe('the example covers every variable the API accepts', () => {
  it('documents each one', () => {
    for (const { name } of schema()) {
      expect(keys(), `.env.example does not mention ${name}`).toContain(name);
    }
  });

  it('sets the required ones, so a fresh copy boots', () => {
    for (const { name, required } of schema()) {
      if (!required) continue;
      const entry = entries().find((candidate) => candidate.key === name);
      expect(entry?.optedOut, `${name} is required but commented out`).toBe(false);
      expect(entry?.value ?? '', `${name} is required but has no value`).not.toBe('');
    }
  });

  it('mentions nothing that nothing reads', () => {
    const known = new Set([
      ...schema().map(({ name }) => name),
      ...composeVariables(),
      ...workflowSecrets(),
      'STACK_LIVE', // test opt-in, read by the suites directly
      'VITE_API_URL', // build-time, read by Vite rather than by the API
    ]);
    for (const key of keys()) {
      expect(known, `.env.example mentions ${key}, which nothing reads`).toContain(key);
    }
  });
});

describe('the example covers every variable the local stack reads', () => {
  it('documents each compose interpolation', () => {
    const variables = composeVariables();
    expect(variables.length, 'parsed no variables out of docker-compose.yml').toBeGreaterThan(0);
    for (const name of variables) {
      expect(keys(), `.env.example does not mention ${name}`).toContain(name);
    }
  });

  it('offers the same default the compose file falls back to', () => {
    const source = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
    for (const match of source.matchAll(/\$\{([A-Z][A-Z0-9_]*):-([^}]*)\}/g)) {
      const [, name, fallback] = match;
      const entry = entries().find((candidate) => candidate.key === name);
      expect(entry?.value, `${String(name)} differs from the compose default`).toBe(fallback);
    }
  });
});

describe('a fresh copy actually works against the local stack', () => {
  it('points DATABASE_URL at the compose database with the compose credentials', () => {
    const compose = parseYaml(readFileSync(join(root, 'docker-compose.yml'), 'utf8')) as {
      services?: Record<string, { environment?: Record<string, string> }>;
    };
    const db = compose.services?.['db']?.environment ?? {};
    const url = new URL(entries().find((entry) => entry.key === 'DATABASE_URL')?.value ?? '');

    expect(url.username).toBe(db['POSTGRES_USER']);
    expect(url.password).toBe(db['POSTGRES_PASSWORD']);
    expect(url.pathname.slice(1)).toBe(db['POSTGRES_DB']);
    expect(url.port, 'DATABASE_URL disagrees with POSTGRES_PORT').toBe(
      entries().find((entry) => entry.key === 'POSTGRES_PORT')?.value,
    );
  });

  it('binds to loopback by default, so a laptop on a café network serves nothing', () => {
    expect(entries().find((entry) => entry.key === 'HOST')?.value).toBe('127.0.0.1');
  });
});

describe('the deploy credentials are inventoried, and only inventoried', () => {
  it('names every secret the workflows read', () => {
    const secrets = workflowSecrets();
    expect(
      secrets.length,
      'no workflow reads a secret — did the deploy pipeline move?',
    ).toBeGreaterThan(0);
    for (const name of secrets) {
      expect(keys(), `${name} is read by a workflow but undocumented in .env.example`).toContain(
        name,
      );
    }
  });

  it('agrees with the guard, so nothing is consumed without being checked for first', () => {
    // The failure this catches for real: PREVIEW_DATABASE_URL was read by deploy-preview.yml and
    // absent from REQUIRED, so the guard reported "configured", created a Fly app and a Neon
    // branch, and only then hit an empty DATABASE_URL — the half-built state the guard exists to
    // prevent.
    expect(guardSecrets()).toEqual(workflowSecrets());
  });

  it('leaves every one of them commented out and empty', () => {
    for (const name of workflowSecrets()) {
      const entry = entries().find((candidate) => candidate.key === name);
      expect(entry?.optedOut, `${name} is live in .env.example — it belongs in GitHub`).toBe(true);
      expect(entry?.value, `${name} carries a value; this file must hold names only`).toBe('');
    }
  });

  it('says where a human sets them', () => {
    const body = readFileSync(EXAMPLE, 'utf8');
    expect(body).toMatch(/Settings.*Environments/);
    for (const environment of ['preview', 'staging', 'production']) {
      expect(body, `.env.example does not group secrets by ${environment}`).toContain(environment);
    }
  });
});

describe('the example holds no real credential', () => {
  it('carries no provider token shape', () => {
    const shapes = /(FlyV1 |fo1_|CFPAT-|neon_api_key_[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9]{20})/;
    expect(shapes.test(readFileSync(EXAMPLE, 'utf8'))).toBe(false);
  });

  it('is committed, unlike every other .env', () => {
    const ignored = readFileSync(join(root, '.gitignore'), 'utf8');
    expect(ignored).toMatch(/^\.env\.\*$/m);
    expect(ignored, '.env.example is ignored along with the rest').toMatch(/^!\.env\.example$/m);
  });
});
