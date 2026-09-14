-- Rollback of 0007. Destructive and irreversible: every session, every credential and every
-- outstanding verification token is lost.
--
-- Sessions and tokens are recoverable by the user — sign in again, ask for a new link. Credentials
-- are **not**: `account.password` is the only copy of a password hash anywhere in the system
-- (ADR-005 rule 2 moved it off `app_user` precisely so there is one home for it). Running this
-- means every account has to go through a password reset, which itself needs the `verification`
-- table this drops.
--
-- Order matters: both foreign keys point at `app_user`, so the children go first.
DROP TABLE IF EXISTS "verification";
DROP TABLE IF EXISTS "account";
DROP TABLE IF EXISTS "session";
