/**
 * Shared test factories — the only source of test data in this repo.
 *
 * `memory/repo/conventions.md` (`MEM-2026-09-07-06`) has promised this package since before it
 * existed: one deterministic seed, one set of factories, no ad-hoc fixtures. The point is not to
 * save typing. It is that when `agent-money`'s test fails and `agent-jobs`'s does not, "were they
 * testing the same kind of user?" has an answer.
 *
 * `devDependency` only — nothing under any `src/` may import this, and a test enforces it.
 *
 * Spec: `docs/specs/S1/W1-T09-test-factories.md`.
 */
export * from './sequence.js';
export * from './builders.js';
export * from './persist.js';
