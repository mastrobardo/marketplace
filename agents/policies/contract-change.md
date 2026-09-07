# Policy — changing the contract

The seam is `packages/contracts/**` and `apps/api/prisma/schema.prisma`. Both apps depend on it,
several agents depend on it at once, and a silent change to it breaks work in progress elsewhere.

**Only `agent-contracts` writes the seam.** Everyone else proposes.

## Before freeze (during spec review)
Propose freely. Use `prompts/01-contract-proposal.md` and put the proposal in your spec. Cheapest
moment to get the shape right — spend the time here.

## After freeze
1. Stop implementing against the shape you wish existed.
2. Open an ADR in `docs/adr/` — `prompts/01` §"post-freeze" has the template.
   State: what's frozen, what you need, who else consumes it, migration and rollback.
3. `agent-contracts` decides: **amend** (additive, no consumer breaks), **version** (`v2` route or
   optional field with a deprecation window), or **reject** (change your implementation instead).
4. Only after the ADR merges does the seam change, and `agent-contracts` makes the edit.

## Additive is free, breaking is not
Optional fields, new endpoints, new enum members at the end: additive, low ceremony.
Renames, type changes, required fields, removals: breaking — they need the ADR and a consumer sweep.

## Generated code is never hand-edited
OpenAPI and the typed client are build outputs. If the generated client is wrong, the zod schema is
wrong. Fix the source. A hand-edit is a review failure.

## Migrations
Reversible. Tested against seeded staging data. Expand → backfill → contract, never a destructive
one-shot. Never edit a migration that has already run anywhere.
