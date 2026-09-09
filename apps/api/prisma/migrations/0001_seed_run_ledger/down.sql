-- Rollback of 0001. The ledger holds only bookkeeping — which seeders have run — so dropping it
-- loses no data that is not re-derivable by seeding again.
--
-- The schema itself is not dropped: `public` predates this migration in every environment.
DROP TABLE IF EXISTS "_seed_run";
