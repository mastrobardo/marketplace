import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SUBPATHS = ['./eslint', './prettier', './vitest', './tsconfig/base.json'] as const;

/** Dual-package export: each condition carries its own declarations, so `require` gets `.d.cts`. */
type ExportEntry = Record<'import' | 'require', { types: string; default: string }>;

describe('AC3 — apps resolve the shared config through a workspace link', () => {
  for (const app of ['apps/api', 'apps/web']) {
    it(`resolves @marketplace/config from ${app} to packages/config`, () => {
      const require = createRequire(join(root, app, 'package.json'));
      const resolved = require.resolve('@marketplace/config/prettier');
      // pnpm resolves the workspace symlink to its realpath. A hoisted copy would instead land
      // under a node_modules directory, so this asserts the link and not just "it resolved".
      expect(resolved.startsWith(join(root, 'packages/config') + '/')).toBe(true);
      expect(resolved).not.toContain('node_modules');
    });
  }
});

describe('AC9 — every documented subpath is exported and typed', () => {
  const pkg = () =>
    JSON.parse(readFileSync(join(root, 'packages/config/package.json'), 'utf8')) as {
      exports: Record<string, ExportEntry | string>;
    };

  for (const subpath of SUBPATHS) {
    it(`exports ${subpath}`, () => {
      expect(Object.keys(pkg().exports)).toContain(subpath);
    });
  }

  for (const subpath of SUBPATHS.filter((s) => !s.endsWith('.json'))) {
    it(`ships built ESM, CJS and declarations for ${subpath}`, () => {
      const entry = pkg().exports[subpath];
      expect(typeof entry, `${subpath} must declare conditions`).toBe('object');
      for (const condition of ['import', 'require'] as const) {
        const target = (entry as ExportEntry)[condition];
        expect(target, `${subpath} has no "${condition}"`).toBeDefined();
        for (const file of [target.types, target.default]) {
          expect(existsSync(join(root, 'packages/config', file)), `${file} is not built`).toBe(
            true,
          );
        }
      }
    });
  }
});

describe('AC6/AC7 — the shared ESLint config catches real problems and defers formatting', () => {
  const lint = async (code: string) => {
    const { ESLint } = await import('eslint');
    const { createEslintConfig } = (await import('@marketplace/config/eslint')) as {
      createEslintConfig: (o?: object) => unknown[];
    };
    const eslint = new ESLint({
      overrideConfigFile: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      overrideConfig: createEslintConfig() as any,
    });
    const [result] = await eslint.lintText(code, { filePath: join(root, 'sample.ts') });
    return result!.messages;
  };

  it('reports an explicit any', async () => {
    const messages = await lint('export const parse = (input: any): string => String(input);\n');
    expect(messages.map((m) => m.ruleId)).toContain('@typescript-eslint/no-explicit-any');
  });

  it('reports an unused variable', async () => {
    const messages = await lint('const unused = 1;\nexport const used = 2;\n');
    expect(messages.map((m) => m.ruleId)).toContain('@typescript-eslint/no-unused-vars');
  });

  it('reports nothing about formatting Prettier owns', async () => {
    const messages = await lint("export const a = {b:1,   c:'2'}\n");
    expect(messages.map((m) => m.ruleId)).toEqual([]);
  });
});

describe('AC8 — the shared Prettier config is loadable and idempotent', () => {
  it('exports a config object', async () => {
    const config = (await import('@marketplace/config/prettier')).default;
    expect(config).toMatchObject({ singleQuote: expect.any(Boolean) });
  });

  it('formats idempotently', async () => {
    const prettier = await import('prettier');
    const config = (await import('@marketplace/config/prettier')).default;
    const options = { ...(config as object), parser: 'typescript' as const };
    const once = await prettier.format("export const a = {b:1,   c:'2'}\n", options);
    const twice = await prettier.format(once, options);
    expect(twice).toBe(once);
  });
});

describe('AC10 — the shared Vitest preset is usable', () => {
  it('exports a base config with the workspace defaults', async () => {
    const { baseVitestConfig } = (await import('@marketplace/config/vitest')) as {
      baseVitestConfig: { test: { environment: string } };
    };
    expect(baseVitestConfig.test.environment).toBe('node');
  });
});
