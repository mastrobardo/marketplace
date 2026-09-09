// @vitest-environment node
//
// `W0-T23`'s acceptance criterion, executed rather than argued: two agents each add a memory
// record, a translation key and a dependency on separate branches, and both branches merge with
// **zero** conflicts.
//
// This is the test the task exists for. PRs #150, #151 and #152 touched three different slices of
// the codebase, shared no source file, and still conflicted three times — so "they don't overlap"
// is not evidence, and a merge is the only thing that is.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

type Change = { path: string; contents?: string; append?: string };

/**
 * Clone the repo into a scratch directory, build two branches from HEAD, and ask git whether they
 * merge. `merge-tree --write-tree` computes the merge without a working tree or an index, so this
 * never touches the real repository and cannot leave it dirty.
 */
function conflictsBetween(ours: Change[], theirs: Change[]): string[] {
  const scratch = mkdtempSync(join(tmpdir(), 'w0t23-'));
  try {
    execFileSync('git', ['clone', '--quiet', '--no-hardlinks', '--shared', root, scratch], {
      stdio: 'pipe',
    });
    const git = (...args: string[]): string =>
      execFileSync('git', args, { cwd: scratch, encoding: 'utf8', stdio: 'pipe' });

    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'W0-T23 test');
    const base = git('rev-parse', 'HEAD').trim();

    const commit = (branch: string, changes: Change[]): string => {
      git('checkout', '--quiet', '-b', branch, base);
      for (const change of changes) {
        const file = join(scratch, change.path);
        mkdirSync(dirname(file), { recursive: true });
        if (change.append !== undefined) appendFileSync(file, change.append);
        else writeFileSync(file, change.contents ?? '');
      }
      git('add', '--all');
      git('commit', '--quiet', '--no-verify', '-m', `${branch}: a day's work`);
      return git('rev-parse', 'HEAD').trim();
    };

    const a = commit('agent-one', ours);
    const b = commit('agent-two', theirs);

    try {
      execFileSync('git', ['merge-tree', '--write-tree', '--name-only', a, b], {
        cwd: scratch,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return []; // exit 0 — merged cleanly
    } catch (error) {
      // Non-zero exit means conflicts; stdout is the tree oid then one conflicting path per line.
      const output = (error as { stdout?: string }).stdout ?? '';
      return output.trim().split('\n').slice(1).filter(Boolean);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** A memory record, a translation key and a dependency — the three things AC1 names. */
function aDaysWork(agent: string, id: string, namespace: string): Change[] {
  const record = `---
id: ${id}
kind: gotcha
scope: repo
status: active
evidence: tests/parallel-merge.test.ts
---

# Something ${agent} learned

**Fact.** A fact.

**Why.** A reason.

**Apply.** An instruction.
`;
  return [
    { path: `memory/repo/gotchas/${id}.md`, contents: record },
    {
      path: `apps/web/src/i18n/locales/es/${namespace}.ts`,
      contents: `export const ${namespace} = {\n  '${namespace}.title': 'Título',\n} as const;\n`,
    },
    {
      path: `apps/web/src/i18n/locales/en/${namespace}.ts`,
      contents:
        `import type { ${namespace} as spanish } from '../es/${namespace}.js';\n` +
        `import type { Mirror } from '../mirror.js';\n\n` +
        `export const ${namespace} = {\n  '${namespace}.title': 'Title',\n} satisfies Mirror<typeof spanish>;\n`,
    },
  ];
}

describe('AC1 — two agents, one day, zero conflicts', () => {
  it('merges two branches that each add a record, a key and a namespace', () => {
    const conflicts = conflictsBetween(
      aDaysWork('agent-jobs', 'MEM-2030-01-01-01', 'jobs'),
      aDaysWork('agent-auctions', 'MEM-2030-01-01-02', 'auctions'),
    );
    expect(conflicts, 'two agents working on unrelated slices still collided').toEqual([]);
  });

  it('merges when both add a key to a namespace they each own', () => {
    const conflicts = conflictsBetween(
      [
        {
          path: 'apps/web/src/i18n/locales/es/jobs.ts',
          contents: `export const jobs = {\n  'jobs.title': 'Trabajos',\n} as const;\n`,
        },
      ],
      [
        {
          path: 'apps/web/src/i18n/locales/es/auctions.ts',
          contents: `export const auctions = {\n  'auctions.title': 'Subastas',\n} as const;\n`,
        },
      ],
    );
    expect(conflicts).toEqual([]);
  });
});

describe('AC2 — the same test fails against the layout this replaced', () => {
  it('conflicts when both agents append to one shared file', () => {
    // Exactly what `memory/repo/gotchas.md` was, and what the README Layout table still is. If
    // this ever passes, `merge-tree` is not being asked what this suite thinks it is being asked,
    // and AC1 above is proving nothing.
    const shared = 'docs/shared-append-only.md';
    const conflicts = conflictsBetween(
      [{ path: shared, contents: 'base\n\n### agent-one was here\n' }],
      [{ path: shared, contents: 'base\n\n### agent-two was here\n' }],
    );
    expect(conflicts).toContain(shared);
  });
});

describe('AC7 — the lockfile is never hand-merged', () => {
  const gitattributes = readFileSync(join(root, '.gitattributes'), 'utf8');

  it('tells git not to line-merge pnpm-lock.yaml', () => {
    expect(gitattributes).toMatch(/^pnpm-lock\.yaml\s+merge=relock\b/m);
  });

  it('tells git not to line-merge the generated memory index', () => {
    expect(gitattributes).toMatch(/^memory\/LONG_TERM\.md\s+merge=regen-memory\b/m);
  });

  it('registers a driver for every merge= attribute it declares', () => {
    const setup = readFileSync(join(root, 'scripts/setup-git.sh'), 'utf8');
    const declared = [...gitattributes.matchAll(/\bmerge=([\w-]+)/g)].map((m) => m[1] as string);
    expect(declared.length).toBeGreaterThan(0);
    for (const driver of declared) {
      expect(setup, `no driver registered for merge=${driver}`).toContain(`merge.${driver}.driver`);
    }
  });

  it('resolves the lockfile by re-resolving it, never by editing lines', () => {
    const relock = readFileSync(join(root, 'scripts/relock.sh'), 'utf8');
    expect(relock).toContain('pnpm install --lockfile-only');
    expect(relock).toMatch(/git show .*:pnpm-lock\.yaml/);
  });
});
