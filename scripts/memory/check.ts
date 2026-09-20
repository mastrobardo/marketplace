/**
 * `memory:check` — an advisory reader for `memory/repo/**` and `memory/slices/**`.
 *
 * **This is deliberately not a gate, and must not become one.** Operator, 2026-09-20:
 *
 * > i dont care if a memory is not well formed, better to have a format, but should not be a
 * > blocker. And ABSOLUTELY not a CI gate. We are still in the realm of a personal project nobody
 * > uses. In a more corporative setup, i would agree this is a conditio sine qua non.
 *
 * It lives here rather than in `scripts/gates/` for exactly that reason: anything in that directory
 * is one line away from `run.ts --all`, and the decision to keep this advisory would then be undone
 * by a tidy-up rather than by anybody choosing it. The exit code is **always 0** unless `--strict`
 * is passed explicitly, which nothing in CI does.
 *
 * Why it can afford to be advisory: 189 of 196 entries already carried `status` before this script
 * existed, with nothing enforcing it. That is the measured decay rate of this particular format —
 * slow, and cheap to repair, because a missing field loses no information that the entry's own
 * prose does not still carry. Contrast `MEM-2026-09-11-04`, where the decaying section was verbatim
 * prompts, which **cannot** be reconstructed afterwards. The cost of decay is what decides whether
 * a convention needs teeth, not the fact that it is a convention.
 *
 * Run: `pnpm memory:check` · `pnpm memory:check --strict` (exits 1 on problems)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DIRS = ['memory/repo', 'memory/slices'];

/** Every entry carries these. All 196 existing entries do, bar the `status` drift this found. */
const REQUIRED = ['id', 'scope', 'fact', 'why', 'apply', 'evidence', 'status'] as const;

const ID = /^MEM-\d{4}-\d{2}-\d{2}-\d+$/;

interface Entry {
  readonly file: string;
  readonly title: string;
  readonly id: string | null;
  readonly missing: readonly string[];
}

/**
 * Fenced blocks are stripped before parsing, and that is not a detail: every slice file embeds the
 * entry format as a ```markdown example, so a parser that reads them finds an entry whose id is
 * literally `MEM-<date>-<n>` in nine files at once.
 */
function stripFences(markdown: string): string {
  return markdown.replace(/^```[\s\S]*?^```/gm, '');
}

function entriesIn(file: string, markdown: string): Entry[] {
  return stripFences(markdown)
    .split(/\n### /)
    .slice(1)
    .map((block) => {
      const id = /- \*\*id\*\*: (\S+)/.exec(block)?.[1] ?? null;
      return {
        file,
        title: block.split('\n')[0] ?? '',
        id,
        missing: REQUIRED.filter((field) => !block.includes(`- **${field}**:`)),
      };
    });
}

function read(): Entry[] {
  const found: Entry[] = [];
  for (const dir of DIRS) {
    for (const name of readdirSync(join(ROOT, dir))) {
      // `_TEMPLATE.md` is the shape, not an entry.
      if (!name.endsWith('.md') || name.startsWith('_')) continue;
      found.push(...entriesIn(`${dir}/${name}`, readFileSync(join(ROOT, dir, name), 'utf8')));
    }
  }
  return found;
}

function main(): void {
  const entries = read();
  const problems: string[] = [];

  for (const entry of entries) {
    if (entry.missing.length > 0) {
      problems.push(`${entry.file}: "${entry.title}" is missing ${entry.missing.join(', ')}`);
    }
    if (entry.id !== null && !ID.test(entry.id)) {
      problems.push(
        `${entry.file}: "${entry.title}" has id "${entry.id}" — expected MEM-YYYY-MM-DD-N`,
      );
    }
  }

  // A collision is two entries with one id **in the same file**. The same id in two files is
  // almost always promotion — a slice fact lifted into `repo/` keeping its id, which is the trail
  // the doctrine asks for — so it is reported separately and is not a problem.
  const byFile = new Map<string, Map<string, number>>();
  const across = new Map<string, Set<string>>();
  for (const { file, id } of entries) {
    if (id === null) continue;
    const seen = byFile.get(file) ?? new Map<string, number>();
    seen.set(id, (seen.get(id) ?? 0) + 1);
    byFile.set(file, seen);
    across.set(id, (across.get(id) ?? new Set<string>()).add(file));
  }
  for (const [file, seen] of byFile) {
    for (const [id, count] of seen) {
      if (count > 1) problems.push(`${file}: id ${id} used ${String(count)} times in one file`);
    }
  }
  const promoted = [...across].filter(([, files]) => files.size > 1).length;

  console.log(
    `memory: ${String(entries.length)} entries across ${String(DIRS.length)} directories`,
  );
  if (promoted > 0) {
    console.log(
      `  ${String(promoted)} ids appear in more than one file (promotion — not a problem)`,
    );
  }

  if (problems.length === 0) {
    console.log('  no problems');
    return;
  }

  console.log(`\n  ${String(problems.length)} problem(s):`);
  for (const problem of problems) console.log(`    ${problem}`);
  console.log('\nAdvisory. This is not a gate — see the header of scripts/memory/check.ts.');

  if (process.argv.includes('--strict')) process.exitCode = 1;
}

main();
