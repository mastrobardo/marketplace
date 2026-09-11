/**
 * What the nightly does when it fails — `W12-T16` AC17/AC18.
 *
 * The failure mode this is written against is not "nobody is told", it is "everybody stops
 * reading". A cron that opens a fresh issue on every red night trains its audience to filter it,
 * and a filtered gate reports coverage that does not exist — the same dishonesty as a gate that
 * fails open, arrived at socially instead of technically.
 *
 * So there is exactly one issue at a time, found by a marker in its title, updated while the
 * failure persists and closed when it clears. Pure decision, no I/O: the workflow holds the token.
 */
export const ISSUE_MARKER = '[visual-regression]';

export interface IssueSummary {
  readonly number: number;
  readonly title: string;
  readonly state: 'open' | 'closed';
}

export interface ReportInput {
  readonly failed: boolean;
  /** Story ids or route paths that failed, for the body. */
  readonly failures: readonly string[];
  /** Issues visible to the run — the workflow passes what the API returned, unfiltered. */
  readonly issues: readonly IssueSummary[];
  readonly runUrl: string;
}

export type ReportAction =
  | { readonly kind: 'open'; readonly title: string; readonly body: string }
  | { readonly kind: 'update'; readonly number: number; readonly body: string }
  | { readonly kind: 'close'; readonly number: number; readonly comment: string }
  | { readonly kind: 'none'; readonly reason: string };

function body(input: ReportInput): string {
  const list = input.failures.map((f) => `- \`${f}\``).join('\n');

  return [
    `The nightly visual run failed.`,
    ``,
    `**Failing subjects**`,
    list === '' ? '- (none reported — see the run log)' : list,
    ``,
    `**Run**: ${input.runUrl}`,
    ``,
    `The \`expected\`, \`actual\` and \`diff\` images are attached to that run as artefacts.`,
    `If the change was intended, regenerate the baselines with the \`visual-baselines\` workflow —`,
    `it opens a pull request, so the two images get looked at before they become the new truth.`,
  ].join('\n');
}

export function decideReport(input: ReportInput): ReportAction {
  // Its own issue, never merely *an* open issue: matching on state alone would hijack an unrelated
  // ticket and then never file one of its own.
  const mine = input.issues.find(
    (issue) => issue.state === 'open' && issue.title.includes(ISSUE_MARKER),
  );

  if (input.failed) {
    if (mine === undefined) {
      return {
        kind: 'open',
        title: `${ISSUE_MARKER} nightly visual run is failing`,
        body: body(input),
      };
    }
    return { kind: 'update', number: mine.number, body: body(input) };
  }

  if (mine === undefined) {
    return { kind: 'none', reason: 'green, and nothing of ours is open' };
  }

  return {
    kind: 'close',
    number: mine.number,
    comment: `Green again as of ${input.runUrl}. Closing.`,
  };
}
