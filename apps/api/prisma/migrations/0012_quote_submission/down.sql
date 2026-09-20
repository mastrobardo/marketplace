-- Rollback of 0012.
--
-- `quote` owns every object created here — two plain indexes, one partial unique index and two
-- foreign keys all belong to the table, so dropping it takes them with it. Nothing else in the
-- schema gained a column: `job` and `provider_profile` were pointed *at*, never altered.
DROP TABLE IF EXISTS "quote";

-- After the table, because Postgres refuses to drop a type a column still uses. A partial rollback
-- therefore stops with a clear error rather than leaving a half-dropped schema — 0010's rule.
DROP TYPE IF EXISTS "quote_status";
