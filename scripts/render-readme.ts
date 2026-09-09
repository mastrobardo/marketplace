#!/usr/bin/env node --experimental-strip-types
/**
 * Regenerates the Layout table in `README.md` from the workspace.
 *
 *   node --experimental-strip-types scripts/render-readme.ts          # write
 *   node --experimental-strip-types scripts/render-readme.ts --check  # exit 1 if stale
 *
 * `W0-T23`: this table has one row per workspace member and every task edited its own row, which
 * is why it conflicted twice in the #150/#151/#152 session. Each member's row now comes from that
 * member's own `package.json` `description` — a file its agent owns and nobody else touches.
 *
 * Note what is *not* done here: `README.md` gets no merge driver. The table looks append-shaped
 * and is a modification, which is precisely the file a keep-both driver got wrong. Only the block
 * between the markers is generated; the rest is prose and a conflict in it is a human's problem.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const README = join(ROOT, 'README.md');
const BEGIN = '<!-- BEGIN GENERATED — scripts/render-readme.ts. Do not hand-edit. -->';
const END = '<!-- END GENERATED -->';

/**
 * Paths that are not workspace members and so have no `package.json` to own their description.
 * These change when the platform grows a new moving part — rarely, and always by one agent.
 */
const INFRASTRUCTURE: [path: string, what: string][] = [
  [
    '`docker-compose.yml`, `docker/`',
    'The local stack: Postgres + PostGIS, mail catcher, object storage.',
  ],
  ['`.github/workflows`', 'The CI gates every pull request passes, and the deploy pipeline.'],
  ['`infra/`', 'Fly app configuration and the API image definition.'],
  ['`scripts/`', 'Deploy guard, CI gates, and the renderers for every generated file.'],
  ['`agents/`', 'Charters, prompt templates and policies for the agents building this.'],
  ['`memory/`', 'What agents know across sessions — one record per file.'],
  ['`docs/adr`, `docs/specs`', 'Decisions, and one spec + run record per feature.'],
];

function members(): [path: string, what: string][] {
  const found: [string, string][] = [];
  for (const group of ['apps', 'packages']) {
    const directory = join(ROOT, group);
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory).sort()) {
      const manifest = join(directory, entry, 'package.json');
      if (!existsSync(manifest)) continue;
      const { description } = JSON.parse(readFileSync(manifest, 'utf8')) as {
        description?: string;
      };
      if (!description) {
        console.error(
          `${group}/${entry}/package.json has no "description".\n` +
            "  It is the source of that member's row in the README Layout table (W0-T23).",
        );
        process.exit(2);
      }
      found.push([`\`${group}/${entry}\``, description]);
    }
  }
  return found;
}

function render(): string {
  const rows = [...members(), ...INFRASTRUCTURE];
  return [
    BEGIN,
    '',
    '| Path | What |',
    '|---|---|',
    ...rows.map(([path, what]) => `| ${path} | ${what} |`),
    '',
    END,
  ].join('\n');
}

const current = readFileSync(README, 'utf8');
const begin = current.indexOf(BEGIN);
const end = current.indexOf(END);
if (begin === -1 || end === -1) {
  console.error(`README.md is missing its generated-block markers:\n  ${BEGIN}\n  ${END}`);
  process.exit(2);
}

const updated = current.slice(0, begin) + render() + current.slice(end + END.length);

if (process.argv.includes('--check')) {
  if (updated === current) process.exit(0);
  console.error(
    'The README Layout table is stale — it does not match the workspace.\n' +
      '  fix: pnpm readme:render\n' +
      '  (a member\'s row comes from its own package.json "description")',
  );
  process.exit(1);
}

writeFileSync(README, updated);
console.log(`README.md Layout table rendered from ${members().length} workspace members.`);
