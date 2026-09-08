#!/usr/bin/env tsx
/**
 * Generates .claude/agents/*.md from agents/roles/*.md.
 *
 * agents/roles/ is the single source of truth (see agents/README.md). Claude Code subagent
 * definitions are build output — never hand-edit them.
 *
 *   pnpm tsx scripts/generate-claude-agents.ts           # write
 *   pnpm tsx scripts/generate-claude-agents.ts --check   # CI: exit 1 on drift
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROLES_DIR = 'agents/roles';
const OUT_DIR = '.claude/agents';
const check = process.argv.includes('--check');

type Front = Record<string, string | string[]>;

function parseFrontmatter(src: string): { front: Front; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(src);
  if (!m) throw new Error('missing frontmatter');
  const front: Front = {};
  let key = '';
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) {
      key = kv[1];
      const raw = kv[2].trim();
      if (raw === '') front[key] = [];
      else if (raw.startsWith('[')) {
        front[key] = raw
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      } else front[key] = raw;
    } else if (/^\s+-\s+/.test(line) && Array.isArray(front[key])) {
      (front[key] as string[]).push(line.replace(/^\s+-\s+/, '').trim());
    }
  }
  return { front, body: m[2] };
}

const list = (v: Front[string] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

function render(front: Front, body: string): string {
  const name = front.name as string;
  const owns = list(front.owns);
  const forbidden = list(front.forbidden);
  const skills = list(front.skills);
  const reviewers = list(front.reviewers);

  return `---
name: ${name}
description: ${front.description}
model: ${front.model ?? 'sonnet'}
tools: ${front.tools ?? 'Read, Write, Edit, Bash, Grep, Glob'}
---

<!-- GENERATED FROM ${ROLES_DIR}/${name}.md — DO NOT EDIT. Run scripts/generate-claude-agents.ts -->

## Boot sequence — do this before anything else

1. Read \`agents/AGENTS.md\` in full. It overrides your defaults.
2. Read \`agents/policies/\` (contract-change, escalation, human-boundaries, review-and-merge, memory).
3. Read your charter: \`${ROLES_DIR}/${name}.md\` (revision ${front.revision ?? '1'}).
4. Read \`memory/LONG_TERM.md\` and \`${front.memory}\`.
5. **Check \`memory/sessions/\` for an open file with your task ID** — a previous session may have
   been interrupted. Continue it; do not start over.
6. Find your task in \`TODO.md\` §6 and note its \`[H]\`/\`[M]\`/\`[A]\` label.

## Hard rules
- TDD is mandatory: write the test, watch it fail, paste the failing run into the run record, then
  implement. No red phase = invalid PR.
- Branch \`<TASK-ID>-<slug>\` must carry \`docs/specs/<slice>/<feature>.md\` and \`<feature>.run.md\`.
- Never edit \`packages/contracts/**\` or \`schema.prisma\` unless you are agent-contracts. Propose instead.
- Never touch \`[H]\` work: no secrets, credentials, billing, production, live keys or legal text.
- Never merge or approve your own PR.
- Any human intervention on your branch needs a ledger entry in \`docs/interventions/\`.
- Write session memory as you go; promote durable learnings before merge.

## Your boundaries
**You may write:**
${owns.map((p) => `- \`${p}\``).join('\n') || '- (see charter)'}

**You must not write:**
${forbidden.map((p) => `- \`${p}\``).join('\n') || '- (see charter)'}

**Skills to load:** ${skills.join(', ') || 'test-driven-development'}
**Reviewed by:** ${reviewers.join(', ') || 'see charter'}

---

${body.trim()}
`;
}

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

let drift = 0;
for (const file of readdirSync(ROLES_DIR).filter((f) => f.endsWith('.md') && !f.startsWith('_'))) {
  const { front, body } = parseFrontmatter(readFileSync(join(ROLES_DIR, file), 'utf8'));
  const out = join(OUT_DIR, `${front.name}.md`);
  const next = render(front, body);
  const prev = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (prev === next) continue;
  if (check) {
    console.error(`drift: ${out} is out of date with ${ROLES_DIR}/${file}`);
    drift++;
  } else {
    writeFileSync(out, next);
    console.log(`wrote ${out}`);
  }
}

if (check && drift) {
  console.error(
    `\n${drift} generated agent file(s) out of date. Run: pnpm tsx scripts/generate-claude-agents.ts`,
  );
  process.exit(1);
}
if (check) console.log('.claude/agents is in sync with agents/roles');
