import { describe, expect, it } from 'vitest';
import { toId } from 'storybook/internal/csf';
import { storyIdsFrom, type StoryModule } from '../visual/subjects.js';
import { checkCoverage } from '../visual/coverage.js';
import { EXCLUSIONS, PINNED } from '../visual/pinned.js';
import { diffAgainstIndex } from '../visual/index-check.js';

/**
 * `W12-T16` AC1–AC4 — the gate on the gate.
 *
 * ADR-012 §6 asks for a *pinned* story list, and pinning is right: a story whose `play` opens an
 * overlay is not a stable screenshot subject. What is not right is a hand-written list of subjects
 * with nothing checking it, which is the failure this repo has had three times (`memory/repo/
 * gotchas.md`, and `tokens.test.ts` AC6's six literal colour pairs before `W12-T18` derived them).
 *
 * So the list stays curated and its **completeness** is asserted here, per pull request — not
 * nightly. A story added today should fail *today's* review, not tomorrow's cron.
 */

/** Every story module in the package, eagerly imported — the same set the storybook project runs. */
const modules = import.meta.glob('../src/**/*.stories.tsx', { eager: true }) as Record<
  string,
  StoryModule
>;

describe('W12-T16 AC1 — subjects are derived, never hand-listed', () => {
  it('derives one subject per exported story, with Storybook’s own id algorithm', () => {
    const subjects = storyIdsFrom(modules);

    // 74 stories across 14 files as of `W12-T18`. The number is not the assertion — the derivation
    // is — but a wildly different count means the glob stopped matching and every other assertion
    // here would pass vacuously.
    expect(subjects.length).toBeGreaterThan(50);

    // Spot-check against `toId` directly rather than against a literal string: if Storybook changes
    // how an id is built, this test changes with it instead of pinning a stale format.
    const card = subjects.find((s) => s.exportName === 'LongText' && s.title === 'Patterns/Card');
    expect(card?.id).toBe(toId('Patterns/Card', 'Long Text'));
  });

  it('honours an explicit story `name` over the export name', () => {
    const subjects = storyIdsFrom({
      './X.stories.tsx': {
        default: { title: 'Primitives/X' },
        Renamed: { name: 'Totally Different' },
      },
    });

    expect(subjects).toEqual([
      {
        id: toId('Primitives/X', 'Totally Different'),
        title: 'Primitives/X',
        exportName: 'Renamed',
        name: 'Totally Different',
      },
    ]);
  });

  it('ignores non-story exports that a story module legitimately carries', () => {
    const subjects = storyIdsFrom({
      './X.stories.tsx': {
        default: { title: 'Primitives/X' },
        Real: {},
        // A helper a story file exports for its siblings — not a story, and shooting it would fail
        // on a subject that does not exist.
        renderLink: () => null,
        SOME_CONSTANT: 'text',
      },
    });

    expect(subjects.map((s) => s.exportName)).toEqual(['Real']);
  });
});

describe('W12-T16 AC2 — a story in neither the list nor the exclusions fails', () => {
  it('names the unpinned story id', () => {
    const problems = checkCoverage(
      [{ id: 'primitives-x--new', title: 'Primitives/X', exportName: 'New', name: 'New' }],
      [],
      [],
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe('unpinned');
    expect(problems[0]?.message).toContain('primitives-x--new');
  });

  it('passes when the story is pinned', () => {
    const subject = {
      id: 'primitives-x--new',
      title: 'Primitives/X',
      exportName: 'New',
      name: 'New',
    };
    expect(checkCoverage([subject], [{ id: 'primitives-x--new' }], [])).toEqual([]);
  });

  it('passes when the story is excluded with a reason', () => {
    const subject = {
      id: 'primitives-x--new',
      title: 'Primitives/X',
      exportName: 'New',
      name: 'New',
    };
    const excluded = [
      { id: 'primitives-x--new', reason: 'opens an overlay; animation is not stable' },
    ];
    expect(checkCoverage([subject], [], excluded)).toEqual([]);
  });

  it('fails when a story is both pinned and excluded — the two disagree and neither wins', () => {
    const subject = {
      id: 'primitives-x--new',
      title: 'Primitives/X',
      exportName: 'New',
      name: 'New',
    };
    const problems = checkCoverage(
      [subject],
      [{ id: 'primitives-x--new' }],
      [{ id: 'primitives-x--new', reason: 'flaky' }],
    );

    expect(problems.map((p) => p.kind)).toContain('contradictory');
  });
});

describe('W12-T16 AC3 — an exclusion with no reason fails', () => {
  it.each([undefined, '', '   '])('rejects reason %j', (reason) => {
    const subject = {
      id: 'primitives-x--new',
      title: 'Primitives/X',
      exportName: 'New',
      name: 'New',
    };
    const problems = checkCoverage([subject], [], [{ id: 'primitives-x--new', reason } as never]);

    expect(problems.map((p) => p.kind)).toContain('unreasoned');
  });
});

describe('W12-T16 AC4 — a pinned entry naming a story that no longer exists fails', () => {
  it('catches a renamed story, which would otherwise silently stop being watched', () => {
    const problems = checkCoverage([], [{ id: 'primitives-x--gone' }], []);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe('orphan');
    expect(problems[0]?.message).toContain('primitives-x--gone');
  });

  it('catches an orphaned exclusion too — a stale excuse is a stale subject', () => {
    const problems = checkCoverage([], [], [{ id: 'primitives-x--gone', reason: 'flaky' }]);

    expect(problems.map((p) => p.kind)).toEqual(['orphan']);
  });
});

describe('W12-T16 AC1/AC2 — the real package is fully covered', () => {
  it('every story in packages/ui is pinned or excluded, with no orphans', () => {
    const problems = checkCoverage(storyIdsFrom(modules), PINNED, EXCLUSIONS);

    // The message is the point: a failure here should name the story, not just count.
    expect(problems.map((p) => p.message)).toEqual([]);
  });
});

describe('W12-T16 — the derived set and Storybook’s own index cannot disagree', () => {
  /**
   * The shooter runs against `storybook-static/index.json`; this suite derives the same set from
   * the modules so that it can run per-PR without a Storybook build. Two derivations of one set is
   * exactly how they drift, so the nightly asserts they are equal — `diffAgainstIndex` is that
   * assertion, tested here against a fixture rather than a 30-second build.
   */
  it('reports ids the index has and the derivation missed', () => {
    const diff = diffAgainstIndex([{ id: 'a--one', title: 'A', exportName: 'One', name: 'One' }], {
      entries: { 'a--one': { type: 'story' }, 'a--two': { type: 'story' } },
    });

    expect(diff.missingFromDerivation).toEqual(['a--two']);
    expect(diff.missingFromIndex).toEqual([]);
  });

  it('reports ids the derivation has and the index does not', () => {
    const diff = diffAgainstIndex(
      [
        { id: 'a--one', title: 'A', exportName: 'One', name: 'One' },
        { id: 'a--ghost', title: 'A', exportName: 'Ghost', name: 'Ghost' },
      ],
      { entries: { 'a--one': { type: 'story' } } },
    );

    expect(diff.missingFromIndex).toEqual(['a--ghost']);
  });

  it('ignores docs entries, which are not shootable subjects', () => {
    const diff = diffAgainstIndex([{ id: 'a--one', title: 'A', exportName: 'One', name: 'One' }], {
      entries: { 'a--one': { type: 'story' }, 'a--docs': { type: 'docs' } },
    });

    expect(diff.missingFromDerivation).toEqual([]);
  });
});
