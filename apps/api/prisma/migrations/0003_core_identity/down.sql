-- Rollback of 0003. Dropped in foreign-key-safe order; the CHECK constraints and the functional
-- index go with their tables, so they need no separate statement.
--
-- This is destructive and not recoverable: every account, profile and address is deleted. It
-- exists to unwind a bad deploy on a preview branch, never to be run against staging or
-- production with data in it.
DROP TABLE IF EXISTS "client_profile";
DROP TABLE IF EXISTS "provider_profile";
DROP TABLE IF EXISTS "address";
DROP TABLE IF EXISTS "app_user";
