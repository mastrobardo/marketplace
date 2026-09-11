/**
 * The world the mock endpoints answer from — built **from** `packages/testing`, never beside it.
 *
 * ADR-011 §4 is explicit about why this file may not contain a single hand-written provider:
 * *"the storefront fixtures are built from the factories, never alongside them. A second fixture set
 * that drifts from the first is the failure mode that gate exists to prevent, and a front end built
 * in isolation is the most likely place to introduce one."* `W12-T09`…`W12-T13` are that front end.
 *
 * Everything below is therefore a builder call with overrides. `buildProviderProfile({ kind: 'PRO' })`
 * is using the factory; `{ id: '…', kind: 'PRO', … }` would be starting the second fixture set.
 * `tests/mocks.test.ts` AC13 checks the ids for the factory's per-entity prefix, which a literal
 * row cannot forge by accident.
 *
 * This directory is a sibling of `src/` and not a child of it, deliberately — see `browser.ts`.
 */
import {
  buildAddress,
  buildCategory,
  buildProviderCategory,
  buildProviderProfile,
  resetFactories,
  type AddressInput,
  type CategoryInput,
  type ProviderProfileInput,
} from '@marketplace/testing';

/** Puerta del Sol — the factory's own default, and the centre everything else is offset from. */
export const SOL = { latitude: 40.416775, longitude: -3.70379 } as const;

/**
 * The few places a visitor can type before `GET /places/suggest` exists (`W3-T06`).
 *
 * A mock has to answer "where is 28013?" somehow, and the honest options are a geocoder we are not
 * paying for yet or a short table. The table is short on purpose: it is a stand-in with an expiry
 * date, not the beginning of a postcode database.
 */
const PLACES: Record<string, { latitude: number; longitude: number }> = {
  '28013': SOL,
  '28004': { latitude: 40.4239, longitude: -3.7018 },
  '28010': { latitude: 40.4312, longitude: -3.6997 },
  madrid: SOL,
  chamberi: { latitude: 40.4361, longitude: -3.7038 },
  valencia: { latitude: 39.4699, longitude: -0.3763 },
};

/** Unknown input falls back to Sol rather than erroring: `where` is free text by contract. */
export function locate(where: string): { latitude: number; longitude: number } {
  const key = where.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return PLACES[key] ?? SOL;
}

export interface CatalogueProvider {
  profile: ProviderProfileInput;
  address: AddressInput;
  categorySlugs: string[];
  /**
   * Carried beside the profile, not inside it, because `ProviderProfileInput` has no `ratingAvg`:
   * the builder predates the column (`W1-T09` vs `schema.prisma:137`). Widening the factory is
   * `agent-contracts`' change, not this task's — so the gap is visible here rather than hidden
   * behind a cast. Noted in the run record as the one thing a reviewer should look at.
   */
  ratingAvg: number | null;
  /**
   * Same reason, opposite problem: the builder types this as `number`, the column is `Int?`, and
   * null is the quote-only provider the `?mode=booking` filter exists to exclude.
   */
  hourlyRateCents: number | null;
}

export interface Catalogue {
  categories: CategoryInput[];
  providers: CatalogueProvider[];
}

/** Metres per degree of latitude. Good to a fraction of a percent, and this is a mock. */
const METRES_PER_DEGREE = 111_320;

/** An offset in metres from Sol, so the seeded providers are not all on one pin. */
function near(
  metresNorth: number,
  metresEast: number,
): Pick<AddressInput, 'latitude' | 'longitude'> {
  const latitude = SOL.latitude + metresNorth / METRES_PER_DEGREE;
  const longitude =
    SOL.longitude + metresEast / (METRES_PER_DEGREE * Math.cos((SOL.latitude * Math.PI) / 180));
  return { latitude, longitude };
}

/** Great-circle metres. The mock's stand-in for `ST_Distance` on geography. */
export function distanceMetres(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const φ1 = toRad(a.latitude);
  const φ2 = toRad(b.latitude);
  const dφ = toRad(b.latitude - a.latitude);
  const dλ = toRad(b.longitude - a.longitude);
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.asin(Math.min(1, Math.sqrt(h))));
}

