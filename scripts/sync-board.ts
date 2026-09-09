#!/usr/bin/env tsx
/**
 * Puts every repo issue onto a GitHub Projects v2 board.
 *
 *   node --experimental-strip-types scripts/sync-board.ts --dry-run
 *   node --experimental-strip-types scripts/sync-board.ts --repo <owner>/<name> \
 *     --owner <login> --project <number>
 *
 * Idempotent: an issue already on the board is skipped, and nothing is ever
 * removed. Only board membership is written — Status, Milestone and every other
 * field are left alone, so a card someone has already moved stays where it is.
 *
 * Board *views* are not writable through the GitHub API; those stay a UI job.
 *
 * Needs the `project` token scope on top of `repo`:  gh auth refresh -s project
 * Requires `gh` authenticated as the PERSONAL account — see docs/board/IDENTITY.md.
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const flag = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  const v = i === -1 ? undefined : args[i + 1];
  return v && !v.startsWith('--') ? v : fallback;
};

const repo = flag('repo', 'mastrobardo/marketplace')!;
const owner = flag('owner', 'mastrobardo')!;
const projectNumber = Number(flag('project', '2'));
if (!Number.isInteger(projectNumber)) {
  console.error('--project needs a number');
  process.exit(1);
}

const gh = (a: string[], input?: string) => {
  try {
    return execFileSync('gh', a, { encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    const msg = (e as Error).message;
    if (/read:project|scopes/.test(msg)) {
      console.error(
        '✖ the gh token cannot see projects. Run:  gh auth refresh -s project\n' +
          '  (the board needs write access, so `project` — not just `read:project`)',
      );
      process.exit(1);
    }
    throw e;
  }
};

const who = gh(['api', 'user', '--jq', '.login']).trim();
if (/iagl|parserdigital/i.test(who)) {
  console.error(`✖ refusing: gh identity is ${who}. See docs/board/IDENTITY.md`);
  process.exit(1);
}
console.log(`gh identity: ${who}`);

// --- the board
const project = JSON.parse(
  gh([
    'api',
    'graphql',
    '-f',
    `query=query($owner:String!,$number:Int!){
       user(login:$owner){ projectV2(number:$number){ id title } }
     }`,
    '-f',
    `owner=${owner}`,
    '-F',
    `number=${projectNumber}`,
  ]),
).data?.user?.projectV2;
if (!project?.id) {
  console.error(`✖ no project #${projectNumber} owned by ${owner}`);
  process.exit(1);
}
console.log(`board: ${project.title} (#${projectNumber})`);

// --- what is already on it
type Item = { content?: { number?: number } };
const onBoard = new Set<number>();
let cursor: string | null = null;
do {
  const page = JSON.parse(
    gh([
      'api',
      'graphql',
      '-f',
      `query=query($id:ID!,$after:String){
         node(id:$id){ ... on ProjectV2 { items(first:100, after:$after){
           pageInfo{ hasNextPage endCursor }
           nodes{ content{ ... on Issue { number } ... on PullRequest { number } } }
         } } }
       }`,
      '-f',
      `id=${project.id}`,
      ...(cursor ? ['-f', `after=${cursor}`] : []),
    ]),
  ).data.node.items;
  for (const n of page.nodes as Item[]) if (n.content?.number) onBoard.add(n.content.number);
  cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
} while (cursor);
console.log(`already on the board: ${onBoard.size} item(s)`);

// --- every issue in the repo
type Row = { number: number; title: string; id: string };
const all: Row[] = JSON.parse(
  gh([
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    'all',
    '--limit',
    '500',
    '--json',
    'number,title,id',
  ]),
);
const missing = all.filter((r) => !onBoard.has(r.number)).sort((a, b) => a.number - b.number);
console.log(`issues in ${repo}: ${all.length} — to add: ${missing.length}`);

if (!missing.length) {
  console.log('nothing to do');
  process.exit(0);
}

if (dry) {
  for (const r of missing) console.log(`+ #${r.number} ${r.title}`);
  process.exit(0);
}

// One mutation per issue, but batched into a single request per chunk: 149
// round trips is slow enough to be worth the aliasing.
const CHUNK = 20;
let added = 0;
for (let i = 0; i < missing.length; i += CHUNK) {
  const chunk = missing.slice(i, i + CHUNK);
  const mutation =
    `mutation($p:ID!){\n` +
    chunk
      .map(
        (r, n) =>
          `  a${n}: addProjectV2ItemById(input:{projectId:$p, contentId:"${r.id}"}){ item{ id } }`,
      )
      .join('\n') +
    `\n}`;
  try {
    gh(['api', 'graphql', '-f', `query=${mutation}`, '-f', `p=${project.id}`]);
    added += chunk.length;
    console.log(`  …${added}/${missing.length}`);
  } catch (e) {
    // Fall back to one at a time so a single bad node id cannot lose the batch.
    for (const r of chunk) {
      try {
        gh([
          'api',
          'graphql',
          '-f',
          `query=mutation($p:ID!,$c:ID!){ addProjectV2ItemById(input:{projectId:$p, contentId:$c}){ item{ id } } }`,
          '-f',
          `p=${project.id}`,
          '-f',
          `c=${r.id}`,
        ]);
        added++;
      } catch (inner) {
        console.error(`✖ #${r.number}: ${(inner as Error).message.split('\n')[0]}`);
      }
    }
    void e;
  }
}
console.log(`\nadded ${added} issue(s) to ${project.title}`);
