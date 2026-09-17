#!/usr/bin/env tsx
/**
 * The CI half of the gates. Everything impure lives here: git, the environment, the exit code.
 *
 *   pnpm gates                                  # every gate — what CI runs
 *   tsx scripts/gates/run.ts --all              # the same thing
 *   tsx scripts/gates/run.ts spec-present       # one gate, by name
 *
 * Facts come from the environment so the workflow, not this script, decides what a "branch" and a
 * "base" are — a pull request and a push to `main` disagree about both.
 *
 * **One invocation judges every gate** (`W0-T29`). Until then each gate was its own workflow job,
 * which cost ~30s of checkout, setup-node and install to run ~2s of gate, and billed a whole
 * minute — four times over. What four job names bought was legibility: a red pull request said
 * *which* gate failed without anyone opening a log. That is now an `::error` annotation per
 * failing gate and a table in the run summary, and it is strictly better in one way: every gate is
 * evaluated even after one fails, so a branch that breaks two of them learns both in one round
 * trip instead of two.
 *
 * Exits 1 on failure, 2 when a gate cannot see its inputs. Unlike `scripts/deploy/check.ts`, which
 * reports a missing credential and exits 0, these gates block: a missing spec is not a to-do item,
 * it is the thing being reviewed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { checkSpecPresent } from './spec-present.js';
import { checkInterventionLogged } from './intervention-logged.js';
import { checkAuthorIdentity, type Commit } from './author-identity.js';
import { checkAgentsDrift } from './agents-drift.js';
import { skip, type GateResult } from './types.js';

type GateName = 'spec-present' | 'intervention-logged' | 'author-identity' | 'agents-drift';
const GATES: readonly GateName[] = [
  'spec-present',
  'intervention-logged',
  'author-identity',
  'agents-drift',
];

/**
 * This repository, resolved from this file rather than from `process.cwd()`.
 *
 * `agents-drift` compares two directories in *this* tree, so it must not depend on where the
 * runner was invoked from. The git-reading gates deliberately still use the working directory:
 * their subject is whatever repository the caller is standing in.
 */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
}

/**
 * Fail loudly when the base commit is not in the clone.
 *
 * The default `actions/checkout` depth is 1, which fetches the head commit and nothing else. Every
 * gate here is a diff or a walk against the base, so without the full history git aborts with
 * "unknown revision" and node prints a stack trace naming neither the cause nor the fix. Worse, an
 * earlier draft that swallowed the error passed every branch — a gate that cannot see its inputs
 * must say so, not report success.
 */
function assertBaseFetched(base: string): void {
  try {
    execFileSync('git', ['rev-parse', '--verify', `origin/${base}`], { stdio: 'ignore' });
  } catch {
    console.error(
      `GATE_NO_BASE: origin/${base} is not in this clone, so there is nothing to compare against.\n` +
        `  Give the job a full history:\n` +
        `    - uses: actions/checkout@v5\n` +
        `      with:\n` +
        `        fetch-depth: 0`,
    );
    process.exit(2);
  }
}

function env(name: string): string {
  return process.env[name]?.trim() ?? '';
}

/**
 * Two ranges, because `git diff` and `git log` read `...` to mean different things.
 *
 * `git diff A...B` is "what changed on B since the merge base" — the reviewer's view, and the right
 * one for `changedFiles`.
 *
 * `git log A...B` is the **symmetric difference**: commits reachable from either side but not both.
 * So it also walks commits that are on the *base* and not on the branch — and after anything is
 * merged into `main` while a pull request is open, that means the gate judges commits the branch
 * never made. GitHub's own squash-merge commits carry committer `noreply@github.com`, so a single
 * merge into `main` turned every open pull request red. `--no-merges` does not save it: a squash
 * merge produces an ordinary commit, not a merge commit.
 *
 * Found when `W12-T15` went red seven seconds after `#242` was merged, having been green on the
 * same commit four minutes earlier. The pure half of this gate was thoroughly tested; the range it
 * was fed was not.
 */
function range(kind: 'diff' | 'log'): string | null {
  const base = env('GITHUB_BASE_REF');
  if (base === '') return null;
  assertBaseFetched(base);
  return `origin/${base}${kind === 'diff' ? '...' : '..'}HEAD`;
}

/** Two gates read the same diff; computing it once keeps `--all` to one `git diff`. */
let changedFilesCache: readonly string[] | null = null;

function changedFiles(): readonly string[] {
  if (changedFilesCache !== null) return changedFilesCache;
  const spec = range('diff');
  changedFilesCache =
    spec === null
      ? []
      : git('diff', '--name-only', spec)
          .split('\n')
          .filter((line) => line !== '');
  return changedFilesCache;
}

function commits(): readonly Commit[] {
  const spec = range('log');
  if (spec === null) return [];
  // A unit separator keeps the parse safe against any character git may put in a field.
  const raw = git('log', '--no-merges', '--format=%H%x1f%ae%x1f%ce', spec);
  if (raw === '') return [];
  return raw.split('\n').map((line) => {
    const [sha = '', authorEmail = '', committerEmail = ''] = line.split('\x1f');
    return { sha: sha.slice(0, 12), authorEmail, committerEmail };
  });
}

