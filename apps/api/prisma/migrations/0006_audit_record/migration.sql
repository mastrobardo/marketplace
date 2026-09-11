-- W1-T07 §8 — the transition ledger.
--
-- The table, the enum and the two indexes below are exactly what
-- `prisma migrate diff --to-schema-datamodel` produced. The CHECK and the trigger are hand-added:
-- Prisma models neither, and both are load-bearing.
--
-- `actor_id` carries NO foreign key. W2-T08 (GDPR erasure) may hard-delete an `app_user` row:
-- ON DELETE CASCADE would erase the ledger of what that user did, and RESTRICT would block the
-- erasure the law requires. Neither is acceptable, so the column stores the uuid and nothing
-- enforces that it still resolves. This is the one place in the schema where a dangling reference
-- is the correct design (spec §8.2).
--
-- `at` has no DEFAULT, also on purpose. The value always comes from the application, so there is
-- one source of truth for when a transition happened. A DEFAULT now() would quietly win whenever
-- a writer forgot the field, and "the timestamps are mostly right" is not a property a ledger can
-- have.

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('USER', 'SYSTEM');

-- CreateTable
CREATE TABLE "audit_record" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "from_state" TEXT NOT NULL,
    "to_state" TEXT NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "metadata" JSONB,
    "at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "audit_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Both indexes end `at DESC, id DESC`: these are list queries, lists in this codebase are
-- keyset-paged (W1-T02), and keyset paging over a non-total order drops rows at page boundaries.
CREATE INDEX "audit_record_entity_at_idx" ON "audit_record"("entity", "entity_id", "at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "audit_record_actor_at_idx" ON "audit_record"("actor_id", "at" DESC, "id" DESC);

-- The two actor columns are one fact and must not disagree. `AuditRecordSchema` says the same
-- thing in zod; this says it at the column, because not every writer will come through the seam.
ALTER TABLE "audit_record"
  ADD CONSTRAINT "audit_record_actor_pairing_check"
  CHECK (("actor_type" = 'SYSTEM') = ("actor_id" IS NULL));

-- Append-only, enforced rather than asserted. "Nobody updates the audit table" is true right up
-- to the first backfill migration, or the first agent fixing what looks like a typo in a
-- `from_state`. A ledger whose rows can be edited is a report, not a ledger.
--
-- This does not break `pnpm db:reset`: `prisma migrate reset` drops the schema and replays the
-- migrations, so the trigger goes with it. Row-level triggers also do not fire on TRUNCATE.
CREATE FUNCTION audit_record_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AUDIT_RECORD_IMMUTABLE: audit_record is append-only (W1-T07 spec §8.3). '
                  'Correct a wrong record by writing a new one, never by editing this one.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_record_no_update
  BEFORE UPDATE OR DELETE ON "audit_record"
  FOR EACH ROW EXECUTE FUNCTION audit_record_immutable();
