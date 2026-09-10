-- W1-T05 §5.5–§5.6 — the service tree, and what a provider will do.
--
-- Exactly what `prisma migrate diff --to-schema-datamodel` produced.
--
-- `requires_licence` is stored per node and is NOT inherited from the parent. Inheritance is the
-- tidier model and the wrong one: it makes "does this job legally need a licensed professional?"
-- depend on a recursive walk a query can get wrong, and the cost of getting it wrong is an
-- unlicensed handyman on a gas job. Explicit per node means
-- `SELECT slug FROM category WHERE requires_licence` answers the compliance question completely.
--
-- Depth is limited to two levels, and that rule lives in W3-T01's seed rather than in a trigger
-- here — machinery guarding a rule the application already controls is machinery nobody
-- remembers (spec §5.5).

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name_es" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "parent_id" UUID,
    "requires_licence" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_category" (
    "provider_profile_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_category_pkey" PRIMARY KEY ("provider_profile_id","category_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "category_slug_key" ON "category"("slug");

-- CreateIndex
CREATE INDEX "category_parent_id_position_idx" ON "category"("parent_id", "position");

-- CreateIndex
CREATE INDEX "provider_category_category_idx" ON "provider_category"("category_id");

-- AddForeignKey
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_category" ADD CONSTRAINT "provider_category_provider_profile_id_fkey" FOREIGN KEY ("provider_profile_id") REFERENCES "provider_profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_category" ADD CONSTRAINT "provider_category_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
