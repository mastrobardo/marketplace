-- W4-T04 §2.1 — the two states a client's answer produces.
--
-- `W4-T03` shipped both halves of the presupuesto except the last one: a client could receive
-- quotes and could not answer them. ACCEPTED and REJECTED arrive here, with the routes that can
-- produce them — the rule 0011 followed for the job lifecycle and 0012 restated for this one.
--
-- **Accepting is not awarding** (ADR-013 §4): the award is a payment, so it lives in W4-T05 and is
-- blocked on W5-T02. Nothing here touches `job`, and nothing here moves money.
--
-- Still no EXPIRED. Expiry is arithmetic over `valid_until`, evaluated when a quote is read, and a
-- status that only becomes true once a sweep runs is a status that is wrong between the sweeps.
--
-- **This migration adds the values and nothing else, and the split is forced rather than stylistic.**
-- Postgres refuses to *use* a new enum value in the transaction that added it — `unsafe use of new
-- value "ACCEPTED" of enum type quote_status`, `HINT: New enum values must be committed before they
-- can be used` — and Prisma runs each migration in one transaction. The indexes that name these
-- values are therefore 0014, which cannot run until this one has committed. Verified against
-- Postgres before it was written this way, not assumed.

-- AlterEnum
--
-- Additive: no rebuild, no rewrite, every existing row untouched.
ALTER TYPE "quote_status" ADD VALUE 'ACCEPTED';
ALTER TYPE "quote_status" ADD VALUE 'REJECTED';
