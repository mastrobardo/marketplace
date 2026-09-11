-- Rollback of 0006. Destructive and irreversible: the transition ledger is lost, and by design
-- nothing else in the database holds the information needed to rebuild it — the current value of
-- a status column is precisely what a transition record exists to outlive.
--
-- The trigger must go before the table, and the function after it: the function is still
-- referenced while the trigger exists.
DROP TRIGGER IF EXISTS "audit_record_no_update" ON "audit_record";
DROP TABLE IF EXISTS "audit_record";
DROP FUNCTION IF EXISTS audit_record_immutable();
DROP TYPE IF EXISTS "actor_type";
