import { type Seeder } from './types.js';

/**
 * The five providers the storefront used to invent — `W3-T10`.
 *
 * `GET /api/search` (`W3-T05`) and `GET /api/providers/:id` (`W3-T07`) are real, and until this
 * seeder existed nothing put a provider in the database: `pnpm dev` would have shown a search page
 * that worked perfectly and returned nothing. So the mock handlers stayed one ticket too long, and
 * this is the ticket.
 *
 * **It is `apps/web/mocks/catalogue.ts`, persisted.** That world was built for this job — five
 * providers around Madrid, one of them out of town, one quote-only, one unrated — and reproducing
 * it means the storefront looks the same on the day the handlers are deleted. Three of the rows are
 * load-bearing rather than decorative:
 *
 *   - **Electricidad Nadal has no hourly rate.** `?mode=booking` exists to exclude it, and a results
 *     card that assumes a price renders "€NaN/h" without it.
 *   - **Manitas Rivas is unrated.** The cold-start case, and the reason search does not sort by
 *     rating.
 *   - **Clima Costa is 30 km out with a 50 km radius**, so a Madrid search returns it. That is
 *     `W3-T05`'s headline rule made visible in the demo — *who will travel to me*, not *who is near
 *     me* — and it is the one thing about this search that surprises people.
 *
 * Not `localOnly`, and deliberately: these are invented businesses at approximate coordinates, with
 * no credential, no phone number and no real person's name. `auth.demo-users` carries that flag
 * because its rows have a **published password**; nothing here does, so a preview or staging
 * database may hold this world and demo a working storefront. Which also means this seeder **must
 * not depend on `auth.demo-users` having run** — it creates its own users, because in every
 * environment where that seeder correctly refuses, its rows are absent.
 *
 * Spec: `docs/specs/S3/W3-T10-demo-provider-seeder.md`.
 */

/**
 * Fixed ids, so a `db:reset` rebuilds the same world and a link pasted into a pull request still
 * resolves next week. Prefixed by entity, so a uuid in a log says what it is.
 */
const id = (entity: 'a' | 'b' | 'c' | 'd', n: number): string =>
  `${entity.repeat(8)}-${entity.repeat(4)}-4${entity.repeat(3)}-8${entity.repeat(3)}-${entity.repeat(8)}${String(n).padStart(4, '0')}`;

interface DemoCategory {
  readonly slug: string;
  readonly nameEs: string;
  readonly nameEn: string;
}

/**
 * The four trades the storefront's filters are built around.
 *
 * **Every one carries `requiresLicence: false`, and that is a deferral rather than an answer.**
 * Which trades legally require a licence in Spain is `BD-07`, a question for a human, and `W3-T01`
 * is blocked on it. A demo seeder that guessed would put the guess in the column `W3-T08`'s licence
 * verification will read as fact. The storefront's badge stays exercised by the component tests,
 * which build their categories from `buildCatalogue()` — where `electricidad` deliberately says
 * `true` — so nothing that was being tested is given up here.
 */
const CATEGORIES: readonly DemoCategory[] = [
  { slug: 'fontaneria', nameEs: 'Fontanería', nameEn: 'Plumbing' },
  { slug: 'electricidad', nameEs: 'Electricidad', nameEn: 'Electrical' },
  { slug: 'cerrajeria', nameEs: 'Cerrajería', nameEn: 'Locksmith' },
  { slug: 'climatizacion', nameEs: 'Climatización', nameEn: 'Heating & cooling' },
];

interface DemoProvider {
  readonly displayName: string;
  readonly kind: 'MANITAS' | 'PRO';
  readonly slugs: readonly string[];
  readonly bio: string | null;
  readonly ratingAvg: number | null;
  readonly ratingCount: number;
  readonly hourlyRateCents: number | null;
  readonly serviceRadiusMetres: number;
  readonly address: {
    readonly line1: string;
    readonly city: string;
    readonly province: string;
    readonly postalCode: string;
    readonly latitude: number;
    readonly longitude: number;
  };
}

/**
 * Real coordinates, not offsets from a point.
 *
 * The catalogue places its providers by metres north and east of Sol, which is right for a mock
 * whose distances are arithmetic. These rows are read by PostGIS and, once `W3-T06` lands, drawn on
 * a map — so a provider whose address says "Alcalá de Henares" and whose point is in the sierra is
 * a bug waiting for a map to reveal it.
 */
