-- W1-T05 §4.1 — the one geography column in the product.
--
-- Kept in its own migration because it is the only part of this task whose interaction with
-- Prisma was not certain in advance: Prisma has no geography type, and a GENERATED column is
-- outside its schema language. If `prisma migrate diff` reports drift after this runs, this
-- folder is the only one that has to change (spec §13 Q4: drop the column, keep lat/lng, and
-- build a functional GIST index over ST_MakePoint instead).
--
-- Why generated rather than a trigger or an application write: Postgres maintains it, so there is
-- no denormalised value that can drift from its source — it *is* its source, computed. Writers
-- keep using the ordinary Prisma client on latitude/longitude and no slice needs raw SQL to save
-- an address; only proximity *reads* go raw, and those were always going to (Prisma cannot
-- express ST_DWithin either).
--
-- ST_MakePoint takes (x, y) — LONGITUDE FIRST. Transposed, every address in Spain lands off the
-- coast of Somalia. Written once, here, and checked by AC-12 against Puerta del Sol.

ALTER TABLE "address"
  ADD COLUMN "location" geography(Point, 4326)
  GENERATED ALWAYS AS (
    ST_SetSRID(ST_MakePoint("longitude"::double precision, "latitude"::double precision), 4326)::geography
  ) STORED;

-- The index every proximity query in the platform reaches: provider search (W3-T05), job matching
-- (W4-T07), emergency broadcast (W7-T02). AC-16 asserts the planner actually uses it, because a
-- GIST index Postgres declines to use looks identical to a working one in pg_indexes.
CREATE INDEX "address_location_gist" ON "address" USING GIST ("location");
