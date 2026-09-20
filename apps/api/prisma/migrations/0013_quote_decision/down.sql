-- Rollback of 0013. Run **after** 0014's rollback, which drops the indexes naming these values.
--
-- Postgres cannot drop a value from an enum, so the type is rebuilt without the two. That is only
-- safe while nothing holds them, which is why this refuses rather than repairs — 0010 and 0011 set
-- the rule and this follows it.
--
-- **It fails loudly on data instead of rewriting it.** Silently moving an accepted quote back to
-- PENDING would reopen an offer the client had already taken, while the `audit_record` rows would
-- still say ACCEPT — a rollback leaving the history and the column contradicting each other. There
-- is no honest automatic answer, so a human gives one.
DO $$
DECLARE
  decided bigint;
BEGIN
  SELECT count(*) INTO decided FROM "quote" WHERE "status" IN ('ACCEPTED', 'REJECTED');
  IF decided > 0 THEN
    RAISE EXCEPTION
      'cannot roll back 0013: % quote row(s) are ACCEPTED or REJECTED. Decide what they become — '
      'there is no honest automatic answer — then re-run this rollback.', decided;
  END IF;
END $$;

-- Rebuild `quote_status` without the two. The default is dropped first because it is typed by the
-- enum being replaced, and restored afterwards; `quote.status` is the only column of this type.
ALTER TYPE "quote_status" RENAME TO "quote_status_old";

CREATE TYPE "quote_status" AS ENUM ('PENDING', 'WITHDRAWN');

ALTER TABLE "quote" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "quote" ALTER COLUMN "status" TYPE "quote_status" USING "status"::text::"quote_status";

ALTER TABLE "quote" ALTER COLUMN "status" SET DEFAULT 'PENDING';

DROP TYPE "quote_status_old";

-- `audit_record` is untouched. The ACCEPT and REJECT rows it holds are history, and history does not
-- roll back — they record that a transition happened, which remains true whatever the schema says.