const PROVIDERS: readonly DemoProvider[] = [
  {
    displayName: 'Fontanería Gómez',
    kind: 'PRO',
    slugs: ['fontaneria'],
    bio: 'Veinte años arreglando fugas, calderas y todo lo que gotea en el centro de Madrid.',
    ratingAvg: 4.7,
    ratingCount: 31,
    hourlyRateCents: 4_200,
    serviceRadiusMetres: 15_000,
    address: {
      line1: 'Calle del Arenal 18',
      city: 'Madrid',
      province: 'Madrid',
      postalCode: '28013',
      latitude: 40.41837,
      longitude: -3.70704,
    },
  },
  {
    displayName: 'Electricidad Nadal',
    kind: 'PRO',
    slugs: ['electricidad', 'climatizacion'],
    bio: 'Instalaciones y boletines eléctricos. Presupuesto cerrado antes de empezar.',
    ratingAvg: 4.2,
    ratingCount: 12,
    // Quote-only: the case `?mode=booking` has to exclude.
    hourlyRateCents: null,
    serviceRadiusMetres: 15_000,
    address: {
      line1: 'Calle de Fuencarral 92',
      city: 'Madrid',
      province: 'Madrid',
      postalCode: '28004',
      latitude: 40.43012,
      longitude: -3.70102,
    },
  },
  {
    displayName: 'Manitas Rivas',
    kind: 'MANITAS',
    slugs: ['fontaneria', 'cerrajeria'],
    bio: null,
    // Unrated: the cold-start case.
    ratingAvg: null,
    ratingCount: 0,
    hourlyRateCents: 2_400,
    serviceRadiusMetres: 15_000,
    address: {
      line1: 'Calle de Embajadores 54',
      city: 'Madrid',
      province: 'Madrid',
      postalCode: '28012',
      latitude: 40.40556,
      longitude: -3.70231,
    },
  },
  {
    displayName: 'Cerrajería 24h Chamberí',
    kind: 'PRO',
    slugs: ['cerrajeria'],
    bio: 'Aperturas de urgencia, cambios de bombín y refuerzos de puerta, a cualquier hora.',
    ratingAvg: 3.9,
    ratingCount: 58,
    hourlyRateCents: 5_500,
    serviceRadiusMetres: 15_000,
    address: {
      line1: 'Calle de Eloy Gonzalo 27',
      city: 'Madrid',
      province: 'Madrid',
      postalCode: '28010',
      latitude: 40.43287,
      longitude: -3.70191,
    },
  },
  {
    displayName: 'Clima Costa',
    kind: 'MANITAS',
    slugs: ['climatizacion'],
    bio: 'Aire acondicionado y bombas de calor: instalación, mantenimiento y puesta a punto.',
    ratingAvg: 5,
    ratingCount: 3,
    hourlyRateCents: 3_100,
    // 30 km from Sol and covers 50: the provider a distance filter would drop and the radius rule
    // keeps. Every other provider here covers 15 km, so the contrast is in the data.
    serviceRadiusMetres: 50_000,
    address: {
      line1: 'Calle Mayor 41',
      city: 'Alcalá de Henares',
      province: 'Madrid',
      postalCode: '28801',
      latitude: 40.48205,
      longitude: -3.36351,
    },
  },
];

/** `Fontanería Gómez` → `fontaneria.gomez@demo.marketplace.local`. Invented, and obviously so. */
function emailFor(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.|\.$/g, '');
  return `${slug}@demo.marketplace.local`;
}

export const demoProviders: Seeder = {
  id: 'providers.demo-world',
  description:
    'Four trades and five Madrid providers with base addresses, radii and rates (W3-T10) — ' +
    'the world apps/web/mocks answered with until GET /api/search became real',

  async run({ db }) {
    const categoryIds = new Map<string, string>();

    for (const [index, category] of CATEGORIES.entries()) {
      const row = { ...category, id: id('a', index + 1) };
      categoryIds.set(category.slug, row.id);
      await db.category.create({
        data: {
          id: row.id,
          slug: row.slug,
          nameEs: row.nameEs,
          nameEn: row.nameEn,
          requiresLicence: false,
          position: index + 1,
          isActive: true,
        },
      });
    }

    for (const [index, provider] of PROVIDERS.entries()) {
      const userId = id('b', index + 1);
      const addressId = id('c', index + 1);
      const profileId = id('d', index + 1);

      await db.user.create({
        data: {
          id: userId,
          // Lowercase already: `app_user_email_lowercase` would reject anything else.
          email: emailFor(provider.displayName),
          name: provider.displayName,
          roles: ['CLIENT', 'PROVIDER'],
          // No `account` row accompanies this user, so nobody can sign in as it. That is the whole
          // reason this seeder is safe outside a laptop.
          emailVerified: true,
          emailVerifiedAt: new Date('2026-01-15T09:00:00.000Z'),
        },
      });

      await db.address.create({
        data: {
          id: addressId,
          userId,
          label: 'Base',
          line1: provider.address.line1,
          city: provider.address.city,
          province: provider.address.province,
          postalCode: provider.address.postalCode,
          countryCode: 'ES',
          // `location` is a generated column: the geography point comes from these two.
          latitude: provider.address.latitude,
          longitude: provider.address.longitude,
        },
      });

      await db.providerProfile.create({
        data: {
          id: profileId,
          userId,
          kind: provider.kind,
          displayName: provider.displayName,
          bio: provider.bio,
          // The centre of the operating radius, not where anyone lives (operator's rule,
          // 2026-09-17). Never null here: `W3-T05` will not search a provider without one and
          // `W3-T07` answers 404.
          baseAddressId: addressId,
          serviceRadiusMetres: provider.serviceRadiusMetres,
          hourlyRateCents: provider.hourlyRateCents,
          ratingAvg: provider.ratingAvg,
          ratingCount: provider.ratingCount,
        },
      });

      for (const slug of provider.slugs) {
        const categoryId = categoryIds.get(slug);
        if (categoryId === undefined) throw new Error(`No seeded category "${slug}"`);
        // No `id`: `provider_category` is keyed by the pair (`@@id([providerProfileId,
        // categoryId])`), explicitly rather than as an implicit Prisma m-n, because `W3-T05` joins
        // it from raw SQL. The pair is as fixed as a uuid would have been.
        await db.providerCategory.create({ data: { providerProfileId: profileId, categoryId } });
      }
    }
  },
};
