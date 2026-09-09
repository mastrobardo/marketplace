import { describe, expect, it } from 'vitest';

import {
  REQUIRED,
  type DeployTarget,
  checkDeployConfig,
  renderMissing,
} from '../scripts/deploy/config.js';
import { previewAppName, previewBranchName } from '../scripts/deploy/names.js';

const TARGETS: DeployTarget[] = ['preview', 'staging', 'production'];

/** An environment with every variable a target needs. */
function complete(target: DeployTarget): Record<string, string> {
  return Object.fromEntries((REQUIRED[target] ?? []).map((name) => [name, 'set-by-a-human']));
}

describe('AC1 — a fully configured environment is configured', () => {
  for (const target of TARGETS) {
    it(`${target} reports configured with nothing missing`, () => {
      const result = checkDeployConfig(complete(target), target);
      expect(result.configured).toBe(true);
      expect(result.missing).toEqual([]);
    });
  }
});

describe('AC2 — every missing name is reported, not just the first', () => {
  it('names both', () => {
    const target: DeployTarget = 'preview';
    const required = REQUIRED[target] ?? [];
    expect(required.length).toBeGreaterThanOrEqual(2);

    const env = complete(target);
    const [first, second] = required;
    delete env[first as string];
    delete env[second as string];

    const result = checkDeployConfig(env, target);
    expect(result.configured).toBe(false);
    expect(result.missing).toEqual([first, second]);
  });
});

describe('AC3 — an empty value is a missing value', () => {
  it('treats "" as unset, because that is what an unset GitHub secret interpolates to', () => {
    const target: DeployTarget = 'staging';
    const required = REQUIRED[target] ?? [];
    const env = { ...complete(target), [required[0] as string]: '' };

    const result = checkDeployConfig(env, target);
    expect(result.configured).toBe(false);
    expect(result.missing).toContain(required[0]);
  });

  it('treats whitespace as unset too', () => {
    const target: DeployTarget = 'staging';
    const required = REQUIRED[target] ?? [];
    const env = { ...complete(target), [required[0] as string]: '   ' };
    expect(checkDeployConfig(env, target).configured).toBe(false);
  });
});

describe('AC4 — every target declares a real requirement set', () => {
  for (const target of TARGETS) {
    it(`${target} names at least one SCREAMING_SNAKE_CASE variable`, () => {
      const required = REQUIRED[target] ?? [];
      expect(required.length, `${target} requires nothing`).toBeGreaterThan(0);
      for (const name of required) {
        expect(name, `${name} is not a secret name`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    });
  }

  it('scopes production to the smallest set — it must not need Cloudflare or Neon API keys', () => {
    const production = REQUIRED['production'] ?? [];
    expect(production).not.toContain('CLOUDFLARE_API_TOKEN');
    expect(production).not.toContain('NEON_API_KEY');
  });
});

describe('AC5 — the operator is told exactly where to set what is missing', () => {
  it('names the GitHub settings path for every missing secret', () => {
    const target: DeployTarget = 'preview';
    const result = checkDeployConfig({}, target);
    const rendered = renderMissing(result, target);

    for (const name of result.missing) {
      expect(rendered, `${name} is missing but not explained`).toContain(name);
    }
    expect(rendered).toMatch(/Settings/i);
    expect(rendered).toMatch(/Environments/i);
    expect(rendered).toContain(target);
  });
});

describe('AC6 — nothing rendered can leak a value', () => {
  it('echoes no value back, even when one is present', () => {
    const target: DeployTarget = 'preview';
    const required = REQUIRED[target] ?? [];
    const env = { ...complete(target), [required[0] as string]: 'fly_super_secret_value' };
    delete env[required[1] as string];

    const rendered = renderMissing(checkDeployConfig(env, target), target);
    expect(rendered).not.toContain('fly_super_secret_value');
  });
});

describe('AC7 — a preview app name is deterministic and Fly-legal', () => {
  it('is stable for a PR number', () => {
    expect(previewAppName(42)).toBe(previewAppName(42));
  });

  it('is lowercase, DNS-safe and at most 30 characters', () => {
    for (const pr of [1, 42, 155, 99999]) {
      const name = previewAppName(pr);
      expect(name, `${name} is not DNS-safe`).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
      expect(name.length, `${name} is ${String(name.length)} characters`).toBeLessThanOrEqual(30);
    }
  });

  it('contains the PR number, so the app is identifiable from its name alone', () => {
    expect(previewAppName(155)).toContain('155');
  });

  it('refuses a PR number that is not a positive integer', () => {
    expect(() => previewAppName(0)).toThrow();
    expect(() => previewAppName(-1)).toThrow();
    expect(() => previewAppName(1.5)).toThrow();
  });
});

describe('AC8 — two PRs never share an environment', () => {
  it('gives different names to different PRs', () => {
    const names = new Set([1, 2, 42, 155, 99999].map((pr) => previewAppName(pr)));
    expect(names.size).toBe(5);
  });

  it('names the Neon branch per PR too', () => {
    expect(previewBranchName(1)).not.toBe(previewBranchName(2));
    expect(previewBranchName(155)).toContain('155');
  });
});
