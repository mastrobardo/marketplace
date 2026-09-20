/**
 * A job and the quotes on it — `W4-T04`'s fixture.
 *
 * One definition, used by the harness's default stub and by the tests that override it, for the
 * reason `W12-T08` spent a whole task on: a component test that invents four plausible quotes is
 * how the second source of test data starts.
 *
 * The rows are the ones the screen has branches for, mirroring what `W3-T10` did for search:
 * an **unrated** provider (the cold-start sort), a **cheapest quote that is not the best rated**
 * (or "never hidden" demonstrates nothing), an **incomplete coverage** row, and an **expired** one.
 */
import { type Job, type Quote } from '@marketplace/contracts';

export const DEMO_JOB_ID = 'c1c1c1c1-1111-4111-8111-c1c1c1c1c1c1';

const CATEGORIES = [
  { slug: 'fontaneria', nameEs: 'Fontanería', nameEn: 'Plumbing', requiresLicence: false },
  { slug: 'electricidad', nameEs: 'Electricidad', nameEn: 'Electrical', requiresLicence: true },
];

export function demoJob(overrides: Partial<Job> = {}): Job {
  return {
    id: DEMO_JOB_ID,
    status: 'OPEN',
    title: 'Reforma del baño',
    description: 'Alicatado, fontanería y un punto de luz nuevo.',
    categories: CATEGORIES,
    location: null,
    urgency: null,
    budgetRange: null,
    deadlineAt: null,
    publishedAt: '2026-09-18T09:00:00.000Z',
    cancelledAt: null,
    createdAt: '2026-09-18T08:00:00.000Z',
    updatedAt: '2026-09-18T09:00:00.000Z',
    ...overrides,
  } as Job;
}

function quote(
  n: number,
  fields: {
    displayName: string;
    amountCents: number;
    ratingAvg: number | null;
    ratingCount: number;
    status?: Quote['status'];
    listsElectrical?: boolean;
  },
): Quote {
  return {
    id: `d${String(n).repeat(7)}-1111-4111-8111-dddddddddddd`,
    jobId: DEMO_JOB_ID,
    status: fields.status ?? 'PENDING',
    amountCents: fields.amountCents,
    breakdown: null,
    validUntil:
      fields.status === 'EXPIRED' ? '2026-09-01T00:00:00.000Z' : '2026-12-01T00:00:00.000Z',
    provider: {
      id: `e${String(n).repeat(7)}-1111-4111-8111-eeeeeeeeeeee`,
      displayName: fields.displayName,
      ratingAvg: fields.ratingAvg,
      ratingCount: fields.ratingCount,
      hourlyRateCents: null,
    },
    coverage: CATEGORIES.map((category) => ({
      ...category,
      listedByProvider: category.slug === 'electricidad' ? (fields.listsElectrical ?? true) : true,
    })),
    createdAt: `2026-09-${String(10 + n).padStart(2, '0')}T10:00:00.000Z`,
    updatedAt: `2026-09-${String(10 + n).padStart(2, '0')}T10:00:00.000Z`,
  };
}

export function demoQuotes(): Quote[] {
  return [
    // Best rated, and **not** the cheapest — which is what makes the "cheapest is never hidden"
    // rule observable rather than vacuous.
    quote(1, {
      displayName: 'Reformas Ruiz',
      amountCents: 480000,
      ratingAvg: 4.8,
      ratingCount: 31,
    }),
    // The cheapest, mid-rated, and it does not list the licensed trade the job asks for.
    quote(2, {
      displayName: 'Obras Delgado',
      amountCents: 310000,
      ratingAvg: 3.6,
      ratingCount: 8,
      listsElectrical: false,
    }),
    // Cold start: no reviews yet, which is not a zero and must not sort as one.
    quote(3, {
      displayName: 'Manitas Rivas',
      amountCents: 395000,
      ratingAvg: null,
      ratingCount: 0,
    }),
    // Lapsed: cheaper than everything and cannot be accepted.
    quote(4, {
      displayName: 'Construcciones Vela',
      amountCents: 250000,
      ratingAvg: 4.9,
      ratingCount: 12,
      status: 'EXPIRED',
    }),
  ];
}
