-- Rollback of 0002. Types drop cleanly only once no column uses them, so this must run after
-- 0003's and 0005's down.sql — which is the order the acceptance test applies them in.
DROP TYPE IF EXISTS "locale";
DROP TYPE IF EXISTS "provider_kind";
DROP TYPE IF EXISTS "user_status";
DROP TYPE IF EXISTS "user_role";
