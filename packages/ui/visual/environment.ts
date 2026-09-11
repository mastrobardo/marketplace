/**
 * The reference environment — `W12-T16` §4.3.
 *
 * ADR-012 §6 accepted the cost of committed screenshots plainly: *"screenshot baselines are
 * renderer- and OS-dependent, so they are generated **only** inside the CI container image, and a
 * local run does not update them."* That is a rule, and a rule with nothing checking it is a
 * comment. `fingerprint.json` records what produced the baselines; this compares.
 *
 * The interesting part is what happens on a mismatch, and it is deliberately *asymmetric*:
 *
 * - **In CI it fails.** Not skips. A skipped check reads as a satisfied one — `ci.yml` says so in
 *   its own comment, and it is why none of the repo's gates carry an `if:`.
 * - **Locally it skips**, and prints the reference, because the alternative is a developer staring
 *   at 74 diffs that are all font smoothing and concluding the gate is noise.
 */
export interface Fingerprint {
  /** Container image, without the tag — the tag is `playwright`'s version. */
  readonly image: string;
  readonly imageDigest: string;
  readonly playwright: string;
  readonly chromium: string;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly deviceScaleFactor: number;
}

export interface Mismatch {
  readonly field: keyof Fingerprint;
  readonly expected: string;
  readonly actual: string;
}

export type Decision =
  | { readonly action: 'run' }
  | { readonly action: 'fail'; readonly reason: string }
  | { readonly action: 'skip'; readonly reason: string };

/** Compared as strings so that `viewport` is compared by value rather than by identity. */
function show(value: unknown): string {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

export function compareFingerprint(reference: Fingerprint, actual: Fingerprint): Mismatch[] {
  const fields = Object.keys(reference) as (keyof Fingerprint)[];

  return fields
    .filter((field) => show(reference[field]) !== show(actual[field]))
    .map((field) => ({
      field,
      expected: show(reference[field]),
      actual: show(actual[field]),
    }));
}

export function decide(
  mismatches: readonly Mismatch[],
  env: { readonly ci: boolean },
  reference?: Fingerprint,
): Decision {
  if (mismatches.length === 0) return { action: 'run' };

  const detail = mismatches
    .map((m) => `  ${m.field}: expected ${m.expected}, got ${m.actual}`)
    .join('\n');

  if (env.ci) {
    return {
      action: 'fail',
      reason:
        `This run is not the reference environment, and in CI that is a failure rather than a\n` +
        `skip — a skipped check reads as a satisfied one.\n${detail}\n` +
        `If the image was upgraded deliberately, regenerate the baselines through\n` +
        `visual-baselines.yml and commit the new fingerprint with them.`,
    };
  }

  // The reference image is named, not only the field that differed: a developer reading this has
  // exactly one question — "what am I supposed to be?" — and a diff of `chromium` versions does not
  // answer it.
  const expected = reference === undefined ? '' : `Reference environment: ${reference.image}\n`;

  return {
    action: 'skip',
    reason:
      `Skipping the visual comparison: this machine is not the reference environment.\n` +
      `${expected}${detail}\n` +
      `Baselines are only ever generated inside the CI image (ADR-012 §6). To see what CI sees,\n` +
      `run inside it. A local diff here would be font smoothing, not a regression.`,
  };
}
