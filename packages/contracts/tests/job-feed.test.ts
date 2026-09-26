/**
 * `W4-T07` — the feed's shapes, and the two invariants they assert rather than assume.
 *
 * No database and no HTTP: what is asserted here is what the schema refuses. The geography, the
 * paging over real rows and the disclosure rule at the wire are `apps/api/tests/job-feed-live.test.ts`.
 *
 * Spec: `docs/specs/S4/W4-T07-provider-job-feed.md` §3.1, §5.
 */
import { describe, expect, it } from 'vitest';
import {
  JOB_FEED_DEFAULT_SORT,
  JOB_FEED_SORTABLE,
  JobFeedItemSchema,
  JobFeedPageSchema,
  JobFeedQuerySchema,
  PAGE_LIMIT_DEFAULT,
  type JobFeedItem,
} from '../src/index.js';

const JOB_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const QUOTE_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3302';

function item(overrides: Partial<JobFeedItem> = {}): JobFeedItem {
  return {
    id: JOB_ID,
    title: 'Cambiar el termo eléctrico',
    description: 'El termo de 80 litros pierde agua por abajo.',
    categories: [
      { slug: 'fontaneria', nameEs: 'Fontanería', nameEn: 'Plumbing', requiresLicence: false },
    ],
    urgency: 'semana',
    budget: { minCents: null, maxCents: 60000 },
    location: { city: 'Madrid', province: 'Madrid', postalCode: '28013' },
    distanceMetres: 1840,
    coverage: [
      {
        slug: 'fontaneria',
        nameEs: 'Fontanería',
        nameEn: 'Plumbing',
        requiresLicence: false,
        listedByProvider: true,
      },
    ],
    myQuote: null,
    publishedAt: '2026-09-25T09:00:00.000Z',
    createdAt: '2026-09-24T18:00:00.000Z',
    ...overrides,
  };
}

describe('the query — §2.4, §2.5, §2.6', () => {
  it('AC-q1 — pages by publishedAt descending, with the id tiebreaker appended ascending', () => {
    const query = JobFeedQuerySchema.parse({});
    expect(query.sort).toEqual([
      { field: 'publishedAt', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ]);
    expect(query.limit).toBe(PAGE_LIMIT_DEFAULT);
    expect(query.cursor).toBeUndefined();
  });

  it('AC-q2 — names publishedAt as its only sortable field', () => {
    expect([...JOB_FEED_SORTABLE]).toEqual(['publishedAt']);
    expect(JOB_FEED_DEFAULT_SORT).toBe('-publishedAt');
  });

  it('AC12 — refuses ?sort=distanceMetres, and says which field was wrong', () => {
    const parsed = JobFeedQuerySchema.safeParse({ sort: 'distanceMetres' });
    expect(parsed.success).toBe(false);
    const issue = parsed.error?.issues[0];
    expect(issue?.path).toEqual(['sort']);
    expect(issue?.message).toMatch(/distanceMetres/);
  });

  it('AC13 — refuses limit=101 rather than clamping it', () => {
    expect(JobFeedQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(JobFeedQuerySchema.parse({ limit: '100' }).limit).toBe(100);
  });

  it('AC-q3 — declares no filters, so an unknown parameter is a refusal', () => {
    // The operator's decision: the filtering is the screen's (§2.6). A query parameter that is
    // silently ignored is a filter the caller believes in and the server does not apply.
    expect(JobFeedQuerySchema.safeParse({ categorySlug: 'fontaneria' }).success).toBe(false);
    expect(JobFeedQuerySchema.safeParse({ offset: '40' }).success).toBe(false);
  });
});

describe('the row — §2.3, §3.1', () => {
  it('AC-r1 — accepts a row with everything the screen reads', () => {
    expect(JobFeedItemSchema.parse(item())).toEqual(item());
  });

  it('AC-r2 — refuses a null location, although a job may have none', () => {
    // A job with no address cannot have matched a radius, so a null here is a bug in the statement
    // rather than a state of the world. Asserted, not assumed.
    expect(JobFeedItemSchema.safeParse(item({ location: null as never })).success).toBe(false);
  });

  it('AC-r3 — refuses a null publishedAt, although a job may have none', () => {
    expect(JobFeedItemSchema.safeParse(item({ publishedAt: null as never })).success).toBe(false);
  });

  it('AC17 — refuses any field the disclosure rule leaves out', () => {
    for (const leak of [
      { latitude: 40.4168 },
      { longitude: -3.7038 },
      { line1: 'Calle del Arenal 18' },
      { clientId: '11111111-1111-4111-8111-111111111111' },
      { clientName: 'Ana Cliente' },
      { quoteCount: 4 },
    ]) {
      const parsed = JobFeedItemSchema.safeParse({ ...item(), ...leak });
      expect(parsed.success, `${Object.keys(leak)[0] ?? '?'} passed the schema`).toBe(false);
    }
  });

  it('AC-r4 — carries the caller’s own quote, and EXPIRED is one of its states', () => {
    const quoted = item({ myQuote: { id: QUOTE_ID, status: 'EXPIRED' } });
    expect(JobFeedItemSchema.parse(quoted).myQuote).toEqual({ id: QUOTE_ID, status: 'EXPIRED' });
    // Nothing about the offer itself: the provider wrote it, `/me/quotes` serves it.
    expect(
      JobFeedItemSchema.safeParse(
        item({ myQuote: { id: QUOTE_ID, status: 'PENDING', amountCents: 1000 } as never }),
      ).success,
    ).toBe(false);
  });

  it('AC4 — coverage states a regulated trade the provider does not list', () => {
    const parsed = JobFeedItemSchema.parse(
      item({
        coverage: [
          {
            slug: 'gas',
            nameEs: 'Gas',
            nameEn: 'Gas',
            requiresLicence: true,
            listedByProvider: false,
          },
        ],
      }),
    );
    expect(parsed.coverage[0]).toEqual({
      slug: 'gas',
      nameEs: 'Gas',
      nameEn: 'Gas',
      requiresLicence: true,
      listedByProvider: false,
    });
  });
});

describe('the envelope', () => {
  it('AC-e1 — is { items, page }, like every other list in this repo', () => {
    const page = JobFeedPageSchema.parse({
      items: [item()],
      page: { nextCursor: null, hasMore: false },
    });
    expect(page.items).toHaveLength(1);
    expect(page.page).toEqual({ nextCursor: null, hasMore: false });
  });
});
