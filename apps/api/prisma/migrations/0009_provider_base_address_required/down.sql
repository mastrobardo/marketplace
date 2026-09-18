-- Rollback of 0009.
--
-- Order matters: the SET NULL foreign key cannot exist while the column is NOT NULL, so the
-- constraint is restored *after* the column is made nullable again.
ALTER TABLE "provider_profile" ALTER COLUMN "base_address_id" DROP NOT NULL;

ALTER TABLE "provider_profile" DROP CONSTRAINT IF EXISTS "provider_profile_base_address_id_fkey";

ALTER TABLE "provider_profile" ADD CONSTRAINT "provider_profile_base_address_id_fkey"
    FOREIGN KEY ("base_address_id") REFERENCES "address"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Rows written while the column was NOT NULL keep their address. Nothing is un-set: the rollback
-- restores what the schema *permits*, not what it happens to hold.