/**
 * The PR's labels, as a JSON array written by the workflow.
 *
 * JSON rather than a delimited string because GitHub labels may contain commas and spaces. A
 * malformed value is treated as no labels: this gate only ever *adds* a requirement, so failing
 * open here cannot let an unlabelled PR through anything.
 */
function labels(): readonly string[] {
  const raw = env('PR_LABELS');
  if (raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    console.warn(`PR_LABELS is not JSON, reading it as no labels: ${raw}`);
    return [];
  }
}

/**
 * Ask the generator, in this repository, whether `.claude/agents/` is still its own output.
 *
 * Spawning it costs about a second and buys the guarantee that the gate and the generator can
 * never disagree about what a generated charter looks like.
 */
function agentsDrift(): GateResult {
  const result = spawnSync('pnpm', ['tsx', 'scripts/generate-claude-agents.ts', '--check'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return checkAgentsDrift({
    exitCode: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  });
}

function run(gate: GateName): GateResult {
  // `agents-drift` compares two directories in the tree and needs no pull request, so it is the
  // one gate that still judges something on a push to `main`.
  if (gate === 'agents-drift') return agentsDrift();

  // The rest judge a pull request. On a push there is no base ref and no labels, so they say so
  // rather than evaluating against nothing — the job carries no `if:`, deliberately, because a
  // skipped job is reported to branch protection as a satisfied one.
  if (env('GITHUB_BASE_REF') === '') {
    return skip('not a pull request — this gate is scoped to a PR and has nothing to compare.');
  }

  const branch = env('GITHUB_HEAD_REF');
  switch (gate) {
    case 'spec-present':
      return checkSpecPresent({ branch, changedFiles: changedFiles() });
    case 'intervention-logged':
      return checkInterventionLogged({ branch, labels: labels(), changedFiles: changedFiles() });
    case 'author-identity':
      return checkAuthorIdentity(commits());
  }
}

interface Verdict {
  readonly gate: GateName;
  readonly result: GateResult;
}

function status(result: GateResult): 'ok' | 'skipped' | 'FAILED' {
  return result.skipped ? 'skipped' : result.ok ? 'ok' : 'FAILED';
}

function icon(result: GateResult): string {
  return result.skipped ? '⏭️' : result.ok ? '✅' : '❌';
}

/**
 * A GitHub error annotation, which is what puts the failure on the Checks tab and beside the job
 * without anyone opening a log — the legibility the four job names used to provide.
 *
 * Newlines must be percent-encoded or GitHub keeps only the first line, and `%` itself has to go
 * first or it would corrupt the encodings that follow.
 */
function annotate(verdict: Verdict): void {
  if (env('GITHUB_ACTIONS') !== 'true') return;
  const encoded = verdict.result.message
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
  console.log(`::error title=gate: ${verdict.gate}::${encoded}`);
}

/**
 * Every verdict as a table in the run recap, with each failure's full text under it.
 *
 * Appended, never truncated, so it cannot delete another step's contribution to the same file —
 * the same rule the `perf` job follows.
 */
function summarise(verdicts: readonly Verdict[]): void {
  const file = env('GITHUB_STEP_SUMMARY');
  if (file === '') return;

  const rows = verdicts.map(({ gate, result }) => {
    const [first = ''] = result.message.split('\n');
    return `| \`${gate}\` | ${icon(result)} ${first} |`;
  });

  const failures = verdicts
    .filter(({ result }) => !result.ok)
    .map(({ gate, result }) => `\n**\`${gate}\`**\n\n\`\`\`\n${result.message}\n\`\`\`\n`);

  appendFileSync(
    file,
    `### gates\n\n| gate | verdict |\n| --- | --- |\n${rows.join('\n')}\n${failures.join('')}\n`,
  );
}

function main(): void {
  const argument = process.argv[2];
  const selected: readonly GateName[] | null =
    argument === undefined || argument === '--all'
      ? GATES
      : GATES.includes(argument as GateName)
        ? [argument as GateName]
        : null;

  if (selected === null) {
    console.error(`Usage: run.ts [--all | ${GATES.join(' | ')}]`);
    process.exitCode = 2;
    return;
  }

  // Every gate runs, whatever the ones before it decided. Stopping at the first failure would
  // cost a whole CI round trip to discover the second, which is the one thing splitting these
  // into four jobs was genuinely good at.
  const verdicts: Verdict[] = selected.map((gate) => ({ gate, result: run(gate) }));

  for (const verdict of verdicts) {
    console.log(
      `${verdict.gate}: ${status(verdict.result)}\n  ${verdict.result.message.replace(/\n/g, '\n  ')}`,
    );
    if (!verdict.result.ok) annotate(verdict);
  }

  summarise(verdicts);

  if (verdicts.some(({ result }) => !result.ok)) process.exitCode = 1;
}

main();
