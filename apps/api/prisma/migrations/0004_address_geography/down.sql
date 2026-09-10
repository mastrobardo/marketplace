-- Rollback of 0004. Loses nothing: `location` is derived from latitude/longitude, which survive,
-- so re-applying the migration reconstructs every value exactly.
DROP INDEX IF EXISTS "address_location_gist";
ALTER TABLE "address" DROP COLUMN IF EXISTS "location";
