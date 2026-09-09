/**
 * A task ID is the join between a branch, a spec, a run record and a board issue. Everything in
 * `TODO.md` §6 carries one, and `AGENTS.md` L55 requires the branch, the spec and the run record
 * to share it.
 *
 * Shapes: `W0-T12` (workstream/task), `OPS-04` (operations), `BD-07` (business decision).
 */
const TASK_ID = /^(W\d+-T\d+|OPS-\d+|BD-\d+)(?:-(.+))?$/;

export interface BranchName {
  readonly taskId: string;
  /** The `-`-separated remainder, e.g. `ci-gates`. Empty when the branch is only an ID. */
  readonly slug: string;
}

/**
 * Parse a branch name into its task ID and slug, or `null` when it carries no task ID.
 *
 * `null` is not a failure: `main`, a spike, and a docs typo fix are all legitimate branches with
 * nothing to spec. The gate skips them rather than inventing a requirement nobody wrote down.
 *
 * Anchored at the start on purpose. `revert-W0-T12-ci-gates` contains a task ID but is not that
 * task, and requiring it to re-add the spec it is reverting would be exactly backwards.
 */
export function parseBranch(branch: string): BranchName | null {
  const match = TASK_ID.exec(branch.trim());
  if (match === null) return null;
  return { taskId: match[1] ?? '', slug: match[2] ?? '' };
}
