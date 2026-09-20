-- Rollback of 0014. Run this **before** 0013's rollback: these indexes name the values that one
-- removes, and an index outliving the enum value in its predicate is not a schema Postgres will let
-- you have.
--
-- Unlike 0013 this repairs rather than refuses, because it can: dropping a constraint never
-- invalidates data, and the narrower predicate 0012 wrote is satisfied by every row that satisfies
-- the wider one.
DROP INDEX "quote_one_accepted_per_job_idx";

DROP INDEX "quote_one_active_per_provider_idx";

CREATE UNIQUE INDEX "quote_one_active_per_provider_idx" ON "quote"("job_id", "provider_id")
    WHERE "status" = 'PENDING';
