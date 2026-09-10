-- Rollback of 0005. Destructive: the category tree and every provider's category list are lost.
-- The tree is re-derivable by re-running W3-T01's seed; a provider's chosen categories are not.
DROP TABLE IF EXISTS "provider_category";
DROP TABLE IF EXISTS "category";
