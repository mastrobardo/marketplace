#!/usr/bin/env node --experimental-strip-types
/**
 * Regenerates the index block of `memory/LONG_TERM.md` from the records under `memory/`.
 *
 *   node --experimental-strip-types scripts/render-memory.ts          # write
 *   node --experimental-strip-types scripts/render-memory.ts --check  # exit 1 if stale
 *
 * `W0-T23`: memory is one record per file so a new record is a new file and two agents cannot
 * conflict. That only holds if the *index* is generated too — an index everyone appends to is the
 * same collision, moved. So this file is never hand-edited, and a merge conflict in it is resolved
 * by re-running this script (see `.gitattributes`), never by picking sides.
 *
 * Only the block between the markers is touched. The prose around it is hand-written and stays.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MEMORY = join(ROOT, 'memory');
const INDEX = join(MEMORY, 'LONG_TERM.md');
const BEGIN = '<!-- BEGIN GENERATED — scripts/render-memory.ts. Do not hand-edit. -->';
const END = '<!-- END GENERATED -->';

type Record_ = {
  id: string;
  kind: string;
  scope: string;
  status: string;
  title: string;
  fact: string;
  path: string;
};

/** Frontmatter here is single-line scalars written from a template, so a regex is honest. */
function parse(file: string): Record_ {
  const source = readFileSync(file, 'utf8');
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`${relative(ROOT, file)}: no frontmatter block`);

  const fields = new Map<string, string>();
  for (const line of (match[1] as string).split('\n')) {
    const field = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!field) throw new Error(`${relative(ROOT, file)}: cannot parse frontmatter: ${line}`);
    fields.set(field[1] as string, (field[2] as string).trim());
  }

  const body = match[2] as string;
  const title = /^#\s+(.+)$/m.exec(body)?.[1];
  if (!title) throw new Error(`${relative(ROOT, file)}: no '# title' heading`);

  // First sentence of the fact, as the one-line hook. The whole record is one click away.
  const fact = /\*\*Fact\.\*\*\s+([\s\S]*?)(?=\n\n|\*\*Why\.\*\*|$)/.exec(body)?.[1] ?? '';
  const firstSentence = /^([\s\S]*?[.?!])(\s|$)/.exec(fact.replace(/\s+/g, ' ').trim())?.[1];

  return {
    id: fields.get('id') ?? '',
    kind: fields.get('kind') ?? '',
    scope: fields.get('scope') ?? '',
    status: fields.get('status') ?? '',
    title: title.trim(),
    fact: (firstSentence ?? fact.replace(/\s+/g, ' ').trim()).trim(),
    path: relative(MEMORY, file),
  };
}

function collect(directory: string): Record_[] {
  const found: Record_[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const child = join(directory, entry);
    if (statSync(child).isDirectory()) found.push(...collect(child));
    else if (entry.endsWith('.md') && !entry.startsWith('_')) found.push(parse(child));
  }
  return found;
}

const GROUPS: { heading: string; directory: string }[] = [
  {
    heading: 'Decisions — non-obvious constraints and why they exist',
    directory: 'repo/decisions',
  },
  {
    heading: 'Conventions — how we do things beyond what lint enforces',
    directory: 'repo/conventions',
  },
  { heading: 'Gotchas — traps found the hard way, with evidence', directory: 'repo/gotchas' },
  { heading: 'Per-slice', directory: 'slices' },
];

/**
 * Only the record directories, never `memory/` as a whole: `sessions/` and `glossary.md` are not
 * records and parsing them would fail on frontmatter they were never meant to have.
 */
function collectAll(): Record_[] {
  return GROUPS.flatMap((group) => collect(join(MEMORY, group.directory)));
}

function render(): string {
  const lines: string[] = [BEGIN, ''];
  const superseded: Record_[] = [];

  for (const group of GROUPS) {
    const records = collect(join(MEMORY, group.directory));
    const active = records.filter((record) => record.status === 'active');
    superseded.push(...records.filter((record) => record.status !== 'active'));

    lines.push(`### ${group.heading}`);
    if (active.length === 0) lines.push('', '_No records yet._', '');
    else {
      lines.push('');
      for (const record of active.sort((a, b) => a.id.localeCompare(b.id))) {
        lines.push(`- [${record.title}](${record.path}) — ${record.fact}`);
      }
      lines.push('');
    }
  }

  // Supersede, never delete: a replaced record keeps its file and stays readable, because the
  // reasoning trail is the point. It is listed apart so nobody acts on it by accident.
  lines.push('### Superseded');
  if (superseded.length === 0) lines.push('', '_None._', '');
  else {
    lines.push('');
    for (const record of superseded.sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`- [${record.title}](${record.path}) — ${record.status}`);
    }
    lines.push('');
  }

  lines.push(`_${collectAll().length} records. Generated — run \`pnpm memory:render\`._`);
  lines.push(END);
  return lines.join('\n');
}

const current = readFileSync(INDEX, 'utf8');
const begin = current.indexOf(BEGIN);
const end = current.indexOf(END);
if (begin === -1 || end === -1) {
  console.error(
    `memory/LONG_TERM.md is missing its generated-block markers:\n  ${BEGIN}\n  ${END}`,
  );
  process.exit(2);
}

const updated = current.slice(0, begin) + render() + current.slice(end + END.length);

if (process.argv.includes('--check')) {
  if (updated === current) process.exit(0);
  console.error(
    'memory/LONG_TERM.md is stale — it does not match the records under memory/.\n' +
      '  fix: pnpm memory:render\n' +
      '  (never hand-edit the generated block; it is a function of the record files)',
  );
  process.exit(1);
}

writeFileSync(INDEX, updated);
console.log(`memory/LONG_TERM.md rendered from ${collectAll().length} records.`);
