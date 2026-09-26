import { type Seeder } from './types.js';

/**
 * The funnel a person can actually walk — `W4-T07` §3.4.
 *
 * DoD §5.3 asks for seed data for anything a feature adds to a funnel, and this feature adds the half
 * nobody could reach. As `main` stood, **no account that can sign in could read a feed at all**:
 * `provider@marketplace.local` has no `ProviderProfile`, so the endpoint would answer `409`; and
 * `quotes.demo-comparison`'s job has no address, so it could not appear in a feed even if one could
 * be read.
 *
 * **This is therefore the one seeder in the repo that depends on `auth.demo-users`, and it says so by
 * throwing** when those rows are absent — the contract `quotes.demo-comparison` already has with
 * `providers.demo-world`, resolved by natural key rather than by uuid. `providers.demo-world` and
 * `quotes.demo-comparison` deliberately create their own users so they keep working where the
 * credentialed seeder correctly refuses; this one cannot, because *being able to sign in* is its
 * entire purpose.
 *
 * **Not `localOnly`**, for `W3-T10`'s reason: nothing here is a credential, a phone number or a real
 * person. The published-password question belongs to `auth.demo-users`, which resolves it from
 * `SEED_DEMO_PASSWORD` off a laptop — and a run that reaches this seeder is a run where that was
 * already answered.
 *
 * **Every row is a branch of the feed rather than decoration**, the discipline `demo-quotes.ts`
 * follows: the plain match, the regulated trade the reader lists, the regulated trade they do **not**
 * (the label that replaced a gate — §2.2), a job outside their radius and inside somebody else's, a
 * trade they do not work in, a job with **no address** that is in nobody's feed, and a cancelled one
 * that must never appear. A demo missing any of them demonstrates nothing about the rule it is there
 * to show.
 */

/** Fixed ids, so a `db:reset` rebuilds the same world and a pasted preview link still resolves. */
const id = (entity: '7' | '8' | '9' | 'e', n: number): string =>
  `${entity.repeat(8)}-${entity.repeat(4)}-4${entity.repeat(3)}-8${entity.repeat(3)}-${entity.repeat(8)}${String(n).padStart(4, '0')}`;

/** The two accounts `auth.demo-users` writes. Resolved by email, never by uuid. */
const PROVIDER_EMAIL = 'provider@marketplace.local';
const CLIENT_EMAIL = 'client@marketplace.local';

/** Puerta del Sol. The provider's operating centre, which is not where anybody lives (`W3-T02`). */
const MADRID = { latitude: 40.416775, longitude: -3.70379 } as const;
/** Alcalá de Henares, ~30 km out: inside `Clima Costa`'s 50 km reach and outside everybody else's. */
const ALCALA = { latitude: 40.48205, longitude: -3.36351 } as const;

/** The trades the sign-in-able professional lists. Not `gas`, which is the labelled gap. */
const PROVIDER_SLUGS = ['fontaneria', 'electricidad'] as const;

interface DemoJob {
  readonly ref: number;
  readonly title: string;
  readonly description: string;
  readonly slugs: readonly string[];
  /** `'madrid'`, `'alcala'`, or `null` for the job that has no address at all. */
  readonly where: 'madrid' | 'alcala' | null;
  readonly urgency: 'urgente' | 'hoy' | 'semana' | 'flexible' | null;
  readonly budget: { readonly minCents: number | null; readonly maxCents: number | null };
  /** Days before the seed run. Bigger is older, so the feed's order is knowable from this file. */
  readonly postedDaysAgo: number;
  readonly cancelled?: boolean;
  /** True for the one job the sign-in-able provider has already quoted. */
  readonly quotedByProvider?: boolean;
}

