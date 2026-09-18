/**
 * The shared shape of a CI gate's decision.
 *
 * A gate is a pure function from facts to a verdict. Nothing in this folder reads `process.env`,
 * shells out, or exits — `run.ts` does all three. That split is what makes the interesting half
 * testable without a git repository, a pull request, or a network.
 */

/** Machine-readable failures. The code is the first token of the message, so logs are greppable. */
export type GateCode =
  'SPEC_MISSING' | 'SPEC_UNPAIRED' | 'INTERVENTION_UNLOGGED' | 'AUTHOR_IDENTITY' | 'AGENTS_DRIFT';

export interface GateResult {
  /** True when the gate passes. A gate that does not apply also passes — see `skipped`. */
  readonly ok: boolean;
  /** Set only when `ok` is false. */
  readonly code: GateCode | null;
  /** Human-readable, multi-line, and written for whoever is staring at a red check. */
  readonly message: string;
  /**
   * True when the gate had nothing to judge — a branch with no task ID, a PR with no
   * `intervention:*` label. Distinct from a pass, so CI can say "not applicable" rather than
   * claiming it verified something it never looked at.
   */
  readonly skipped: boolean;
}

export function pass(message: string): GateResult {
  return { ok: true, code: null, message, skipped: false };
}

export function skip(message: string): GateResult {
  return { ok: true, code: null, message, skipped: true };
}

export function fail(code: GateCode, message: string): GateResult {
  return { ok: false, code, message: `${code}: ${message}`, skipped: false };
}
