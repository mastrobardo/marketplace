#!/usr/bin/env tsx
/**
 * The nightly's reporting step — `W12-T16` AC17/AC18.
 *
 * All the I/O, none of the decisions: `report.ts` decides, this executes. That split is why the
 * dedupe rule, the close-on-green rule and the do-nothing-when-quiet rule are all asserted in
 * `tests/visual-report.test.ts` without a GitHub token anywhere near them.
 *
 *   tsx visual/report-cli.ts --results visual-results/report.json --run-url <url>
 *
 * Exits 0 even when the run failed. The *run* failing is the nightly job's business; this step's
 * job is only to make sure a human finds out, and a non-zero exit here would mask which of the two
 * actually went wrong.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { decideReport, type IssueSummary } from './report.js';

interface PlaywrightSuite {
  readonly title?: string;
  readonly suites?: PlaywrightSuite[];
  readonly specs?: { readonly title: string; readonly ok: boolean }[];
}

function arg(name: string, fallback = ''): string {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

/** Every spec that did not pass, flattened out of Playwright's nested suite tree. */
function failuresFrom(suite: PlaywrightSuite): string[] {
  const here = (suite.specs ?? []).filter((spec) => !spec.ok).map((spec) => spec.title);
  const below = (suite.suites ?? []).flatMap(failuresFrom);
  return [...here, ...below];
}

function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
}

const resultsPath = arg('results', 'visual-results/report.json');
const runUrl = arg('run-url', 'the workflow run');

// A missing report is itself a failure: the run died before Playwright wrote anything, which is
// exactly the state nobody should be told "green" about.
const hasResults = existsSync(resultsPath);
const failures = hasResults
  ? failuresFrom(JSON.parse(readFileSync(resultsPath, 'utf8')) as PlaywrightSuite)
  : ['(the run produced no report — it failed before Playwright wrote one)'];

const failed = !hasResults || failures.length > 0;

const issues = JSON.parse(
  gh(['issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,state']),
) as IssueSummary[];

const action = decideReport({ failed, failures, issues, runUrl });

switch (action.kind) {
  case 'open': {
    const url = gh(['issue', 'create', '--title', action.title, '--body-file', '-'], action.body);
    process.stdout.write(`opened ${url}`);
    break;
  }
  case 'update': {
    gh(['issue', 'comment', String(action.number), '--body-file', '-'], action.body);
    process.stdout.write(`updated #${action.number} rather than opening a second issue\n`);
    break;
  }
  case 'close': {
    gh(['issue', 'close', String(action.number), '--comment', action.comment]);
    process.stdout.write(`closed #${action.number}\n`);
    break;
  }
  case 'none': {
    process.stdout.write(`nothing to report: ${action.reason}\n`);
    break;
  }
}
