#!/usr/bin/env tsx
/**
 * The CI half of the gates. Everything impure lives here: git, the environment, the exit code.
 *
 *   tsx scripts/gates/run.ts spec-present
 *   tsx scripts/gates/run.ts intervention-logged
 *   tsx scripts/gates/run.ts author-identity
 *
 * Facts come from the environment so the workflow, not this script, decides what a "branch" and a
 * "base" are — a pull request and a push to `main` disagree about both.
 *
 * Exits 1 on failure. Unlike `scripts/deploy/check.ts`, which reports a missing credential and
 * exits 0, these gates block: a missing spec is not a to-do item, it is the thing being reviewed.
 */
import { execFileSync } from 'node:child_process';

import { checkSpecPresent } from './spec-present.js';
import { checkInterventionLogged } from './intervention-logged.js';
import { checkAuthorIdentity, type Commit } from './author-identity.js';
import { skip, type GateResult } from './types.js';

type GateName = 'spec-present' | 'intervention-logged' | 'author-identity';
const GATES: readonly GateName[] = ['spec-present', 'intervention-logged', 'author-identity'];

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
 * The commit range under review, as `<base>..<head>`.
 *
 * `GITHUB_BASE_REF` is set on a pull request only. On a push there is no range to speak of, so the
 * caller is expected not to run these gates there — but if it does, an empty range is reported
 * honestly rather than silently passing a full-history walk.
 */
function range(): string | null {
  const base = env('GITHUB_BASE_REF');
  if (base === '') return null;
  assertBaseFetched(base);
  return `origin/${base}...HEAD`;
}

function changedFiles(): readonly string[] {
  const spec = range();
  if (spec === null) return [];
  return git('diff', '--name-only', spec)
    .split('\n')
    .filter((line) => line !== '');
}

function commits(): readonly Commit[] {
  const spec = range();
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

function run(gate: GateName): GateResult {
  // These gates judge a pull request. On a push there is no base ref and no labels, so they say so
  // rather than evaluating against nothing — the jobs carry no `if:`, deliberately, because a
  // skipped job is reported to branch protection as a satisfied one.
  if (env('GITHUB_BASE_REF') === '') {
    return skip('not a pull request — these gates are scoped to a PR and have nothing to compare.');
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

function main(): void {
  const gate = process.argv[2];
  if (gate === undefined || !GATES.includes(gate as GateName)) {
    console.error(`Usage: run.ts <${GATES.join('|')}>`);
    process.exitCode = 2;
    return;
  }

  const result = run(gate as GateName);
  const status = result.skipped ? 'skipped' : result.ok ? 'ok' : 'FAILED';
  console.log(`${gate}: ${status}\n  ${result.message.replace(/\n/g, '\n  ')}`);

  if (!result.ok) process.exitCode = 1;
}

main();
