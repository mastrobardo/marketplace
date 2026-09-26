/**
 * The feed a provider reads — `W4-T07`'s fixture.
 *
 * One definition, used by the harness's default stub and by the tests that override it, for the
 * reason `W12-T08` spent a whole task on: a component test that invents four plausible jobs is how
 * the second source of test data starts.
 *
 * The rows are the branches the screen has, which is the same discipline `fixtures/quotes.ts`
 * follows: a **plain match**, a **regulated trade the provider does not list** (the label that
 * replaced the gate), a job **already quoted** by the reader, and one **much further away** so that
 * nearest-first is a different order from newest-first. A fixture where the two orders agree proves
 * nothing about either.
 */
import { type JobCategory, type JobFeedItem } from '@marketplace/contracts';

const PLUMBING = {
  slug: 'fontaneria',
  nameEs: 'Fontanería',
  nameEn: 'Plumbing',
  requiresLicence: false,
} as const;

const GAS = { slug: 'gas', nameEs: 'Gas', nameEn: 'Gas', requiresLicence: true } as const;

const LOCKS = {
  slug: 'cerrajeria',
  nameEs: 'Cerrajería',
  nameEn: 'Locksmith',
  requiresLicence: false,
} as const;

export const FEED_JOB_IDS = {
  near: 'aaaa1111-1111-4111-8111-aaaa11111111',
  gas: 'bbbb2222-2222-4222-8222-bbbb22222222',
  quoted: 'cccc3333-3333-4333-8333-cccc33333333',
  far: 'dddd4444-4444-4444-8444-dddd44444444',
} as const;

function item(fields: {
  id: string;
  title: string;
  categories: readonly JobCategory[];
  listed: readonly string[];
  distanceMetres: number;
  publishedAt: string;
  myQuote?: JobFeedItem['myQuote'];
}): JobFeedItem {
  return {
    id: fields.id,
    title: fields.title,
    description: null,
    categories: [...fields.categories],
    urgency: null,
    budget: { minCents: null, maxCents: null },
    location: { city: 'Madrid', province: 'Madrid', postalCode: '28013' },
    distanceMetres: fields.distanceMetres,
    coverage: fields.categories.map((category) => ({
      ...category,
      listedByProvider: fields.listed.includes(category.slug),
    })),
    myQuote: fields.myQuote ?? null,
    publishedAt: fields.publishedAt,
    createdAt: fields.publishedAt,
  };
}

/** Newest first, which is the order the API serves. */
export function demoFeed(): JobFeedItem[] {
  return [
    item({
      id: FEED_JOB_IDS.gas,
      title: 'Radiadores y caldera',
      categories: [PLUMBING, GAS],
      // Gas is regulated and not listed: the licence gap, stated and not withheld.
      listed: ['fontaneria'],
      distanceMetres: 5400,
      publishedAt: '2026-09-25T18:00:00.000Z',
    }),
    item({
      id: FEED_JOB_IDS.far,
      title: 'Grifo del jardín',
      categories: [PLUMBING],
      listed: ['fontaneria'],
      // The furthest, and the second newest — so nearest-first cannot be newest-first.
      distanceMetres: 12_800,
      publishedAt: '2026-09-25T09:00:00.000Z',
    }),
    item({
      id: FEED_JOB_IDS.quoted,
      title: 'Cambiar el termo eléctrico',
      categories: [PLUMBING],
      listed: ['fontaneria'],
      distanceMetres: 1840,
      publishedAt: '2026-09-24T09:00:00.000Z',
      myQuote: { id: 'eeee5555-5555-4555-8555-eeee55555555', status: 'PENDING' },
    }),
    item({
      id: FEED_JOB_IDS.near,
      title: 'Cerradura forzada',
      categories: [LOCKS],
      listed: ['cerrajeria'],
      distanceMetres: 900,
      publishedAt: '2026-09-23T09:00:00.000Z',
    }),
  ];
}
