import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Every directory under the repo that declares a package.json, excluding the root and any dep. */
function workspaceDirs(dir = root, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (['node_modules', '.git', 'dist', '.turbo'].includes(entry.name)) continue;
    const child = join(dir, entry.name);
    try {
      statSync(join(child, 'package.json'));
      found.push(child);
    } catch {
      /* not a package */
    }
    workspaceDirs(child, found);
  }
  return found;
}

interface PackageJson {
  name?: string;
  packageManager?: string;
  engines?: { node?: string };
}

interface TsConfig {
  extends?: string;
  compilerOptions?: Record<string, unknown>;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** `apps/*` → /^apps\/[^/]+$/ */
function globToRegExp(glob: string): RegExp {
  return new RegExp(
    `^${glob
      .split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]+')}$`,
  );
}

describe('AC1/AC2 — pnpm workspace resolves across apps and packages', () => {
  it('declares workspace globs covering apps and packages', () => {
    const manifest = parseYaml(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')) as {
      packages?: string[];
    };
    expect(manifest.packages).toEqual(expect.arrayContaining(['apps/*', 'packages/*']));
  });

  it('matches every package.json in the repo with a workspace glob', () => {
    const globs = (
      parseYaml(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')) as { packages: string[] }
    ).packages.map(globToRegExp);
    const unmatched = workspaceDirs()
      .map((d) => relative(root, d))
      .filter((d) => !globs.some((g) => g.test(d)));
    expect(unmatched).toEqual([]);
  });

  it('names every workspace member @marketplace/<dir>', () => {
    const dirs = workspaceDirs();
    expect(dirs.length, 'no workspace members exist').toBeGreaterThan(0);
    for (const dir of dirs) {
      const pkg = readJson<PackageJson>(join(dir, 'package.json'));
      expect(pkg.name, `${relative(root, dir)} is misnamed`).toBe(
        `@marketplace/${dir.split('/').pop()}`,
      );
    }
  });

  it('pins the package manager and the node engine at the root', () => {
    const pkg = readJson<PackageJson>(join(root, 'package.json'));
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+/);
    expect(pkg.engines?.node).toBeDefined();
  });
});

describe('AC4/AC5 — one shared TypeScript base, extended not copied', () => {
  const BASE_OWNED = ['strict', 'target', 'module', 'moduleResolution'];

  it('has every workspace member extend a shared preset', () => {
    const dirs = workspaceDirs();
    expect(dirs.length, 'no workspace members exist').toBeGreaterThan(0);
    for (const dir of dirs) {
      const tsconfig = readJson<TsConfig>(join(dir, 'tsconfig.json'));
      expect(tsconfig.extends, `${relative(root, dir)} does not extend a shared preset`).toMatch(
        /^@marketplace\/config\/tsconfig\//,
      );
    }
  });

  it('lets no workspace member re-declare an option the base already sets', () => {
    const dirs = workspaceDirs();
    expect(dirs.length, 'no workspace members exist').toBeGreaterThan(0);
    for (const dir of dirs) {
      const tsconfig = readJson<TsConfig>(join(dir, 'tsconfig.json'));
      const options = Object.keys(tsconfig.compilerOptions ?? {});
      expect(
        options.filter((o) => BASE_OWNED.includes(o)),
        relative(root, dir),
      ).toEqual([]);
    }
  });

  it('makes the base strict', () => {
    const base = readJson<TsConfig>(join(root, 'packages/config/tsconfig/base.json'));
    expect(base.compilerOptions?.['strict']).toBe(true);
    expect(base.compilerOptions?.['noUncheckedIndexedAccess']).toBe(true);
  });
});

/**
 * `W0-T23`. The README Layout table has one row per workspace member and every task edited its own
 * row, which is why it conflicted twice in the #150/#151/#152 session. Each row now comes from that
 * member's own `package.json` — a file nobody else touches — and the table is generated from them.
 */
describe('W0-T23 — the Layout table is generated, not hand-edited', () => {
  it('gives every workspace member a description to be described by', () => {
    for (const dir of workspaceDirs()) {
      const manifest = readJson<{ name?: string; description?: string }>(join(dir, 'package.json'));
      expect(
        manifest.description?.trim(),
        `${relative(root, dir)}/package.json has no "description" — it is the source of that ` +
          "member's row in the README Layout table",
      ).toBeTruthy();
    }
  });

  it('matches a fresh render', () => {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/render-readme.ts', '--check'],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status, `${result.stderr}${result.stdout}`).toBe(0);
  });
});
