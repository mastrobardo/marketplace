/**
 * The preflight step of every deploy workflow.
 *
 * Usage: `tsx scripts/deploy/check.ts <target> [pr-number]`
 *
 * Writes `configured`, `missing`, `app`, `db-branch` and `pages-branch` to `$GITHUB_OUTPUT`, and
 * prints the blocked-block when something is absent. It **always exits 0**: a deploy that cannot
 * run for want of a credential is a to-do item, not a broken build, and making every PR red until
 * four accounts exist is how a team learns to ignore red.
 */
import { appendFileSync } from 'node:fs';

import { checkDeployConfig, renderMissing, type DeployTarget } from './config.js';
import { previewAppName, previewBranchName, previewPagesBranch } from './names.js';

const TARGETS: readonly DeployTarget[] = ['preview', 'staging', 'production'];

function output(name: string, value: string): void {
  const file = process.env['GITHUB_OUTPUT'];
  if (file === undefined) {
    console.warn(`${name}=${value}`);
    return;
  }
  appendFileSync(file, `${name}=${value}\n`);
}

function main(): void {
  const [target, pr] = process.argv.slice(2);

  if (target === undefined || !TARGETS.includes(target as DeployTarget)) {
    console.error(`Usage: check.ts <${TARGETS.join('|')}> [pr-number]`);
    process.exitCode = 2;
    return;
  }

  const result = checkDeployConfig(process.env, target as DeployTarget);
  console.warn(renderMissing(result, target as DeployTarget));

  output('configured', String(result.configured));
  output('missing', result.missing.join(','));

  if (pr !== undefined) {
    const number = Number(pr);
    output('app', previewAppName(number));
    output('db-branch', previewBranchName(number));
    output('pages-branch', previewPagesBranch(number));
  }
}

main();
