-- W3-T02 §8.1 — a provider's base address is required.
--
-- Operator's rule, 2026-09-17: the base address is **the centre of the service radius, not where
-- the provider lives**. A null is not "not finished yet" — such a row is excluded from search
-- entirely (W3-T05 AC6) and answered 404 by GET /api/providers/:id, because ProviderProfileSchema
-- requires city, province and a point. The state the schema permitted was one the product could
-- not serve. W3-T02 stops new ones arriving; this forbids the old ones.

-- No backfill, deliberately. SET NOT NULL fails if any row holds a null, which is the 0008
-- precedent: "fails loudly if any row is mixed-case rather than silently normalising it". There is
-- no such row in any environment today — every seeded provider has an address — and if one ever
-- appears, a human should see it rather than have a DELETE written by an agent decide.
ALTER TABLE "provider_profile" ALTER COLUMN "base_address_id" SET NOT NULL;

-- The foreign key has to change with the column, and this is the part that is easy to miss.
--
-- It was ON DELETE SET NULL, which is no longer a legal outcome: deleting the address would ask
-- Postgres to write a null into a NOT NULL column, and the delete would fail with a constraint
-- error naming the column rather than the cause. RESTRICT states the same intent correctly — you
-- cannot delete the address a provider works from while they work from it — and it is the honest
-- behaviour anyway, since the alternative was silently unlisting them.
ALTER TABLE "provider_profile" DROP CONSTRAINT "provider_profile_base_address_id_fkey";

ALTER TABLE "provider_profile" ADD CONSTRAINT "provider_profile_base_address_id_fkey"
    FOREIGN KEY ("base_address_id") REFERENCES "address"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
