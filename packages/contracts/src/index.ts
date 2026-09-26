/**
 * The shared seam. Both apps build against this package and nothing else crosses the boundary.
 *
 * Only `agent-contracts` writes here — everyone else proposes
 * (`agents/policies/contract-change.md`).
 */
export * from './catalogue.js';
export * from './errors.js';
export * from './job-feed.js';
export * from './job.js';
export * from './money.js';
export * from './pagination.js';
export * from './provider.js';
export * from './quote.js';
export * from './search.js';
export * from './state-machine.js';
