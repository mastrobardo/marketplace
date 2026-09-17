/**
 * Gate `author-identity` — every commit is the personal identity, never the work one.
 *
 * `docs/board/IDENTITY.md`: "fails a PR if any commit author or committer email is not
 * `mastrobardo@gmail.com`". Both trailers are checked: `git commit --author` sets only the author
 * and leaves the committer as whoever ran the command — and on this machine `gh` and the default
 * SSH key both authenticate as the work account (IDENTITY.md, "Known trap on this machine").
 *
 * The pre-commit hook in `.githooks/` checks the same thing locally. It is a convenience, not the
 * guarantee: hooks live outside the repo's control, are opt-in via `core.hooksPath`, and are
 * skipped entirely by `--no-verify`. This gate is the one that cannot be bypassed.
 */
import { fail, pass, type GateResult } from './types.js';

export const EXPECTED_EMAIL = 'mastrobardo@gmail.com';

/**
 * GitHub's own committer address.
 *
 * Every commit the platform makes on your behalf — a squash merge, the "Update branch" button, an
 * edit through the web UI — is committed by `GitHub <noreply@github.com>` and leaves the *author*
 * untouched. That trailer therefore says who ran the merge button, not who wrote the code, and it
 * can never be the personal address no matter what anyone configures.
 *
 * This gate fired exactly once in this repo's history, on `03e8651` — the squash-merge commit
 * GitHub created when #256 was merged — and reddened a pull request whose author had mis-signed
 * nothing, with a remedy (`git commit --amend --reset-author`) that cannot be applied to a commit
 * the platform wrote on a branch that is already merged (`MEM-2026-09-17-16`). So a platform
 * commit is judged on its author, which is the trailer `docs/board/IDENTITY.md` is about.
 */
export const PLATFORM_COMMITTER = 'noreply@github.com';

export interface Commit {
  readonly sha: string;
  readonly authorEmail: string;
  readonly committerEmail: string;
}

interface Offence {
  readonly sha: string;
  readonly role: 'author' | 'committer';
  readonly email: string;
}

export function checkAuthorIdentity(
  commits: readonly Commit[],
  expected: string = EXPECTED_EMAIL,
): GateResult {
  // Addresses are case-insensitive in practice, and git preserves whatever was configured.
  const want = expected.trim().toLowerCase();
  const offences: Offence[] = [];

  for (const commit of commits) {
    if (commit.authorEmail.trim().toLowerCase() !== want) {
      offences.push({ sha: commit.sha, role: 'author', email: commit.authorEmail });
    }
    const committer = commit.committerEmail.trim().toLowerCase();
    if (committer !== want && committer !== PLATFORM_COMMITTER) {
      offences.push({ sha: commit.sha, role: 'committer', email: commit.committerEmail });
    }
  }

  if (offences.length === 0) {
    return pass(`${String(commits.length)} commit(s), every author and committer is ${expected}.`);
  }

  // Every offence, not just the first: rewriting history one commit at a time, discovering the
  // next one only after another CI round, is how a five-commit branch costs an afternoon.
  const listed = offences.map((o) => `    ${o.sha}  ${o.role.padEnd(9)} ${o.email}`).join('\n');

  return fail(
    'AUTHOR_IDENTITY',
    `${String(offences.length)} commit trailer(s) are not ${expected}:\n${listed}\n` +
      `  This repository is personal (docs/board/IDENTITY.md). Fix the branch, do not merge it:\n` +
      `    git config user.email ${expected}\n` +
      `    git rebase --root --exec 'git commit --amend --no-edit --reset-author'\n` +
      `  then force-push. Amending resets the committer as well as the author.`,
  );
}
