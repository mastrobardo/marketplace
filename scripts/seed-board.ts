#!/usr/bin/env tsx
/**
 * Turns TODO.md into a GitHub board: labels, milestones and one issue per
 * OPS-xx (manual setup), Wn-Tnn (work task) and BD-xx (business decision).
 *
 *   node --experimental-strip-types scripts/seed-board.ts --dry-run
 *   node --experimental-strip-types scripts/seed-board.ts --repo <owner>/<name>
 *
 * Idempotent: an issue whose title starts with the same id is skipped.
 * Requires `gh` authenticated as the PERSONAL account — see docs/board/IDENTITY.md.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const repo = args[args.indexOf('--repo') + 1];
if (!dryRun && !args.includes('--repo')) {
  console.error('refusing to run without --repo <owner>/<name> (or --dry-run)');
  process.exit(1);
}

const md = readFileSync('TODO.md', 'utf8');
const sh = (cmd: string, a: string[]) => execFileSync(cmd, a, { encoding: 'utf8' });

type Issue = { id: string; title: string; body: string; labels: string[]; milestone?: string };

/** Strip markdown emphasis/backticks and truncate on a word boundary for a readable issue title. */
const trim = (t: string, max = 80) => {
  const clean = t.replace(/\*\*/g, '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
};

const SLICE_OF: Record<string, [string, string]> = {
  W0: ['S0', 'agent-devops'],
  W1: ['S1', 'agent-contracts'],
  W2: ['S2', 'agent-identity'],
  W3: ['S3', 'agent-providers'],
  W4: ['S6', 'agent-jobs'],
  W5: ['S9', 'agent-money'],
  W6: ['S7', 'agent-auctions'],
  W7: ['S8', 'agent-emergency'],
  W8: ['S4', 'agent-trust'],
  W9: ['S12', 'agent-admin'],
  W10: ['S11', 'agent-qa'],
  W11: ['S13', 'agent-devops'],
  W12: ['S10', 'agent-ui'],
};
const MILESTONE_OF: Record<string, string> = {
  W0: 'M0 Walking skeleton',
  W1: 'M1 Identity',
  W2: 'M1 Identity',
  W3: 'M2 Discovery',
  W4: 'M4 Presupuestos',
  W5: 'M3 First euro',
  W6: 'M6 Auctions',
  W7: 'M7 Emergency',
  W8: 'M5 Trust',
  W9: 'M9 Beta-ready',
  W10: 'M9 Beta-ready',
  W11: 'M10 Agent autonomy',
  W12: 'M11 Public storefront',
};

/**
 * A handful of ids belong to a milestone their workstream does not imply: the agent-system setup
 * tickets are `OPS`, which is otherwise blanket-M0, and `W0-T26` is a W0 task that exists only
 * because `M10` cannot start while the `database` gate fails open.
 */
const MILESTONE_OVERRIDE: Record<string, string> = {
  'OPS-19': 'M10 Agent autonomy',
  'OPS-20': 'M10 Agent autonomy',
  'OPS-21': 'M10 Agent autonomy',
  'OPS-22': 'M10 Agent autonomy',
  'W0-T26': 'M10 Agent autonomy',
};

const issues: Issue[] = [];

// --- OPS rows: | `OPS-01` | operation | proof of done | unblocks |
for (const m of md.matchAll(/^\|\s*`(OPS-\d+)`\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/gm)) {
  const [, id, op, proof, unblocks] = m;
  issues.push({
    id,
    title: `${id} — ${trim(op)}`,
    body:
      `**Manual setup operation — human only.** Agents must never attempt this.\n\n` +
      `**Operation:** ${op}\n\n**Proof of done:** ${proof}\n\n**Unblocks:** ${unblocks}\n\n` +
      `Identity rule: \`docs/board/IDENTITY.md\` — personal account only.\n` +
      `Context: \`TODO.md\` §6 OPS table.`,
    labels: ['type:ops', 'exec:H', 'priority:early-deploy'],
    milestone: MILESTONE_OVERRIDE[id] ?? 'M0 Walking skeleton',
  });
}

// --- BD rows: | `BD-01` | decision | blocks | notes |
for (const m of md.matchAll(/^\|\s*`(BD-\d+)`\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/gm)) {
  const [, id, decision, blocks, notes] = m;
  issues.push({
    id,
    title: `${id} — ${decision.replace(/\*\*/g, '').slice(0, 90)}`,
    body:
      `**Business decision — owner: repo owner. Do not let an agent invent this.**\n\n` +
      `**Decision:** ${decision}\n\n**Blocks:** ${blocks}\n\n**Notes:** ${notes}\n\n` +
      `Rule: build the mechanism, read the value from config, ship nothing with an invented number.\n` +
      `Context: \`TODO.md\` §10.1.`,
    labels: ['decision:business', 'blocked:needs-decision'],
  });
}

// --- task lines: - `W0-T01` `[A]` `[B]` text
for (const m of md.matchAll(/^- `(W(\d+)-T\d+)`((?:\s*`\[[HMAB]\]`)+)\s*(.+)$/gm)) {
  const [, id, wnum, labelBlob, text] = m;
  const [slice, agent] = SLICE_OF[`W${wnum}`] ?? ['S?', 'unassigned'];
  const exec = [...labelBlob.matchAll(/\[([HMAB])\]/g)].map((x) => x[1]);
  const labels = [
    'type:task',
    `slice:${slice}`,
    `agent:${agent}`,
    ...exec.filter((e) => e !== 'B').map((e) => `exec:${e}`),
  ];
  if (exec.includes('B')) labels.push('decision:business', 'blocked:needs-decision');
  if (wnum === '0') labels.push('priority:early-deploy');
  const clean = text
    .replace(/\*\((human:.*?)\)\*/g, '')
    .replace(/\*\*/g, '')
    .trim();
  issues.push({
    id,
    title: `${id} — ${trim(clean)}`,
    body:
      `${text}\n\n---\n**Owner:** \`${agent}\` (slice ${slice})\n` +
      `**Pipeline:** spec → contract freeze → TDD red → green → refactor → review (\`agents/AGENTS.md\`)\n` +
      `**Branch:** \`${id}-<slug>\` — must carry \`docs/specs/…\` and \`….run.md\` (gate \`spec-present\`)\n` +
      (exec.includes('B')
        ? `\n⚠️ **Blocked on a business decision** — see \`TODO.md\` §10.1. Build the mechanism, do not invent the value.\n`
        : '') +
      `\nContext: \`TODO.md\` §6.`,
    labels,
    milestone: MILESTONE_OVERRIDE[id] ?? MILESTONE_OF[`W${wnum}`],
  });
}

const LABELS: [string, string, string][] = [
  ['type:ops', 'B60205', 'Manual setup, human only'],
  ['type:task', '0E8A16', 'Implementation task'],
  ['decision:business', 'D93F0B', 'Needs a business decision from the owner'],
  ['blocked:needs-decision', 'E99695', 'Cannot ship until a decision is made'],
  ['priority:early-deploy', 'FBCA04', 'On the path to first deployment'],
  ['exec:H', '5319E7', 'Human only'],
  ['exec:M', '1D76DB', 'Mixed: agent + human input'],
  ['exec:A', 'C2E0C6', 'Agent only (still needs PR approval)'],
  ...Object.values(SLICE_OF).map(
    ([s]) => [`slice:${s}`, 'BFD4F2', `Slice ${s}`] as [string, string, string],
  ),
  ...Object.values(SLICE_OF).map(
    ([, a]) => [`agent:${a}`, 'D4C5F9', a] as [string, string, string],
  ),
];
const MILESTONES = [...new Set(Object.values(MILESTONE_OF))].concat('M0 Walking skeleton');

if (dryRun) {
  const by = (p: string) => issues.filter((i) => i.id.startsWith(p)).length;
  console.log(
    `labels: ${new Set(LABELS.map((l) => l[0])).size}, milestones: ${new Set(MILESTONES).size}`,
  );
  console.log(
    `issues: ${issues.length}  (OPS ${by('OPS')}, BD ${by('BD')}, tasks ${issues.length - by('OPS') - by('BD')})`,
  );
  console.log(
    `business-blocked: ${issues.filter((i) => i.labels.includes('decision:business')).length}`,
  );
  console.log('\nfirst 8:');
  for (const i of issues.slice(0, 8))
    console.log(`  ${i.title}\n    [${i.labels.join(' ')}] ${i.milestone ?? ''}`);
  process.exit(0);
}

const who = sh('gh', ['api', 'user', '--jq', '.login']).trim();
console.log(`gh identity: ${who}`);
if (/iagl|parserdigital/i.test(who)) {
  console.error('✖ refusing: gh is authenticated as a work account. See docs/board/IDENTITY.md');
  process.exit(1);
}

for (const [name, color, desc] of new Map(LABELS.map((l) => [l[0], l])).values()) {
  try {
    sh('gh', [
      'label',
      'create',
      name,
      '--repo',
      repo,
      '--color',
      color,
      '--description',
      desc,
      '--force',
    ]);
  } catch {
    console.warn(`label ${name}: skipped`);
  }
}
for (const title of new Set(MILESTONES)) {
  try {
    sh('gh', ['api', `repos/${repo}/milestones`, '-f', `title=${title}`]);
  } catch {
    /* already exists */
  }
}

const existing = new Set(
  JSON.parse(
    sh('gh', [
      'issue',
      'list',
      '--repo',
      repo,
      '--state',
      'all',
      '--limit',
      '500',
      '--json',
      'title',
    ]),
  ).map((i: { title: string }) => i.title.split(' ')[0]),
);

let created = 0;
for (const i of issues) {
  if (existing.has(i.id)) {
    console.log(`= ${i.id} exists`);
    continue;
  }
  const a = ['issue', 'create', '--repo', repo, '--title', i.title, '--body', i.body];
  for (const l of i.labels) a.push('--label', l);
  if (i.milestone) a.push('--milestone', i.milestone);
  try {
    sh('gh', a);
    created++;
    console.log(`+ ${i.title}`);
  } catch (e) {
    console.error(`✖ ${i.id}: ${(e as Error).message.split('\n')[0]}`);
  }
}
console.log(`\ncreated ${created} issue(s) in ${repo}`);
