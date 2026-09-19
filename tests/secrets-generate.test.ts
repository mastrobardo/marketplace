/**
 * `W0-T31` — the secret generator, and the three ways it must not leak.
 *
 * The interesting assertions here are the **negative** ones: that a value never reaches `argv`,
 * that nothing is generated when stdout is captured, and that `--write` prints no value. Each of
 * those is a property the tool claims in its own header, and a claim in a comment is worth nothing.
 *
 * Nothing in this suite ever runs `gh`, and nothing writes a real secret: `writeSecret` takes an
 * injected spawn, and every other export is pure.
 *
 * Spec: `docs/specs/S0/W0-T31-secret-generation.md` §5.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REQUIRED } from '../scripts/deploy/config.js';
import {
  ISSUED_ELSEWHERE,
  environmentsFor,
  generatableSecrets,
  knownSecrets,
  recipeFor,
} from '../scripts/secrets/strength.js';
import {
  SecretToolError,
  generate,
  outputIsCaptured,
  parseArgs,
  resolveEnvironment,
  rotationNote,
  writeSecret,
  type Spawn,
} from '../scripts/secrets/generate.js';

const root = fileURLToPath(new URL('..', import.meta.url));

describe('AC1 — entropy comes from the CSPRNG, never from Math.random', () => {
  it('uses node:crypto randomBytes and nothing else', () => {
    const source = readFileSync(join(root, 'scripts/secrets/generate.ts'), 'utf8');
    expect(source).toMatch(/import \{ randomBytes \} from 'node:crypto'/);
    // The failure this prevents is a "temporary" Math.random that nobody reads again. A generated
    // credential is exactly the place where a predictable PRNG is indistinguishable from a good
    // one by eye, and catastrophic.
    expect(source, 'Math.random has no business in a credential path').not.toMatch(/Math\.random/);
  });

  it('does not repeat itself', () => {
    const recipe = recipeFor('PREVIEW_SEED_DEMO_PASSWORD');
    expect(recipe).toBeDefined();
    const values = new Set(Array.from({ length: 200 }, () => generate(recipe!)));
    expect(values.size, 'two generated values collided').toBe(200);
  });
});

describe('AC2 — a generated value clears the floor the schema demands', () => {
  /** The minimum `EnvSchema` enforces for a variable, read from its source. */
  function schemaFloor(variable: string): number {
    const source = readFileSync(join(root, 'apps/api/src/config.ts'), 'utf8');
    const line = new RegExp(`${variable}: (.+?),\\s*$`, 'm').exec(source);
    expect(line, `${variable} is not in EnvSchema`).not.toBeNull();
    const min = /\.min\((\d+)/.exec(line?.[1] ?? '');
    expect(min, `${variable} declares no .min()`).not.toBeNull();
    return Number(min?.[1]);
  }

  it('a seed password is comfortably longer than SEED_DEMO_PASSWORD.min()', () => {
    const recipe = recipeFor('STAGING_SEED_DEMO_PASSWORD');
    const value = generate(recipe!);
    expect(value.length).toBeGreaterThan(schemaFloor('SEED_DEMO_PASSWORD'));
  });

  it('an auth secret clears better-auth 32-character floor', () => {
    const recipe = recipeFor('STAGING_BETTER_AUTH_SECRET');
    const value = generate(recipe!);
    expect(value.length).toBeGreaterThanOrEqual(schemaFloor('BETTER_AUTH_SECRET'));
  });

  it('produces URL-safe characters only, so a paste cannot be mangled', () => {
    for (const name of generatableSecrets()) {
      const value = generate(recipeFor(name)!);
      expect(value, `${name} produced a value needing escaping`).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('AC3 — the value never reaches a command line', () => {
  it('passes the secret on stdin and never in argv', () => {
    const seen: { args: readonly string[]; input: string }[] = [];
    const spy: Spawn = (_command, args, options) => {
      seen.push({ args, input: options.input });
      return { status: 0 };
    };

    writeSecret('PREVIEW_SEED_DEMO_PASSWORD', 'preview', 'the-secret-value', spy);

    expect(seen).toHaveLength(1);
    const call = seen[0]!;
    // `ps`, shell history and any process listing read argv. This is the whole mechanism.
    expect(call.args.join(' '), 'the value appeared in argv').not.toContain('the-secret-value');
    expect(call.args).toEqual(['secret', 'set', 'PREVIEW_SEED_DEMO_PASSWORD', '--env', 'preview']);
    expect(call.input).toBe('the-secret-value');
  });

  it('reports a failed write without echoing what it tried to write', () => {
    const spy: Spawn = () => ({ status: 1 });
    try {
      writeSecret('PREVIEW_SEED_DEMO_PASSWORD', 'preview', 'the-secret-value', spy);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(SecretToolError);
      expect((error as Error).message).not.toContain('the-secret-value');
    }
  });
});

describe('AC4 — captured output aborts before anything is generated', () => {
  it('treats a non-TTY stdout as captured', () => {
    expect(outputIsCaptured({ isTTY: false }, {})).toBe(true);
    expect(outputIsCaptured({}, {})).toBe(true);
  });

  it('treats a real terminal as safe', () => {
    expect(outputIsCaptured({ isTTY: true }, {})).toBe(false);
  });

  it('refuses under CI even with a TTY, because a job log is a transcript', () => {
    expect(outputIsCaptured({ isTTY: true }, { CI: 'true' })).toBe(true);
    expect(outputIsCaptured({ isTTY: true }, { CI: '1' })).toBe(true);
  });

  it('is not fooled by CI=false or an empty CI', () => {
    expect(outputIsCaptured({ isTTY: true }, { CI: 'false' })).toBe(false);
    expect(outputIsCaptured({ isTTY: true }, { CI: '' })).toBe(false);
  });

  it('checks for capture before generating, so a refusal produces no value', () => {
    const source = readFileSync(join(root, 'scripts/secrets/generate.ts'), 'utf8');
    const guard = source.indexOf('outputIsCaptured()');
    const draw = source.indexOf('const value = generate(recipe)');
    expect(guard, 'main() no longer guards on captured output').toBeGreaterThan(-1);
    expect(draw, 'main() no longer generates a value').toBeGreaterThan(-1);
    expect(guard, 'entropy is drawn before the capture check').toBeLessThan(draw);
  });
});

describe('AC5 — --write prints no value', () => {
  it('has no console call carrying the value in the write branch', () => {
    const source = readFileSync(join(root, 'scripts/secrets/generate.ts'), 'utf8');
    const write = source.slice(
      source.indexOf('if (options.write)'),
      source.indexOf('console.log(`\\n${name}  ('),
    );
    expect(write, 'the write branch mentions the value').not.toMatch(
      /console\.log\([^)]*\bvalue\b/,
    );
    // The print-only branch is the *only* place a value is allowed to reach stdout.
    const printOnly = source.slice(source.indexOf('console.log(`\\n${name}  ('));
    expect(printOnly).toMatch(/\$\{value\}/);
  });
});

describe('AC6 — every secret the guard requires is accounted for', () => {
  it('classifies each REQUIRED name as generatable or explicitly vendor-issued', () => {
    // Deliberately *not* `recipeFor(name) === undefined` — that is a tautology, since
    // `generatableSecrets()` is defined as the names with a recipe. The point of this assertion is
    // that a secret added to REQUIRED fails here until a human says which kind it is.
    const generatable = new Set(generatableSecrets());
    const issued = new Set(ISSUED_ELSEWHERE);

    for (const name of knownSecrets()) {
      expect(
        generatable.has(name) || issued.has(name),
        `${name} is in REQUIRED but classified neither generatable nor vendor-issued — ` +
          'add a recipe in strength.ts, or list it in ISSUED_ELSEWHERE',
      ).toBe(true);
    }
  });

  it('never claims a secret is both generatable and vendor-issued', () => {
    for (const name of generatableSecrets()) {
      expect(ISSUED_ELSEWHERE, `${name} is in both lists`).not.toContain(name);
    }
  });

  it('lists no secret the guard does not require', () => {
    for (const name of ISSUED_ELSEWHERE) {
      expect(knownSecrets(), `${name} is listed but no environment requires it`).toContain(name);
    }
  });

  it('knows every environment REQUIRED declares', () => {
    for (const target of Object.keys(REQUIRED)) {
      const owned = knownSecrets().filter((name) =>
        environmentsFor(name).includes(target as never),
      );
      expect(owned.length, `no secret resolves to ${target}`).toBeGreaterThan(0);
    }
  });

  it('refuses to invent a vendor credential', () => {
    // Generating 32 random bytes for a Fly token produces something the right shape that simply
    // does not work — a failure that surfaces at deploy time, far from its cause.
    expect(recipeFor('FLY_API_TOKEN')).toBeUndefined();
    expect(recipeFor('NEON_API_KEY')).toBeUndefined();
    expect(recipeFor('CLOUDFLARE_API_TOKEN')).toBeUndefined();
  });
});

describe('AC7 — a write goes to exactly one environment', () => {
  it('resolves a secret that belongs to one environment', () => {
    expect(resolveEnvironment('STAGING_SEED_DEMO_PASSWORD', undefined)).toBe('staging');
  });

  it('refuses a shared secret without --env, rather than picking for you', () => {
    expect(environmentsFor('FLY_API_TOKEN').length).toBeGreaterThan(1);
    expect(() => resolveEnvironment('FLY_API_TOKEN', undefined)).toThrow(/--env must say which/);
  });

  it('refuses an --env the secret does not belong to', () => {
    expect(() => resolveEnvironment('STAGING_SEED_DEMO_PASSWORD', 'production')).toThrow(
      /does not belong to the "production" environment/,
    );
  });

  it('refuses a name no guard checks for', () => {
    expect(() => resolveEnvironment('MADE_UP_SECRET', undefined)).toThrow(/is not in REQUIRED/);
  });
});

describe('AC8 — the rotation note tells the truth about seeded passwords', () => {
  it('warns that a seed password does not rotate on its own', () => {
    const note = rotationNote(
      'STAGING_SEED_DEMO_PASSWORD',
      recipeFor('STAGING_SEED_DEMO_PASSWORD')!,
    );
    // W0-T30: the seeder is skipped for ever once its ledger row exists, so setting a new value
    // changes nothing about accounts that already exist. A tool implying otherwise is worse than none.
    expect(note).toMatch(/NOT immediate/);
    expect(note).toMatch(/_seed_run|re-seed/);
  });

  it('says an auth secret rotates immediately', () => {
    const note = rotationNote(
      'STAGING_BETTER_AUTH_SECRET',
      recipeFor('STAGING_BETTER_AUTH_SECRET')!,
    );
    expect(note).toMatch(/immediate/);
    expect(note).not.toMatch(/NOT immediate/);
  });
});

describe('AC9 — argument parsing', () => {
  it('reads a name, --write, --list and --env in both spellings', () => {
    expect(parseArgs(['PREVIEW_SEED_DEMO_PASSWORD'])).toMatchObject({
      name: 'PREVIEW_SEED_DEMO_PASSWORD',
      write: false,
      list: false,
    });
    expect(parseArgs(['FLY_API_TOKEN', '--write', '--env', 'staging'])).toMatchObject({
      name: 'FLY_API_TOKEN',
      write: true,
      env: 'staging',
    });
    expect(parseArgs(['FLY_API_TOKEN', '--env=preview'])).toMatchObject({ env: 'preview' });
    // The key is omitted rather than set to undefined — `exactOptionalPropertyTypes` is on.
    expect(parseArgs(['--list']).list).toBe(true);
    expect(parseArgs(['--list'])).not.toHaveProperty('name');
  });
});
