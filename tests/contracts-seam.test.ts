// @vitest-environment node
//
// `W1-T01`. The envelope is the seam: only `agent-contracts` writes it, and both apps build
// against one definition (`agents/policies/contract-change.md`). A second copy is how that stops
// being true — it does not fail anything, it just quietly drifts until two services disagree about
// what an error looks like.
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.turbo', 'fixtures'].includes(entry.name)) continue;
    const child = join(dir, entry.name);
    if (statSync(child).isDirectory()) sourceFiles(child, found);
    else if (/\.tsx?$/.test(entry.name)) found.push(child);
  }
  return found;
}

describe('AC10 — the envelope has exactly one definition, and it is the seam', () => {
  it('has removed the pre-freeze copy in apps/api', () => {
    expect(
      existsSync(join(root, 'apps/api/src/lib/errors.ts')),
      'the W0-T03 proposal is back; the canonical registry is packages/contracts',
    ).toBe(false);
  });

  it('declares ERROR_CODES in one file only', () => {
    const declaring = sourceFiles(join(root, 'apps'))
      .concat(sourceFiles(join(root, 'packages')))
      .filter((file) => /export const ERROR_CODES\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file));

    expect(declaring).toEqual(['packages/contracts/src/errors.ts']);
  });

  it('has apps/api depend on the contracts package rather than reach across the repo', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies?.['@marketplace/contracts']).toBe('workspace:*');
  });
});
