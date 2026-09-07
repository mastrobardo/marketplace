# Prompt 01 — contract proposal

**Input**: an approved spec.
**Output**: a diff proposal for `packages/contracts/**` and/or `schema.prisma`, reviewed and
applied by `agent-contracts`.
**Next step**: `02-tdd-red.md` — only after the contract is merged.

---

Propose the contract for **<TASK-ID>**. You do not edit the seam yourself unless you are
`agent-contracts` (see `policies/contract-change.md`).

Produce:

1. **zod schemas** — request, response, and shared domain types. Names match the spec's API
   surface exactly.
2. **Prisma models/fields** — types, nullability, defaults, indexes, relations. Money is
   `Int` cents + a currency field. Timestamps are `DateTime` UTC. Geo columns use PostGIS.
3. **Error codes** — added to the shared registry, with the HTTP status each maps to.
4. **Consumer impact** — who else imports what you are touching. Additive or breaking? If
   breaking, stop and write the ADR below.
5. **Migration plan** — expand → backfill → contract. Reversible. How it behaves against seeded
   staging data.

## Post-freeze changes — ADR template
```markdown
# ADR-<n>: <title>
## Status         Proposed | Accepted | Superseded
## Context        what is frozen today, why it no longer works
## Consumers      who imports this, what breaks
## Decision       amend | version | reject
## Migration      expand/backfill/contract steps, deprecation window
## Rollback       how we undo it
## Consequences   what future work this makes easier/harder
```

## Self-check
- [ ] Names identical between spec, zod and Prisma — no synonyms
- [ ] No `any`, no loose `z.record` where a shape is known
- [ ] Every nullable field justified; prefer required + default
- [ ] No money as float, anywhere
- [ ] Generated client compiles for both apps
