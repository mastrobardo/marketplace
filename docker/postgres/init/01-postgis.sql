-- Enable PostGIS in the application database at container initialisation.
--
-- This runs once, on an empty data directory, as the superuser. It cannot be a Prisma migration:
-- CREATE EXTENSION needs rights the application role does not have in production either, where
-- Neon enables the extension for us. Keeping it here means the local database and a Neon branch
-- present the same surface to `W0-T05`'s first migration.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;

-- Spain-first (TODO.md §1): geography columns are SRID 4326 and distances come from ST_DWithin
-- on the geography type, never from a projected-metre approximation.
