-- W2-T01 §4.1 and §4.2 — reconciling `app_user` with better-auth's `user` model.

-- ADR-005 rule 2: credentials are `account` rows, so this column is dead on arrival. It has never
-- been written — before this migration `password_hash` appeared in exactly one file in the whole
-- repository, `0003_core_identity/migration.sql`, and in no TypeScript at all. So this is a column
-- drop, not a data migration.
--
-- Leaving it would be worse than removing it: a column named `password_hash` sitting next to a real
-- credential store is a thing a future reader will eventually write to.
-- DropColumn
ALTER TABLE "app_user" DROP COLUMN "password_hash";

-- `email_verified` is a *boolean*, and `email_verified_at` stays. ADR-005 calls this out as the one
-- place the decision costs a redundant column: better-auth's `user.emailVerified` is a Boolean,
-- ours is a nullable timestamp, and `fields` renames columns without converting types. The boolean
-- is what the library reads and writes; the timestamp is the audit fact, and answers *when*.
-- AddColumn
ALTER TABLE "app_user" ADD COLUMN "email_verified" BOOLEAN NOT NULL DEFAULT false;

-- The *account's* name. `ClientProfile.display_name` is unchanged and is still "what a provider
-- sees. Not the legal name."
-- AddColumn
ALTER TABLE "app_user" ADD COLUMN "name" TEXT;

-- better-auth's `user.image`. Nullable and unread until there are avatars; it exists because the
-- library's model has it and a missing column is a runtime error on a code path we do not control.
-- AddColumn
ALTER TABLE "app_user" ADD COLUMN "image" TEXT;

-- Backfill before anything reads the new column. `email_verified_at` is the pre-existing truth, so
-- a row that already has one is already verified. Today this touches zero rows in every
-- environment; it is written anyway, because a backfill that is correct when it is a no-op is a
-- backfill that is still correct the first time it is not.
UPDATE "app_user" SET "email_verified" = true WHERE "email_verified_at" IS NOT NULL;

-- ── §4.2 — the email index better-auth can actually use ──────────────────────────────────────
--
-- W1-T05 chose a functional unique index on lower(email) and wrote down the cost in its own
-- migration: "`WHERE email = $1` is valid SQL that compiles, returns nothing for
-- 'Ana@example.com', and does not use this index. Lookups must say `lower(email) = lower($1)`."
--
-- That discipline is enforceable in code we write. better-auth's Prisma adapter issues the plain
-- equality predicate, and it is the only thing that reads this column on the sign-in path — so the
-- functional index was unusable exactly where it mattered most, and every sign-in was a sequential
-- scan on a table an unauthenticated caller can make us scan at will.
--
-- The CHECK is what makes the swap safe rather than a downgrade. A plain UNIQUE on a
-- case-sensitive column would let 'Maria@x.com' and 'maria@x.com' coexist — the precise failure the
-- functional index existed to prevent. With the constraint, mixed case cannot be stored at all, so
-- the plain index is equivalent *and* serves equality.
--
-- It also moves the guarantee out of a dependency. better-auth 1.7.4 lowercases on both sign-up
-- (sign-up.mjs:165) and sign-in (sign-in.mjs:315); a future version that stops doing so gets a
-- constraint violation here instead of silently creating a second account.

-- Fails loudly if any row is mixed-case rather than silently normalising it. There are no rows
-- today; if there ever are, a human should see them before they are rewritten.
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_email_lowercase"
    CHECK ("email" = lower("email"));

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- DropIndex
DROP INDEX "app_user_email_lower_key";