/**
 * The seeded world, rebuilt from a clean sequence on every call.
 *
 * `resetFactories()` first, so the ids are the same on every boot of the dev server and a screenshot
 * taken on Tuesday still matches the one in the pull request. That determinism is the whole reason
 * `packages/testing` is a counter and not a PRNG.
 */
export function buildCatalogue(): Catalogue {
  resetFactories();

  const categories = [
    buildCategory({ slug: 'fontaneria', nameEs: 'Fontanería', nameEn: 'Plumbing', position: 1 }),
    buildCategory({
      slug: 'electricidad',
      nameEs: 'Electricidad',
      nameEn: 'Electrical',
      // The legal flag is not decoration: `W3-T01` is blocked on a human answer about which trades
      // legally require a licence in ES, and a mock that says `false` everywhere would let the
      // storefront ship a badge-less results card that looks finished.
      requiresLicence: true,
      position: 2,
    }),
    buildCategory({ slug: 'cerrajeria', nameEs: 'Cerrajería', nameEn: 'Locksmith', position: 3 }),
    buildCategory({
      slug: 'climatizacion',
      nameEs: 'Climatización',
      nameEn: 'Heating & cooling',
      position: 4,
    }),
  ];

  const seed: {
    displayName: string;
    kind: ProviderProfileInput['kind'];
    slugs: string[];
    ratingAvg: number | null;
    ratingCount: number;
    hourlyRateCents: number | null;
    offset: [number, number];
    city: string;
  }[] = [
    {
      displayName: 'Fontanería Gómez',
      kind: 'PRO',
      slugs: ['fontaneria'],
      ratingAvg: 4.7,
      ratingCount: 31,
      hourlyRateCents: 4_200,
      offset: [400, 250],
      city: 'Madrid',
    },
    {
      displayName: 'Electricidad Nadal',
      kind: 'PRO',
      slugs: ['electricidad', 'climatizacion'],
      ratingAvg: 4.2,
      ratingCount: 12,
      // Quote-only: the case `?mode=booking` has to exclude, and the case a results card that
      // assumes a price will render as "€NaN/h".
      hourlyRateCents: null,
      offset: [1_900, -700],
      city: 'Madrid',
    },
    {
      displayName: 'Manitas Rivas',
      kind: 'MANITAS',
      slugs: ['fontaneria', 'cerrajeria'],
      // Unrated: the cold-start case, and the reason search does not sort by rating (`Q4`).
      ratingAvg: null,
      ratingCount: 0,
      hourlyRateCents: 2_400,
      offset: [-800, 1_500],
      city: 'Madrid',
    },
    {
      displayName: 'Cerrajería 24h Chamberí',
      kind: 'PRO',
      slugs: ['cerrajeria'],
      ratingAvg: 3.9,
      ratingCount: 58,
      hourlyRateCents: 5_500,
      offset: [2_300, -300],
      city: 'Madrid',
    },
    {
      displayName: 'Clima Costa',
      kind: 'MANITAS',
      slugs: ['climatizacion'],
      ratingAvg: 5,
      ratingCount: 3,
      hourlyRateCents: 3_100,
      // Far enough out that a radius filter has something to exclude.
      offset: [41_000, 12_000],
      city: 'Alcalá de Henares',
    },
  ];

  const providers: CatalogueProvider[] = seed.map((row) => {
    const address = buildAddress({
      city: row.city,
      province: 'Madrid',
      ...near(row.offset[0], row.offset[1]),
    });
    const profile = buildProviderProfile({
      kind: row.kind,
      displayName: row.displayName,
      ratingCount: row.ratingCount,
    });
    for (const slug of row.slugs) {
      buildProviderCategory({
        providerProfileId: profile.id,
        categoryId: categoryIdOf(categories, slug),
      });
    }
    return {
      profile,
      address,
      categorySlugs: row.slugs,
      ratingAvg: row.ratingAvg,
      hourlyRateCents: row.hourlyRateCents,
    };
  });

  return { categories, providers };
}

function categoryIdOf(categories: CategoryInput[], slug: string): string {
  const found = categories.find((category) => category.slug === slug);
  if (found === undefined) throw new Error(`No seeded category "${slug}"`);
  return found.id;
}
