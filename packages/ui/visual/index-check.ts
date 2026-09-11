import { type Subject } from './subjects.js';

/**
 * The two enumerations must agree — `W12-T16` spec §4.1, honoured rather than abandoned.
 *
 * The completeness gate derives subjects from the story modules so it can run per pull request
 * without a Storybook build (`subjects.ts` explains why). The shooter runs against
 * `storybook-static/index.json`, because that is what actually exists in the browser. Two
 * derivations of one set drift; this asserts they have not, in the nightly, where the index is
 * already built and the check is free.
 *
 * `type: 'docs'` entries are not shootable subjects — an autodocs page is not a story — so they are
 * filtered rather than reported as a disagreement.
 */
export interface StorybookIndex {
  readonly entries: Record<string, { readonly type?: string }>;
}

export interface IndexDiff {
  /** Ids Storybook knows about that the module derivation did not produce. */
  readonly missingFromDerivation: string[];
  /** Ids the derivation produced that Storybook does not have. */
  readonly missingFromIndex: string[];
}

export function diffAgainstIndex(subjects: readonly Subject[], index: StorybookIndex): IndexDiff {
  const derived = new Set(subjects.map((s) => s.id));
  const indexed = new Set(
    Object.entries(index.entries)
      .filter(([, entry]) => (entry.type ?? 'story') === 'story')
      .map(([id]) => id),
  );

  return {
    missingFromDerivation: [...indexed].filter((id) => !derived.has(id)).sort(),
    missingFromIndex: [...derived].filter((id) => !indexed.has(id)).sort(),
  };
}
