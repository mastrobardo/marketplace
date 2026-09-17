import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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

describe('W12-T20 AC7 — `pnpm dev` works on a clean checkout', () => {
  interface Manifest {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    exports?: Record<string, unknown>;
  }

  /**
   * The workspace packages `apps/web` imports whose exports map points into a build output.
   *
   * Derived rather than listed: `@marketplace/ui` is the only one today, and the day a second one
   * appears is exactly the day nobody remembers to add it here. `W12-T20` exists because a
   * stylesheet that is never loaded fails silently; a `dist/` export that was never built fails
   * loudly, but only for whoever cloned the repo — never in CI, where `turbo.json`'s `^build`
   * already covers it.
   */
  function builtDependencies(): string[] {
    const web = readJson<Manifest>(join(root, 'apps/web/package.json'));
    return Object.entries(web.dependencies ?? {})
      .filter(([, version]) => version.startsWith('workspace:'))
      .map(([name]) => name)
      .filter((name) => {
        const dir = join(root, 'packages', name.replace('@marketplace/', ''));
        let manifest: Manifest;
        try {
          manifest = readJson<Manifest>(join(dir, 'package.json'));
        } catch {
          return false;
        }
        return JSON.stringify(manifest.exports ?? {}).includes('dist/');
      });
  }

  it('finds at least one workspace dependency that must be built first', () => {
    // The completeness half: a derivation that derives nothing makes the assertion below vacuous.
    expect(
      builtDependencies().length,
      'no built workspace dependency was derived — the assertion below proves nothing',
    ).toBeGreaterThan(0);
  });

  it('builds every one of them before starting the dev server', () => {
    const dev = readJson<Manifest>(join(root, 'package.json')).scripts?.['dev'] ?? '';

    // `turbo`, not `pnpm --filter`: the latter does not build a package's own workspace
    // dependencies, which is how a deploy job failed on a clean checkout while every local build
    // passed (MEM-2026-09-11-19, and the same note in `nightly-visual.yml`).
    expect(dev, '`pnpm dev` does not build anything before starting the server').toContain(
      'turbo run build',
    );

    const filter = /--filter=(?:'([^']+)'|"([^"]+)"|(\S+))/.exec(dev);
    expect(filter, '`pnpm dev` runs turbo with no filter').not.toBeNull();
    const selector = filter?.[1] ?? filter?.[2] ?? filter?.[3] ?? '';

    // Asked of turbo rather than matched as a string: the point is which packages the filter
    // actually selects, and a selector like `@marketplace/web^...` names none of them literally.
    const dry = execFileSync(
      'pnpm',
      ['turbo', 'run', 'build', `--filter=${selector}`, '--dry=json'],
      {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const selected = new Set(
      (JSON.parse(dry) as { tasks?: { package: string }[] }).tasks?.map((t) => t.package) ?? [],
    );

    for (const name of builtDependencies()) {
      expect([...selected], `\`pnpm dev\` starts the web app without building ${name}`).toContain(
        name,
      );
    }
  });
});
