/**
 * The shared seam. Both apps build against this package and nothing else crosses the boundary.
 *
 * Only `agent-contracts` writes here — everyone else proposes
 * (`agents/policies/contract-change.md`).
 */
export * from './errors.js';
