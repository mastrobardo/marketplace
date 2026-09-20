-- Rollback of 0011.
--
-- Postgres cannot drop a value from an enum, so the type is rebuilt without it. That is only safe
-- while nothing holds the value, which is why this refuses rather than repairs.
--
-- **It fails loudly on data instead of rewriting it.** Silently moving cancelled jobs back to DRAFT
-- would republish work their owners abandoned, and the `audit_record` rows would still say CANCEL —
-- a rollback that leaves the history and the column contradicting each other. 0010 set the same
-- rule: a partial rollback leaves a clear error rather than a broken schema.
DO $$
DECLARE
  stuck bigint;
BEGIN
  SELECT count(*) INTO stuck FROM "job" WHERE "status" = 'CANCELLED';
  IF stuck > 0 THEN
    RAISE EXCEPTION
      'cannot roll back 0011: % job row(s) are CANCELLED. Decide what they become — there is no '
      'honest automatic answer — then re-run this rollback.', stuck;
  END IF;
END $$;

ALTER TABLE "job" DROP COLUMN IF EXISTS "cancelled_at";

-- Rebuild `job_status` without CANCELLED. The default is dropped first because it is typed by the
-- enum being replaced, and restored afterwards; `job.status` is the only column of this type.
ALTER TYPE "job_status" RENAME TO "job_status_old";

CREATE TYPE "job_status" AS ENUM ('DRAFT', 'OPEN');

ALTER TABLE "job" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "job" ALTER COLUMN "status" TYPE "job_status" USING "status"::text::"job_status";

ALTER TABLE "job" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

DROP TYPE "job_status_old";

-- `audit_record` is untouched. The CANCEL rows it holds are history, and history does not roll
-- back — they record that a transition happened, which remains true whatever the schema says now.
