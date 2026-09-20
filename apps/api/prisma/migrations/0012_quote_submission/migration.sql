-- W4-T03 §2 — a presupuesto, and the answer to the question W4-T01 left open.
--
-- **One quote for the whole job.** Operator, 2026-09-20: *"1 quote for everything. […] It would be
-- also too chaotic for a user accepting X presupuestos: i look to remodel a bathroom, i want a quick
-- way to get the job done."* So there is no link from `quote` to `job_category`, and no per-trade
-- price: a quote answers the job, all of it.
--
-- Which of the job's trades the quoting provider actually lists is **computed at read time**, shown
-- to the client, and enforces nothing — *"Nothing enforces, but stated clearly."* (§2.3). No column
-- here records it, because it is a fact about two other tables at the moment somebody asks.
--
-- `quote_status` holds two values, not four: W4-T04 owns ACCEPTED/REJECTED and adds them with the
-- routes that can reach them, the same rule 0011 followed for the job lifecycle.

-- CreateEnum
CREATE TYPE "quote_status" AS ENUM ('PENDING', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "quote" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "provider_id" UUID NOT NULL,
    "status" "quote_status" NOT NULL DEFAULT 'PENDING',
    "amount_cents" INTEGER NOT NULL,
    "breakdown" TEXT,
    "valid_until" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_pkey" PRIMARY KEY ("id")
);

-- A price is a non-negative integer number of cents. Free work is expressible; owing the client
-- money is not, and a negative here would reach a client as a number they cannot act on.
ALTER TABLE "quote" ADD CONSTRAINT "quote_amount_cents_check" CHECK ("amount_cents" >= 0);

-- CreateIndex
CREATE INDEX "quote_job_created_idx" ON "quote"("job_id", "created_at" DESC, "id" DESC);

CREATE INDEX "quote_provider_created_idx" ON "quote"("provider_id", "created_at" DESC, "id" DESC);

-- **One active quote per provider per job**, which the slice's own rules require to live here and
-- not only in the service.
--
-- Partial, and that is the whole point: a plain UNIQUE (job_id, provider_id) would mean a provider
-- who withdrew a quote could never quote that job again — a permanent bar discovered later by a
-- support ticket. `WHERE status = 'PENDING'` lets a withdrawn row stay as history while the next
-- attempt is free to exist. Prisma cannot express a partial index, so this is hand-written and the
-- schema documents it in `Quote`.
CREATE UNIQUE INDEX "quote_one_active_per_provider_idx" ON "quote"("job_id", "provider_id")
    WHERE "status" = 'PENDING';

-- AddForeignKey
--
-- Cascade from both owners: a deleted job has no quotes to answer it, and a deleted provider
-- profile has no author. Neither is a row worth orphaning — unlike `audit_record`, which keeps its
-- history precisely because the actor may be erased (0006).
ALTER TABLE "quote" ADD CONSTRAINT "quote_job_id_fkey" FOREIGN KEY ("job_id")
    REFERENCES "job"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quote" ADD CONSTRAINT "quote_provider_id_fkey" FOREIGN KEY ("provider_id")
    REFERENCES "provider_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
