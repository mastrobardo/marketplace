#!/usr/bin/env tsx
/**
 * Rewrites board issues into user-story form from docs/board/stories.ts,
 * then creates one epic per group and links the issues under it.
 *
 *   node --experimental-strip-types scripts/update-issues.ts --repo <owner>/<name> [--dry-run]
 *
 * Human-readable content goes at the top of the body; the agent machinery goes
 * in a collapsed section underneath.
 */
import { execFileSync } from 'node:child_process';
import { stories, type Story } from '../docs/board/stories.ts';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const repo = args[args.indexOf('--repo') + 1];
if (!repo || repo.startsWith('--')) { console.error('need --repo <owner>/<name>'); process.exit(1); }

const gh = (a: string[], input?: string) =>
  execFileSync('gh', a, { encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024 });

const who = gh(['api', 'user', '--jq', '.login']).trim();
if (/iagl|parserdigital/i.test(who)) { console.error(`✖ refusing: gh identity is ${who}`); process.exit(1); }

const SLICE: Record<string, [string, string]> = {
  W0: ['S0', 'agent-devops'], W1: ['S1', 'agent-contracts'], W2: ['S2', 'agent-identity'],
  W3: ['S3', 'agent-providers'], W4: ['S6', 'agent-jobs'], W5: ['S9', 'agent-money'],
  W6: ['S7', 'agent-auctions'], W7: ['S8', 'agent-emergency'], W8: ['S4', 'agent-trust'],
  W9: ['S12', 'agent-admin'], W10: ['S11', 'agent-qa'],
};

const EPICS: [string, string, string][] = [
  ['OPS', 'Manual service setup', 'Accounts, credentials and dashboards that only a human can create. Every one of these blocks something; each has a proof of done so nobody assumes it happened.'],
  ['BD', 'Decisions waiting on you', 'Product and business choices an agent must never invent. The mechanism gets built and tested either way — the value comes from here. BD-01 (escrow) unblocks the most.'],
  ['W0', 'Platform foundation', 'Everything needed before a single feature can be built: repo, local stack, CI, per-PR environments, flags, secrets, encryption. This is the path to a first deployment.'],
  ['W1', 'Shared contracts and domain foundation', 'The seam every other slice builds against: error shapes, generated API client, core schema, money handling, state machines.'],
  ['W2', 'Identity and access', 'Signing up, staying signed in, and enforcing what each kind of user is allowed to do.'],
  ['W3', 'Providers and discovery', 'Provider profiles and portfolios, and the search that puts them in front of a nearby client.'],
  ['W4', 'Jobs and presupuestos', 'Posting a job, receiving quotes, comparing them, and awarding the work.'],
  ['W5', 'Payments and subscriptions', 'Taking money, paying professionals, refunds, disputes, subscriptions and the ledger behind them. Highest risk slice.'],
  ['W6', 'Auctions', 'Competitive bidding with a deadline, closing exactly once and awarding correctly.'],
  ['W7', 'Emergency call-outs', 'Urgent requests broadcast to nearby available professionals, where exactly one wins the job.'],
  ['W8', 'Trust: licences, badges and reviews', 'Verifying credentials, awarding badges that mean something, and keeping reviews honest.'],
  ['W9', 'Back office', 'What an operator needs to run the marketplace day to day, with everything recorded.'],
  ['W10', 'Quality and launch', 'End-to-end journeys, load, accessibility, security and the runbooks needed to launch.'],
];

const groupOf = (id: string) => (id.startsWith('OPS') ? 'OPS' : id.startsWith('BD') ? 'BD' : id.split('-')[0]);

function body(id: string, s: Story): string {
  const g = groupOf(id);
  const [slice, agent] = SLICE[g] ?? ['—', g === 'OPS' ? 'human operator' : 'repo owner'];
  const done = s.ac.map((a) => `- [ ] ${a}`).join('\n');
  const note = s.note ? `\n### Good to know\n${s.note}\n` : '';
  const machinery = g === 'OPS' || g === 'BD'
    ? `Reference: \`TODO.md\` ${g === 'OPS' ? '§6 OPS table' : '§10.1'}\n` +
      (g === 'OPS' ? 'Human only — an agent must never attempt this. Identity rules: `docs/board/IDENTITY.md`.\n' : 'Do not let an agent choose this. Build the mechanism, read the value from config.\n')
    : `Owner: \`${agent}\` (slice ${slice})\n` +
      `Branch: \`${id}-<slug>\` — must carry \`docs/specs/<slice>/<feature>.md\` and \`<feature>.run.md\` (CI gate \`spec-present\`)\n` +
      `Pipeline: spec → contract freeze → failing test → implementation → review (\`agents/AGENTS.md\`)\n` +
      `Reference: \`TODO.md\` §6\n`;

  return `**As a** ${s.role}\n**I want** ${s.want}\n**so that** ${s.so}\n\n### Done when\n${done}\n${note}\n` +
    `<details>\n<summary>Working details</summary>\n\n${machinery}\n</details>\n`;
}

type Row = { number: number; title: string; id: number };
const all: Row[] = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '400', '--json', 'number,title,id']));
const byId = new Map<string, Row>();
for (const r of all) byId.set(r.title.split(' ')[0], r);

let updated = 0, missing: string[] = [];
for (const [id, s] of Object.entries(stories)) {
  const row = byId.get(id);
  if (!row) { missing.push(id); continue; }
  const payload = JSON.stringify({ title: `${id} — ${s.title}`, body: body(id, s) });
  if (dry) { if (updated < 2) console.log(`--- ${id} — ${s.title}\n${body(id, s)}`); updated++; continue; }
  gh(['api', `repos/${repo}/issues/${row.number}`, '-X', 'PATCH', '--input', '-'], payload);
  updated++;
  if (updated % 25 === 0) console.log(`  …${updated}`);
}
console.log(`rewrote ${updated} issue(s)${missing.length ? `, missing: ${missing.join(', ')}` : ''}`);
if (dry) process.exit(0);

// --- epics
const refreshed: Row[] = JSON.parse(gh(['issue', 'list', '--repo', repo, '--state', 'all', '--limit', '400', '--json', 'number,title,id']));
for (const [key, name, blurb] of EPICS) {
  const isTask = (r: Row) => /^(OPS-\d+|BD-\d+|W\d+-T\d+)$/.test(r.title.split(' ')[0]);
  const children = refreshed.filter((r) => isTask(r) && groupOf(r.title.split(' ')[0]) === key);
  const list = children.map((c) => `- [ ] #${c.number}`).join('\n');
  const title = `${key} — ${name}`;
  const epicBody = `${blurb}\n\n**${children.length} issues**\n\n${list}\n`;
  const existing = refreshed.find((r) => r.title === title);
  if (existing) {
    gh(['api', `repos/${repo}/issues/${existing.number}`, '-X', 'PATCH', '--input', '-'],
       JSON.stringify({ body: epicBody }));
    console.log(`= epic ${title} (#${existing.number}) updated, ${children.length} children`);
  } else {
    const out = gh(['issue', 'create', '--repo', repo, '--title', title, '--body', epicBody, '--label', 'type:epic']);
    console.log(`+ epic ${title} — ${children.length} children — ${out.trim()}`);
  }
}
