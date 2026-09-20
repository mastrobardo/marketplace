-- Rollback of 0010.
--
-- Order matters: `job_category` references both `job` and `category`, so it goes first. Dropping
-- `job` while the join table still points at it fails on the foreign key.
--
-- The enums are dropped last, after the columns typed with them are gone. Postgres refuses to drop
-- a type still in use, so a partial rollback leaves a clear error rather than a broken schema.
DROP TABLE IF EXISTS "job_category";

DROP TABLE IF EXISTS "job";

DROP TYPE IF EXISTS "job_urgency";

DROP TYPE IF EXISTS "job_status";

-- Nothing in `category`, `address` or `app_user` is touched. `job` pointed *at* them; none of them
-- gained a column, so there is nothing to restore on the other side.
