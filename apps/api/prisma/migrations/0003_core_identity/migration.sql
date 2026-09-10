-- W1-T05 §5.1–§5.4 — an account, the two profiles it can wear, and an address book.
--
-- The CREATE TABLE / CREATE INDEX / ADD FOREIGN KEY statements are exactly what
-- `prisma migrate diff --to-schema-datamodel` produced, so `migrate diff` reports no drift.
-- What Prisma cannot express is at the bottom, marked: a functional unique index and three CHECKs.
--
-- All four tables land together because their foreign keys are mutually entangled — address points
-- at app_user, and both profiles point at address — so any finer split leaves a dangling reference.
--
-- `app_user`, not `user`: `user` is a Postgres keyword and an unquoted `SELECT ... FROM user`
-- does not fail, it silently resolves to `current_user` and returns a row. A name that turns a
-- typo into wrong data rather than an error is not worth the tidier spelling.

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(3),
    "phone" TEXT,
    "phone_verified_at" TIMESTAMPTZ(3),
    "password_hash" TEXT,
    "roles" "user_role"[] DEFAULT ARRAY['CLIENT']::"user_role"[],
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "locale" "locale" NOT NULL DEFAULT 'ES',
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_profile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "default_address_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_profile" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" "provider_kind" NOT NULL,
    "display_name" TEXT NOT NULL,
    "bio" TEXT,
    "base_address_id" UUID,
    "service_radius_metres" INTEGER,
    "hourly_rate_cents" INTEGER,
    "rating_avg" DECIMAL(3,2),
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "address" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "label" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'ES',
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "address_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_user_phone_key" ON "app_user"("phone");

-- CreateIndex
CREATE INDEX "app_user_created_at_id_idx" ON "app_user"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "app_user_status_idx" ON "app_user"("status");

-- CreateIndex
CREATE UNIQUE INDEX "client_profile_user_id_key" ON "client_profile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_profile_user_id_key" ON "provider_profile"("user_id");

-- CreateIndex
CREATE INDEX "provider_profile_base_address_idx" ON "provider_profile"("base_address_id");

-- CreateIndex
CREATE INDEX "provider_profile_rating_id_idx" ON "provider_profile"("rating_avg" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "provider_profile_kind_idx" ON "provider_profile"("kind");

-- CreateIndex
CREATE INDEX "address_user_id_idx" ON "address"("user_id");

-- AddForeignKey
ALTER TABLE "client_profile" ADD CONSTRAINT "client_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_profile" ADD CONSTRAINT "client_profile_default_address_id_fkey" FOREIGN KEY ("default_address_id") REFERENCES "address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_profile" ADD CONSTRAINT "provider_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_profile" ADD CONSTRAINT "provider_profile_base_address_id_fkey" FOREIGN KEY ("base_address_id") REFERENCES "address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "address" ADD CONSTRAINT "address_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ------------------------------------------------------------------------------------------- --
-- Beyond Prisma's schema language. Everything below is hand-written and invisible to the
-- datamodel; if `migrate diff` ever starts reporting these as drift, that is the signal to
-- revisit spec §13 Q4/Q5 rather than to delete them.
-- ------------------------------------------------------------------------------------------- --

-- Case-insensitive account identity without the citext extension (spec §13 Q5). The extension
-- would need rights the application role has in no environment, making it a human step in four.
-- The cost is discipline: `WHERE email = $1` is valid SQL that compiles, returns nothing for
-- 'Ana@example.com', and does not use this index. Lookups must say `lower(email) = lower($1)`.
CREATE UNIQUE INDEX "app_user_email_lower_key" ON "app_user" (lower("email"));

-- ES postal codes are exactly five digits (the market is Spain only, TODO.md §1).
ALTER TABLE "address"
  ADD CONSTRAINT "address_postal_code_check" CHECK ("postal_code" ~ '^[0-9]{5}$');

-- Metres, not kilometres, because ST_DWithin on geography takes metres. 200 km is past any
-- honest "I travel to you" claim and catches a value entered in the wrong unit.
ALTER TABLE "provider_profile"
  ADD CONSTRAINT "provider_profile_radius_check"
  CHECK ("service_radius_metres" > 0 AND "service_radius_metres" <= 200000);

-- Integer cents, never negative (W1-T06).
ALTER TABLE "provider_profile"
  ADD CONSTRAINT "provider_profile_hourly_rate_check" CHECK ("hourly_rate_cents" >= 0);