const JOBS: readonly DemoJob[] = [
  {
    ref: 1,
    title: 'Radiadores y caldera',
    description:
      'Siete radiadores y una caldera de gas de 2004. Quiero cambiar la caldera y purgar o ' +
      'sustituir los radiadores que no calientan.',
    // Plumbing **and** gas: the intersection is what matches (`fontaneria`), and `gas` is regulated
    // and not on this provider's profile — the label the *hide* switch acts on.
    slugs: ['fontaneria', 'gas'],
    where: 'madrid',
    urgency: 'semana',
    budget: { minCents: 250_000, maxCents: 400_000 },
    postedDaysAgo: 1,
  },
  {
    ref: 2,
    title: 'Cuadro eléctrico y diferencial',
    description:
      'Salta el diferencial cada vez que enciendo el horno y la vitro a la vez. El cuadro es el ' +
      'original del piso.',
    // Regulated, and this provider *does* list it: the label says so rather than staying silent.
    slugs: ['electricidad'],
    where: 'madrid',
    urgency: 'hoy',
    budget: { minCents: null, maxCents: 90_000 },
    postedDaysAgo: 2,
  },
  {
    ref: 3,
    title: 'Cambiar el termo eléctrico',
    description: 'Termo de 80 litros que pierde agua por abajo. Está en la terraza, con desagüe.',
    slugs: ['fontaneria'],
    where: 'madrid',
    urgency: 'urgente',
    budget: { minCents: null, maxCents: null },
    postedDaysAgo: 4,
    // The already-quoted row: the `myQuote` label, and the switch that hides it, need one.
    quotedByProvider: true,
  },
  {
    ref: 4,
    title: 'Aire acondicionado en el salón',
    description: 'Un split en el salón de 22 m². La fachada da a un patio interior.',
    slugs: ['climatizacion'],
    // Thirty kilometres out: this provider covers fifteen and does not see it, `Clima Costa` covers
    // fifty and does. `W3-T05`'s headline rule, from the other end.
    where: 'alcala',
    urgency: 'flexible',
    budget: { minCents: 120_000, maxCents: 200_000 },
    postedDaysAgo: 5,
  },
  {
    ref: 5,
    title: 'Cerradura forzada',
    description:
      'Intentaron forzar la puerta y la llave ya no gira bien. Quiero cambiar el bombín.',
    // A trade this provider does not list at all: absent from their feed however close it is, and in
    // `Manitas Rivas`' and `Cerrajería 24h Chamberí`'s.
    slugs: ['cerrajeria'],
    where: 'madrid',
    urgency: 'urgente',
    budget: { minCents: null, maxCents: 15_000 },
    postedDaysAgo: 6,
  },
  {
    ref: 6,
    title: 'Pintar el pasillo',
    description: 'Pasillo de 9 metros, techo incluido. Blanco roto, dos capas.',
    slugs: ['pintura'],
    // **No address.** `W4-T01` §2.5 lets a client publish without one and wrote down the consequence
    // this seeder makes visible: the job matches no radius query, so it is in nobody's feed.
    where: null,
    urgency: 'flexible',
    budget: { minCents: null, maxCents: 60_000 },
    postedDaysAgo: 7,
  },
  {
    ref: 7,
    title: 'Cambiar el plato de ducha',
    description: 'Ya lo ha hecho un conocido, lo dejo aquí por si acaso.',
    slugs: ['fontaneria'],
    where: 'madrid',
    urgency: null,
    budget: { minCents: null, maxCents: null },
    postedDaysAgo: 9,
    // In range and in trade, and it must never appear: `CANCELLED` is carried out of the feed by the
    // same `status = 'OPEN'` that carries `DRAFT` out.
    cancelled: true,
  },
];

const DAY = 86_400_000;

