-- W0-T05 — PostGIS is a precondition, not something this migration establishes.
--
-- `CREATE EXTENSION` needs rights the application role has in no environment: locally the
-- extension is installed by docker/postgres/init, and on Neon the platform enables it. Asserting
-- it here turns "somebody enabled PostGIS once" into something every environment re-proves on
-- every deploy, and fails the deploy rather than the first geo query.
--
-- Deliberately the first migration: it must stop the run before any table is created.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
        RAISE EXCEPTION 'POSTGIS_MISSING: this database has no PostGIS extension. Run `CREATE EXTENSION postgis;` as a superuser (locally: docker/postgres/init; on Neon: enable it on the branch), then re-run the migration.';
    END IF;
END
$$;
