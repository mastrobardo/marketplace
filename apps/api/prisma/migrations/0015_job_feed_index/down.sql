-- Rollback of 0015. An index carries no data, so this repairs completely: dropping it slows the feed
-- and loses nothing, which is the whole difference between a rollback that can run and 0011's, which
-- refuses because rebuilding an enum would have to rewrite rows.
DROP INDEX "job_feed_open_published_idx";
