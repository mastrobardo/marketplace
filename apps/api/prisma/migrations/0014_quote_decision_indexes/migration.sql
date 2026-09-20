-- W4-T04 §2.3, §2.4 — the two rules that had to wait for 0013 to commit.
--
-- Separate from 0013 because Postgres refuses to use a new enum value in the transaction that added
-- it, and Prisma runs one migration per transaction. See 0013's header.

-- **One active quote per provider per job**, with ACCEPTED now counting as active.
--
-- 0012 wrote this predicate as `status = 'PENDING'` and named the decision it was deferring: the
-- predicate changes meaning the moment W4-T04 adds states (MEM-2026-09-20-22). This is that
-- decision, made explicitly, and it is three of them:
--
--   - WITHDRAWN stays **out**. Revising a quote is withdraw-then-resubmit, and a plain unique
--     constraint would have made a withdrawn quote a permanent bar on ever quoting that job again.
--   - REJECTED is **out**. Operator, 2026-09-20: a rejection is *"not this offer"*, not *"not you"*,
--     so a provider who was too expensive may come back cheaper — which is the competition the
--     client opened the job for. The cost is recorded honestly in the spec: nothing rate-limits
--     resubmission, and W5-T08's allowance metering is the mechanism that eventually will.
--   - ACCEPTED is **in**, and this is not a second product decision — it is what "one active quote"
--     already meant. Without it a provider could hold the live offer on a job and submit a competing
--     PENDING one alongside it.
DROP INDEX "quote_one_active_per_provider_idx";

CREATE UNIQUE INDEX "quote_one_active_per_provider_idx" ON "quote"("job_id", "provider_id")
    WHERE "status" IN ('PENDING', 'ACCEPTED');

-- **One accepted quote per job**, in the database rather than only in the service.
--
-- Two clicks that arrive together are a race the service loses and the index does not. *"Enforced in
-- the DB, not only in the service"* is this slice's own non-negotiable, and it applies to the second
-- rule as much as to the first.
--
-- A job may carry any number of PENDING, WITHDRAWN and REJECTED quotes, and exactly one acceptance.
CREATE UNIQUE INDEX "quote_one_accepted_per_job_idx" ON "quote"("job_id")
    WHERE "status" = 'ACCEPTED';
