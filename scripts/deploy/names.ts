/**
 * Names for the per-PR resources. One source of truth, imported by the workflows through
 * `scripts/deploy/check.ts`, so a name is never spelled out twice — a preview that deploys to one
 * app and tears down another is a resource that bills forever.
 */

/** Fly app names are global, DNS-labelled and capped; 30 leaves room for a longer prefix later. */
const MAX_APP_NAME = 30;
const APP_PREFIX = 'marketplace-api-pr-';

function assertPullRequestNumber(pr: number): void {
  if (!Number.isInteger(pr) || pr <= 0) {
    throw new Error(`Not a pull request number: ${String(pr)}`);
  }
}

/** The Fly app for a pull request. Deterministic: the same PR always names the same app. */
export function previewAppName(pr: number): string {
  assertPullRequestNumber(pr);
  const name = `${APP_PREFIX}${String(pr)}`;
  if (name.length > MAX_APP_NAME) {
    throw new Error(`Fly app name "${name}" exceeds ${String(MAX_APP_NAME)} characters`);
  }
  return name;
}

/**
 * The Neon branch for a pull request (`W0-T16`). Branched from the **sanitised** staging branch —
 * a preview must never be able to reach real licence documents or phone numbers (ADR-006).
 */
export function previewBranchName(pr: number): string {
  assertPullRequestNumber(pr);
  return `preview/pr-${String(pr)}`;
}

/** The Cloudflare Pages branch alias, which becomes the preview hostname. */
export function previewPagesBranch(pr: number): string {
  assertPullRequestNumber(pr);
  return `pr-${String(pr)}`;
}
