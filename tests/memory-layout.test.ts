// @vitest-environment node
//
// `W0-T23`: memory is one record per file so that a new record is a *new file*. Git cannot
// conflict on two new files, which is the whole point — `AGENTS.md` L8 asks every agent to promote
// durable learnings on every task, and while that meant appending to four shared files it was a
// queue, not a practice.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const memory = join(root, 'memory');

// `glossary.md` is deliberately not here. It is a table of one-line terms, not records: coining a
// term happens once per domain concept, not once per task, and eleven three-line files would be a
// worse artifact than the collision they avoid. If it ever starts colliding, it gets this
// treatment too — see the spec's risks.
const KINDS = ['gotchas', 'conventions', 'decisions'] as const;
const KIND_OF_DIRECTORY: Record<(typeof KINDS)[number], string> = {
  gotchas: 'gotcha',
  conventions: 'convention',
  decisions: 'decision',
};

type Record_ = {
  path: string; // repo-relative, for failure messages
  file: string; // basename without extension
  frontmatter: Map<string, string>;
  body: string;
};

const ID = /^MEM-\d{4}-\d{2}-\d{2}-\d{2}$/;

function parse(absolute: string, relative: string): Record_ {
  const source = readFileSync(absolute, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`${relative} has no frontmatter block`);
  const frontmatter = new Map<string, string>();
  for (const line of (match[1] as string).split('\n')) {
    const field = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!field) throw new Error(`${relative}: cannot parse frontmatter line: ${line}`);
    frontmatter.set(field[1] as string, (field[2] as string).trim());
  }
  return {
    path: relative,
    file: absolute.split('/').pop()!.replace(/\.md$/, ''),
    frontmatter,
    body: match[2] as string,
  };
}

function collect(): Record_[] {
  const found: Record_[] = [];
  const walk = (absolute: string, relative: string): void => {
    for (const entry of readdirSync(absolute).sort()) {
      const child = join(absolute, entry);
      const childRelative = `${relative}/${entry}`;
      if (statSync(child).isDirectory()) walk(child, childRelative);
      else if (entry.endsWith('.md') && !entry.startsWith('_'))
        found.push(parse(child, childRelative));
    }
  };
  for (const kind of KINDS) walk(join(memory, 'repo', kind), `memory/repo/${kind}`);
  walk(join(memory, 'slices'), 'memory/slices');
  return found;
}

describe('AC3 — a memory record is one file, and the file is its own id', () => {
  const records = collect();

  it('found the migrated records', () => {
    // AC8: nothing may be lost in the migration. 41 is what the four appended files held —
    // 15 gotchas, 7 conventions, 4 decisions and 15 for agent-devops.
    expect(records.length).toBeGreaterThanOrEqual(41);
  });

  it.each(collect().map((r) => [r.path, r] as const))('%s is well-formed', (_path, record) => {
    const id = record.frontmatter.get('id');
    expect(id, `${record.path}: no id`).toMatch(ID);
    expect(id, `${record.path}: the id must be the filename, or the two drift`).toBe(record.file);

    const status = record.frontmatter.get('status');
    expect(status, `${record.path}: status must be 'active' or 'superseded-by MEM-…'`).toMatch(
      /^(active|superseded-by MEM-\d{4}-\d{2}-\d{2}-\d{2})$/,
    );

    // Slice codes, not agent names — `agents/policies/memory.md` fixed the vocabulary as
    // `repo | slice:S9 | flow:auctions`, and scope is orthogonal to which directory a record
    // lives in: a repo-wide gotcha can still be scoped to one slice.
    expect(record.frontmatter.get('scope'), `${record.path}: bad scope`).toMatch(
      /^(repo|slice:S\d+|flow:[a-z-]+)$/,
    );

    // A record with no evidence is speculation, and `memory/repo/gotchas` says so explicitly.
    expect(record.frontmatter.get('evidence')?.length ?? 0).toBeGreaterThan(0);

    expect(record.body, `${record.path}: no '# title' heading`).toMatch(/^#\s+\S/m);
    for (const section of ['Fact', 'Why', 'Apply']) {
      expect(record.body, `${record.path}: no **${section}.** section`).toContain(
        `**${section}.**`,
      );
    }
  });

  it('gives every record a kind matching the directory it lives in', () => {
    for (const record of records) {
      const directory = record.path.split('/').at(-2)!;
      const expected = record.path.startsWith('memory/slices/')
        ? undefined
        : KIND_OF_DIRECTORY[directory as (typeof KINDS)[number]];
      if (expected) expect(record.frontmatter.get('kind'), record.path).toBe(expected);
    }
  });

  it('has no two records sharing an id', () => {
    // Ids are global, not per-directory. `superseded-by MEM-…` and every citation in a run record
    // resolve by id alone, so two records answering to one id make both unresolvable. The repo and
    // slice sequences were numbered independently on 2026-09-09 and collided twice; the flat files
    // could not have shown it.
    const byId = new Map<string, string[]>();
    for (const record of records) {
      const id = record.frontmatter.get('id') ?? '(none)';
      byId.set(id, [...(byId.get(id) ?? []), record.path]);
    }
    const shared = [...byId].filter(([, paths]) => paths.length > 1);
    expect(shared.map(([id, paths]) => `${id}: ${paths.join(', ')}`)).toEqual([]);
  });

  it('points every superseded-by at a record that exists', () => {
    const ids = new Set(records.map((record) => record.frontmatter.get('id')));
    for (const record of records) {
      const status = record.frontmatter.get('status') ?? '';
      if (!status.startsWith('superseded-by ')) continue;
      expect(ids, `${record.path} is superseded by a record that does not exist`).toContain(
        status.slice('superseded-by '.length),
      );
    }
  });

  it('no longer has the appended files everyone used to collide on', () => {
    for (const kind of KINDS) {
      const stale = join(memory, 'repo', `${kind.replace(/s$/, '')}s.md`);
      expect(
        readdirSync(join(memory, 'repo')).includes(`${kind}.md`),
        `${stale} is back — a shared appended file is the thing W0-T23 removed`,
      ).toBe(false);
    }
  });
});

/**
 * AC6. `memory/LONG_TERM.md` has to stay one place to read everything (AC5) *and* stop being a file
 * every agent appends to (AC1). Generating it is the only way to have both — and a generated file
 * is only true if something fails when it goes stale.
 */
describe('AC6 — the index is generated, and CI notices when it is stale', () => {
  it('matches a fresh render', () => {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/render-memory.ts', '--check'],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status, `${result.stderr}${result.stdout}`).toBe(0);
  });

  it('reports stale rather than silently rewriting when a record changes', () => {
    const record = join(memory, 'repo/gotchas');
    const victim = join(
      record,
      readdirSync(record).find((f) => f.startsWith('MEM-'))!,
    );
    const original = readFileSync(victim, 'utf8');
    try {
      writeFileSync(victim, original.replace(/^# .+$/m, '# A title the index has never seen'));
      const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', 'scripts/render-memory.ts', '--check'],
        { cwd: root, encoding: 'utf8' },
      );
      expect(result.status, 'a stale index passed --check').toBe(1);
      expect(result.stderr).toContain('pnpm memory:render');
    } finally {
      writeFileSync(victim, original);
    }
  });
});
