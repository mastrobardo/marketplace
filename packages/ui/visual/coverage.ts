import { type Subject } from './subjects.js';

/**
 * The completeness gate on the pinned list — `W12-T16` AC2–AC4.
 *
 * The pinned list is curated on purpose: a story whose `play` opens an overlay is not a stable
 * screenshot subject, and the gate has to be able to say so. What it may not do is *silently*
 * omit a story, which is what a hand-written list does by default. `memory/repo/gotchas.md` has
 * three instances of the same bug — the `database` job naming its suites, `tokens.test.ts` AC6
 * naming six colour pairs, AC4 walking `.css` only — and each was invisible until someone looked.
 *
 * So: every derived subject must appear in exactly one of the two lists, every entry in either list
 * must name a subject that exists, and an exclusion must say why.
 */
export interface PinnedEntry {
  readonly id: string;
  /**
   * Theme × scheme × locale combinations to shoot, as Storybook globals. Omitted means the default
   * matrix (spec §10 Q5: `default`/`light`/`es-ES`), which is what all but `Foundations/Themes`
   * want.
   */
  readonly matrix?: readonly StoryGlobals[];
}

export interface StoryGlobals {
  readonly theme: 'default' | 'contrast';
  readonly scheme: 'light' | 'dark';
  readonly locale?: 'es-ES' | 'en-GB';
}

export interface Exclusion {
  readonly id: string;
  /** Why this story is not a stable subject. Asserted non-empty — an excuse nobody wrote is not one. */
  readonly reason: string;
}

export type ProblemKind = 'unpinned' | 'unreasoned' | 'orphan' | 'contradictory';

export interface CoverageProblem {
  readonly kind: ProblemKind;
  readonly id: string;
  readonly message: string;
}

export function checkCoverage(
  subjects: readonly Subject[],
  pinned: readonly PinnedEntry[],
  exclusions: readonly Exclusion[],
): CoverageProblem[] {
  const problems: CoverageProblem[] = [];
  const known = new Set(subjects.map((s) => s.id));
  const pinnedIds = new Set(pinned.map((p) => p.id));
  const excludedIds = new Set(exclusions.map((e) => e.id));

  for (const subject of subjects) {
    const isPinned = pinnedIds.has(subject.id);
    const isExcluded = excludedIds.has(subject.id);

    if (isPinned && isExcluded) {
      problems.push({
        kind: 'contradictory',
        id: subject.id,
        message:
          `${subject.id} is both pinned and excluded. Neither wins by default — ` +
          `decide whether it is a stable subject and remove the other entry.`,
      });
      continue;
    }

    if (!isPinned && !isExcluded) {
      problems.push({
        kind: 'unpinned',
        id: subject.id,
        message:
          `${subject.id} (${subject.title} → ${subject.exportName}) is in neither the pinned ` +
          `list nor the exclusions. Add it to PINNED, or exclude it with a reason.`,
      });
    }
  }

  for (const exclusion of exclusions) {
    if (exclusion.reason?.trim() === '' || exclusion.reason === undefined) {
      problems.push({
        kind: 'unreasoned',
        id: exclusion.id,
        message: `${exclusion.id} is excluded with no reason. Say why it is not a stable subject.`,
      });
    }
  }

  // A renamed story leaves its old id behind in the list. Nothing shoots it, nothing fails, and the
  // story that replaced it is unwatched under a new id — so the orphan is the more dangerous half.
  for (const id of [...pinnedIds, ...excludedIds]) {
    if (known.has(id)) continue;
    problems.push({
      kind: 'orphan',
      id,
      message:
        `${id} is listed but no story has that id. It was renamed or deleted — ` +
        `update the entry, or the story that replaced it is being watched by nobody.`,
    });
  }

  return problems;
}
