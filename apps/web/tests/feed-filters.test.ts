/**
 * `W4-T07` §3.3 — the order and the filters, without a DOM.
 *
 * The operator's decision put the filtering in the view (§2.6), so this module is where the product
 * rules of the feed live: what counts as a licence gap, what nearest-first means, and which switch
 * hides what. Pure functions, asserted directly — the same split `quote-ranking.test.ts` made.
 *
 * Spec: `docs/specs/S4/W4-T07-provider-job-feed.md` §5 AC20.
 */
import { describe, expect, it } from 'vitest';
import { type JobFeedItem } from '@marketplace/contracts';

import {
  FEED_SORTS,
  NO_FILTERS,
  filterFeed,
  hasLicenceGap,
  sortFeed,
  tradesIn,
} from '../src/features/jobs/feed.js';
import { FEED_JOB_IDS, demoFeed } from './fixtures/feed.js';

const feed = demoFeed();
const byId = (id: string): JobFeedItem => feed.find((item) => item.id === id) as JobFeedItem;

describe('the sort', () => {
  it('offers exactly the two orders the screen names', () => {
    expect([...FEED_SORTS]).toEqual(['newest', 'nearest']);
  });

  it('leaves the API’s own order alone under "newest"', () => {
    expect(sortFeed(feed, 'newest').map((item) => item.id)).toEqual(feed.map((item) => item.id));
  });

  it('orders by distance under "nearest", and it is a different order', () => {
    const nearest = sortFeed(feed, 'nearest').map((item) => item.id);
    expect(nearest).toEqual([
      FEED_JOB_IDS.near,
      FEED_JOB_IDS.quoted,
      FEED_JOB_IDS.gas,
      FEED_JOB_IDS.far,
    ]);
    expect(nearest).not.toEqual(feed.map((item) => item.id));
  });

  it('does not mutate what it is given', () => {
    const before = feed.map((item) => item.id);
    sortFeed(feed, 'nearest');
    expect(feed.map((item) => item.id)).toEqual(before);
  });
});

describe('the licence gap — §2.2', () => {
  it('is a regulated trade the provider does not list, and nothing else', () => {
    // Gas: `requiresLicence` and not listed. That is the sentence the schema can actually support
    // today, and it is a label rather than a permission.
    expect(hasLicenceGap(byId(FEED_JOB_IDS.gas))).toBe(true);
    expect(hasLicenceGap(byId(FEED_JOB_IDS.quoted))).toBe(false);
  });

  it('is false for an unregulated trade the provider does not list', () => {
    const item: JobFeedItem = {
      ...byId(FEED_JOB_IDS.quoted),
      coverage: [
        {
          slug: 'pintura',
          nameEs: 'Pintura',
          nameEn: 'Painting',
          requiresLicence: false,
          listedByProvider: false,
        },
      ],
    };
    // Quoting outside your listed trades is allowed — `W4-T03`'s rule. Only the *regulated* gap is
    // the one a provider might want to hide.
    expect(hasLicenceGap(item)).toBe(false);
  });
});

describe('the filters', () => {
  it('changes nothing when none is set', () => {
    expect(filterFeed(feed, NO_FILTERS)).toHaveLength(feed.length);
  });

  it('hides the regulated gap when the provider asks it to', () => {
    const shown = filterFeed(feed, { ...NO_FILTERS, hideLicenceGaps: true });
    expect(shown.map((item) => item.id)).not.toContain(FEED_JOB_IDS.gas);
    expect(shown).toHaveLength(feed.length - 1);
  });

  it('hides what the provider has already quoted, and only that', () => {
    const shown = filterFeed(feed, { ...NO_FILTERS, hideQuoted: true });
    expect(shown.map((item) => item.id)).not.toContain(FEED_JOB_IDS.quoted);
    expect(shown).toHaveLength(feed.length - 1);
  });

  it('keeps a job that matches the chosen trade in any of its categories', () => {
    const shown = filterFeed(feed, { ...NO_FILTERS, trade: 'fontaneria' });
    // The gas job asks for plumbing *and* gas, so choosing plumbing keeps it: the job is what a
    // provider quotes, whole (`W4-T03`).
    expect(shown.map((item) => item.id)).toEqual([
      FEED_JOB_IDS.gas,
      FEED_JOB_IDS.far,
      FEED_JOB_IDS.quoted,
    ]);
  });

  it('combines the switches rather than letting the last one win', () => {
    const shown = filterFeed(feed, {
      trade: 'fontaneria',
      hideLicenceGaps: true,
      hideQuoted: true,
    });
    expect(shown.map((item) => item.id)).toEqual([FEED_JOB_IDS.far]);
  });
});

describe('the trade options', () => {
  it('are the trades present in the loaded set, once each, in a settled order', () => {
    expect(tradesIn(feed).map((trade) => trade.slug)).toEqual(['cerrajeria', 'fontaneria', 'gas']);
  });

  it('are empty for an empty feed, so the control has nothing to offer', () => {
    expect(tradesIn([])).toEqual([]);
  });
});
