import { describe, expect, it } from 'vitest';
import { decideReport, ISSUE_MARKER, type IssueSummary } from '../visual/report.js';

/**
 * `W12-T16` AC17–AC18 — the part that decides whether anyone finds out.
 *
 * A nightly that fails into an empty room is not a gate. A nightly that files a fresh issue every
 * night is a gate whose notifications get muted within a week, which is the same thing arrived at
 * more annoyingly. So: one issue, updated while it stays broken, closed when it goes green.
 *
 * The decision is pure and tested here; the workflow does the I/O. That split is deliberate —
 * every interesting rule (dedupe, close-on-green, do-nothing-on-quiet) is then asserted without a
 * GitHub token.
 */

const open: IssueSummary = { number: 7, title: `${ISSUE_MARKER} nightly failed`, state: 'open' };
const unrelated: IssueSummary = { number: 9, title: 'W12-T19 — the typeface', state: 'open' };

describe('W12-T16 AC17 — a repeat failure updates, it does not open a second issue', () => {
  it('opens when nothing is open', () => {
    const action = decideReport({
      failed: true,
      failures: ['patterns-card--default'],
      issues: [],
      runUrl: 'https://example.test/run/1',
    });

    expect(action.kind).toBe('open');
    expect(action.kind === 'open' && action.title).toContain(ISSUE_MARKER);
  });

  it('updates the existing one on the next failure', () => {
    const action = decideReport({
      failed: true,
      failures: ['patterns-card--default'],
      issues: [open],
      runUrl: 'https://example.test/run/2',
    });

    expect(action).toMatchObject({ kind: 'update', number: 7 });
  });

  it('ignores an open issue that is not its own', () => {
    const action = decideReport({
      failed: true,
      failures: ['patterns-card--default'],
      issues: [unrelated],
      runUrl: 'https://example.test/run/3',
    });

    // Matching on "an issue is open" rather than on the marker would hijack an unrelated ticket and
    // never file its own.
    expect(action.kind).toBe('open');
  });

  it('names the failing subjects and links the run, so the issue is actionable unopened', () => {
    const action = decideReport({
      failed: true,
      failures: ['patterns-card--default', 'primitives-button--pending'],
      issues: [],
      runUrl: 'https://example.test/run/4',
    });

    const body = action.kind === 'open' ? action.body : '';
    expect(body).toContain('patterns-card--default');
    expect(body).toContain('primitives-button--pending');
    expect(body).toContain('https://example.test/run/4');
  });
});

describe('W12-T16 AC18 — a green run closes the issue', () => {
  it('closes the open one', () => {
    const action = decideReport({
      failed: false,
      failures: [],
      issues: [open],
      runUrl: 'https://example.test/run/5',
    });

    expect(action).toMatchObject({ kind: 'close', number: 7 });
  });

  it('does nothing when green and nothing is open', () => {
    const action = decideReport({
      failed: false,
      failures: [],
      issues: [],
      runUrl: 'https://example.test/run/6',
    });

    expect(action.kind).toBe('none');
  });

  it('does not close an unrelated issue that happens to be open', () => {
    const action = decideReport({
      failed: false,
      failures: [],
      issues: [unrelated],
      runUrl: 'https://example.test/run/7',
    });

    expect(action.kind).toBe('none');
  });

  it('ignores an already-closed issue of its own rather than reopening the question', () => {
    const action = decideReport({
      failed: false,
      failures: [],
      issues: [{ ...open, state: 'closed' }],
      runUrl: 'https://example.test/run/8',
    });

    expect(action.kind).toBe('none');
  });
});
