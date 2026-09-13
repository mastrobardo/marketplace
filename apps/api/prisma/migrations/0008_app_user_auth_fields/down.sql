-- Rollback of 0008.
--
-- The index swap reverses cleanly: the CHECK guarantees every stored address is already lowercase,
-- so `lower(email)` is unique exactly when `email` is, and the functional index can be rebuilt
-- without a conflict. Rebuild it *before* dropping the constraint that makes it safe.
CREATE UNIQUE INDEX "app_user_email_lower_key" ON "app_user" (lower("email"));
DROP INDEX IF EXISTS "app_user_email_key";
ALTER TABLE "app_user" DROP CONSTRAINT IF EXISTS "app_user_email_lowercase";

-- The columns do not reverse cleanly, and only one of them loses anything.
--
-- `email_verified` is redundant with `email_verified_at`, which stays — the pair is kept in step
-- by W2-T01's database hook, so dropping the boolean loses no fact. `name` and `image` are dropped
-- with whatever they held: `name` is the one real loss, and it is better-auth's own field rather
-- than anything W1-T05 designed.
ALTER TABLE "app_user" DROP COLUMN IF EXISTS "image";
ALTER TABLE "app_user" DROP COLUMN IF EXISTS "name";
ALTER TABLE "app_user" DROP COLUMN IF EXISTS "email_verified";

-- Restored nullable, as 0003 had it. It has never been written and never will be — ADR-005 rule 2
-- made `account` the credential store — so this recreates the column, not any data.
ALTER TABLE "app_user" ADD COLUMN "password_hash" TEXT;
