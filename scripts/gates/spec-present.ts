/**
 * Gate `spec-present` — a task branch must carry its spec and its run record.
 *
 * `TODO.md` L219: "a PR whose branch name carries a task ID fails unless it adds or modifies both
 * files for that ID. No spec, no merge."
 *
 * The gate looks at what the branch **changed**, not at what exists. A branch that merely inherits
 * a spec written by an earlier task has documented nothing about itself.
 */
import { fail, pass, skip, type GateResult } from './types.js';
import { parseBranch } from './task-id.js';

export interface SpecPresentFacts {
  readonly branch: string;
  /** Paths added or modified on this branch, relative to the repo root, base-to-head. */
  readonly changedFiles: readonly string[];
}

/** `docs/specs/<slice>/<stem>.md` — the slice directory is not pinned, so W1 needs no change. */
const SPEC_PATH = /^docs\/specs\/[^/]+\/(.+)\.md$/;

function stemsFor(taskId: string, changedFiles: readonly string[]): string[] {
  const stems: string[] = [];
  for (const path of changedFiles) {
    const match = SPEC_PATH.exec(path);
    if (match === null) continue;
    const stem = match[1] ?? '';
    // `-` delimited so that a `W0-T1` branch does not claim `W0-T12`'s spec.
    if (stem === taskId || stem.startsWith(`${taskId}-`)) stems.push(stem);
  }
  return stems;
}

export function checkSpecPresent(facts: SpecPresentFacts): GateResult {
  const branch = parseBranch(facts.branch);
  if (branch === null) {
    return skip(`branch "${facts.branch}" carries no task ID — nothing to spec.`);
  }

  const stems = stemsFor(branch.taskId, facts.changedFiles);
  const hasRun = stems.some((stem) => stem.endsWith('.run'));
  const hasSpec = stems.some((stem) => !stem.endsWith('.run'));

  const wantSpec = `docs/specs/<slice>/${facts.branch}.md`;
  const wantRun = `docs/specs/<slice>/${facts.branch}.run.md`;

  if (hasSpec && hasRun) {
    return pass(`${branch.taskId}: spec and run record both changed on this branch.`);
  }

  if (!hasSpec && !hasRun) {
    return fail(
      'SPEC_MISSING',
      `branch "${facts.branch}" carries task ID ${branch.taskId} but changes no spec.\n` +
        `  expected both:\n    ${wantSpec}\n    ${wantRun}\n` +
        `  Write the spec before the code (AGENTS.md L55). No spec, no merge.`,
    );
  }

  const missing = hasSpec ? `the run record (${wantRun})` : `the spec (${wantSpec})`;
  const present = hasSpec ? 'spec' : 'run record';
  return fail(
    'SPEC_UNPAIRED',
    `branch "${facts.branch}" changes the ${present} but not ${missing}.\n` +
      `  The pair travels together: the spec states the intent, the run record carries the\n` +
      `  failing-test paste and what actually happened (TODO.md §5.3).`,
  );
}