export const demoFeed: Seeder = {
  id: 'jobs.demo-feed',
  description:
    'A provider profile for the sign-in-able demo account and seven jobs for it to find (W4-T07) — ' +
    'one already quoted, one with a regulated trade it does not list, one out of radius, one in ' +
    'another trade, one with no address at all and one cancelled',

  async run({ db }) {
    const users = await db.user.findMany({
      where: { email: { in: [PROVIDER_EMAIL, CLIENT_EMAIL] } },
      select: { id: true, email: true },
    });
    const byEmail = new Map(users.map((user) => [user.email, user.id]));
    const providerUserId = byEmail.get(PROVIDER_EMAIL);
    const clientUserId = byEmail.get(CLIENT_EMAIL);

    if (providerUserId === undefined || clientUserId === undefined) {
      throw new Error(
        'jobs.demo-feed needs the accounts auth.demo-users writes — did that seeder run? ' +
          'Unlike providers.demo-world this fixture cannot create its own: the whole point is that ' +
          'somebody can sign in and walk the funnel.',
      );
    }

    const wanted = [...new Set(JOBS.flatMap((job) => job.slugs)), ...PROVIDER_SLUGS];
    const categories = await db.category.findMany({
      where: { slug: { in: wanted } },
      select: { id: true, slug: true },
    });
    const categoryIds = new Map(categories.map((row) => [row.slug, row.id]));
    for (const slug of wanted) {
      if (!categoryIds.has(slug)) {
        throw new Error(`jobs.demo-feed needs category "${slug}" — did categories.taxonomy run?`);
      }
    }

    /* ── The professional: an account that can sign in *and* read a feed ──────────────────────── */

    const providerAddressId = id('7', 1);
    await db.address.create({
      data: {
        id: providerAddressId,
        userId: providerUserId,
        label: 'Base',
        line1: 'Plaza de la Puerta del Sol 1',
        city: 'Madrid',
        province: 'Madrid',
        postalCode: '28013',
        countryCode: 'ES',
        latitude: MADRID.latitude,
        longitude: MADRID.longitude,
      },
    });

    await db.providerProfile.create({
      data: {
        id: id('8', 1),
        userId: providerUserId,
        kind: 'PRO',
        displayName: 'Paco Fontanero',
        bio: 'Fontanería y electricidad en el centro de Madrid. Cuenta de demostración.',
        baseAddressId: providerAddressId,
        // Fifteen kilometres, like every provider in `providers.demo-world` but `Clima Costa` — so the
        // Alcalá job below is out of reach here and in reach there.
        serviceRadiusMetres: 15_000,
        hourlyRateCents: 3_800,
        // Unrated, which is the honest state for an account nobody has hired, and the cold-start case
        // `W3-T05` refuses to treat as 0.00.
        ratingAvg: null,
        ratingCount: 0,
      },
    });

    for (const slug of PROVIDER_SLUGS) {
      await db.providerCategory.create({
        // No `id`: `provider_category` is keyed by the pair (`MEM-2026-09-18-1`).
        data: { providerProfileId: id('8', 1), categoryId: categoryIds.get(slug) as string },
      });
    }

    /* ── The client: an address to publish from, and the jobs themselves ─────────────────────── */

    const clientAddressId = id('7', 2);
    await db.address.create({
      data: {
        id: clientAddressId,
        userId: clientUserId,
        label: 'Casa',
        line1: 'Calle de Atocha 27',
        city: 'Madrid',
        province: 'Madrid',
        postalCode: '28012',
        countryCode: 'ES',
        latitude: 40.41265,
        longitude: -3.70102,
      },
    });

    const alcalaAddressId = id('7', 3);
    await db.address.create({
      data: {
        id: alcalaAddressId,
        userId: clientUserId,
        label: 'Piso de mis padres',
        line1: 'Calle Mayor 12',
        city: 'Alcalá de Henares',
        province: 'Madrid',
        postalCode: '28801',
        countryCode: 'ES',
        latitude: ALCALA.latitude,
        longitude: ALCALA.longitude,
      },
    });

    // So that publishing a *new* job from this account infers a location, which is `W4-T01` §2.5's
    // whole mechanism — without a `client_profile` there is nothing to infer from and every job
    // posted by hand would land addressless, in nobody's feed.
    await db.clientProfile.create({
      data: {
        userId: clientUserId,
        displayName: 'Ana Cliente',
        defaultAddressId: clientAddressId,
      },
    });

    const now = Date.now();
    for (const job of JOBS) {
      const postedAt = new Date(now - job.postedDaysAgo * DAY);
      const addressId =
        job.where === 'madrid' ? clientAddressId : job.where === 'alcala' ? alcalaAddressId : null;

      await db.job.create({
        data: {
          id: id('9', job.ref),
          clientId: clientUserId,
          status: job.cancelled === true ? 'CANCELLED' : 'OPEN',
          title: job.title,
          description: job.description,
          urgency: job.urgency,
          budgetMinCents: job.budget.minCents,
          budgetMaxCents: job.budget.maxCents,
          addressId,
          publishedAt: postedAt,
          ...(job.cancelled === true
            ? { cancelledAt: new Date(now - (job.postedDaysAgo - 1) * DAY) }
            : {}),
          categories: {
            create: job.slugs.map((slug) => ({ categoryId: categoryIds.get(slug) as string })),
          },
        },
      });

      if (job.quotedByProvider === true) {
        await db.quote.create({
          data: {
            id: id('e', job.ref),
            jobId: id('9', job.ref),
            providerId: id('8', 1),
            amountCents: 38_000,
            breakdown:
              'Termo nuevo de 80 litros, retirada del viejo y puesta en marcha. Mano de obra incluida.',
            // Still open when a person looks at it: the demo is the moment *before* the client answers,
            // and a seeded decision would take the screen's own choice away from whoever is looking.
            status: 'PENDING',
            validUntil: new Date(now + 14 * DAY),
          },
        });
      }
    }
  },
};
