-- W4-T01 §2 — a job, and the two states it can be in before anyone quotes.
--
-- Almost every column is nullable, and that is the design. The operator's rule, 2026-09-20: *"The
-- fields reqiured are minimal, as more info could be asked / posted later. A user should be able to
-- complete a minimal flow even with missing parameters. I dont want to policy the users."* A DRAFT
-- therefore requires nothing but an owner.
--
-- The single requirement — at least one category — is **not** in this file. It is a guard on the
-- DRAFT → OPEN transition (`jobMachine` in @marketplace/contracts), because a NOT NULL here would
-- make a draft impossible, and a draft is the whole point. See W4-T01 §2.3.
--
-- `job_status` holds two values, not six: W4-T02 owns AWARDED/IN_PROGRESS/COMPLETED/CANCELLED and
-- adds them with `ALTER TYPE ... ADD VALUE` when it ships the routes that can reach them.
--
-- `job_category` is many-to-many because a bathroom is not one trade — tiles, plumbing and
-- electricity are three. It mirrors `provider_category` exactly.

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('DRAFT', 'OPEN');

-- CreateEnum
CREATE TYPE "job_urgency" AS ENUM ('urgente', 'hoy', 'semana', 'flexible');

-- CreateTable
CREATE TABLE "job" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT,
    "description" TEXT,
    "urgency" "job_urgency",
    "budget_min_cents" INTEGER,
    "budget_max_cents" INTEGER,
    "address_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_category" (
    "job_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_category_pkey" PRIMARY KEY ("job_id","category_id")
);

-- CreateIndex
CREATE INDEX "job_client_created_idx" ON "job"("client_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "job_status_created_idx" ON "job"("status", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "job_category_category_idx" ON "job_category"("category_id");

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_address_id_fkey" FOREIGN KEY ("address_id") REFERENCES "address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_category" ADD CONSTRAINT "job_category_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_category" ADD CONSTRAINT "job_category_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

