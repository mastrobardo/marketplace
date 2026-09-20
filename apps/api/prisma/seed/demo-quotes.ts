import { type Seeder } from './types.js';

/**
 * A job with quotes on it, so the comparison screen has something to compare — `W4-T04` §3.4.
 *
 * DoD §5.3: *seed data exists for anything this feature adds to a funnel*. `W4-T04` builds the
 * screen a client chooses on, and without this a preview shows it working perfectly over nothing —
 * which is the failure `W3-T10` was written to end for search, in the same words.
 *
 * **The rows are chosen so the screen's rules are visible rather than merely implemented.** Each one
 * is a branch the page has, and a demo missing it demonstrates nothing:
 *
 *   - **The cheapest quote is not the best rated.** `Cerrajería 24h Chamberí` (3.9) undercuts
 *     `Fontanería Gómez` (4.7) by nearly a third. *Do not hide the cheapest* is the slice's rule and
 *     it is vacuous on data where the best-rated provider is also the cheapest.
 *   - **`Manitas Rivas` has no reviews at all.** The cold-start case: it must sort *last* and read
 *     as "no reviews yet", never as a zero.
 *   - **`Electricidad Nadal` does not list `fontaneria`**, which the job asks for. That is
 *     `W4-T03`'s coverage saying the gap out loud while enforcing nothing.
 *   - **One quote has already lapsed.** `valid_until` in the past, so the screen renders it as
 *     expired with no accept control, and the API refuses to accept it (§2.5).
 *
 * **Not `localOnly`**, for `W3-T10`'s reason: no credential, no phone number, no real person. And it
 * **creates its own client**, because in every environment where `auth.demo-users` correctly
 * refuses, its rows are absent — so depending on them would make this seeder fail exactly where a
 * preview needs it most.
 *
 * It does depend on `providers.demo-world` and `categories.taxonomy`, and resolves both by natural
 * key rather than by uuid: `registry.ts` fixes the order, and a missing row throws here rather than
 * seeding a job nobody can quote.
 */

/** Fixed ids, so a `db:reset` rebuilds the same world and a pasted preview link still resolves. */
const CLIENT_ID = 'f1f1f1f1-1111-4111-8111-f1f1f1f1f1f1';
const JOB_ID = 'f2f2f2f2-2222-4222-8222-f2f2f2f2f2f2';
const quoteId = (n: number): string =>
  `f3f3f3f3-3333-4333-8333-f3f3f3f3${String(n).padStart(4, '0')}`;

/** The job's trades. A bathroom needs both, which is why one quote covers the pair (`W4-T03`). */
const JOB_SLUGS = ['fontaneria', 'electricidad'] as const;

interface DemoQuote {
  readonly provider: string;
  readonly amountCents: number;
  readonly breakdown: string;
  /** Days from the seed run. Negative is a quote that has already lapsed. */
  readonly validForDays: number;
}

const QUOTES: readonly DemoQuote[] = [
  {
    provider: 'Fontanería Gómez',
    amountCents: 486000,
    breakdown:
      'Desmontaje y retirada, fontanería completa, alicatado y ayudas de albañilería. ' +
      'La parte eléctrica la lleva un electricista con el que trabajamos habitualmente.',
    validForDays: 21,
  },
  {
    // The cheapest, and three tenths of a point worse rated than the dearest. The comparison the
    // screen exists for.
    provider: 'Cerrajería 24h Chamberí',
    amountCents: 331000,
    breakdown: 'Reforma completa del baño. Materiales de gama media, plazo de tres semanas.',
    validForDays: 14,
  },
  {
    // No reviews at all: sorts last under *recommended*, and says so rather than showing a zero.
    provider: 'Manitas Rivas',
    amountCents: 398000,
    breakdown: 'Presupuesto cerrado, sin extras salvo imprevistos en la bajante.',
    validForDays: 30,
  },
  {
    // Does not list `fontaneria`, which this job asks for — coverage states the gap and the client
    // decides. *"Nothing enforces, but stated clearly."*
    provider: 'Electricidad Nadal',
    amountCents: 512000,
    breakdown: 'Instalación eléctrica y puntos de luz. Subcontrato la fontanería.',
    // Already lapsed when it is read: the screen must render this as expired and offer no control.
    validForDays: -3,
  },
];

export const demoQuotes: Seeder = {
  id: 'quotes.demo-comparison',
  description:
    'One OPEN job across two trades and four quotes on it (W4-T04) — the cheapest is not the ' +
    'best rated, one provider is unrated, one lacks a trade the job asks for, and one has lapsed',

  async run({ db }) {
    const categories = await db.category.findMany({
      where: { slug: { in: [...JOB_SLUGS] } },
      select: { id: true, slug: true },
    });
    if (categories.length !== JOB_SLUGS.length) {
      throw new Error(
        `quotes.demo-comparison needs ${String(JOB_SLUGS.length)} categories, found ${String(categories.length)} — did categories.taxonomy run?`,
      );
    }

    await db.user.create({
      data: {
        id: CLIENT_ID,
        email: 'demo.cliente@example.com',
        name: 'Lucía Demo',
        roles: ['CLIENT'],
        // No `account` row, so nobody can sign in as this user — the property that lets this
        // seeder travel off a laptop at all.
        emailVerified: true,
        emailVerifiedAt: new Date('2026-01-15T09:00:00.000Z'),
      },
    });

    await db.job.create({
      data: {
        id: JOB_ID,
        clientId: CLIENT_ID,
        status: 'OPEN',
        title: 'Reforma completa del baño',
        description:
          'Baño de 4 m² en un piso de 1970. Hay que picar el alicatado, renovar la fontanería, ' +
          'cambiar el plato de ducha y añadir un punto de luz junto al espejo.',
        publishedAt: new Date('2026-09-18T09:00:00.000Z'),
        // Many-to-many, because a bathroom needs more than one trade — `W4-T01`, operator's words.
        categories: { create: categories.map((category) => ({ categoryId: category.id })) },
      },
    });

    const profiles = await db.providerProfile.findMany({
      where: { displayName: { in: QUOTES.map((quote) => quote.provider) } },
      select: { id: true, displayName: true },
    });
    const byName = new Map(profiles.map((profile) => [profile.displayName, profile.id]));

    const now = Date.now();
    for (const [index, quote] of QUOTES.entries()) {
      const providerId = byName.get(quote.provider);
      if (providerId === undefined) {
        throw new Error(
          `quotes.demo-comparison needs provider "${quote.provider}" — did providers.demo-world run?`,
        );
      }

      await db.quote.create({
        data: {
          id: quoteId(index + 1),
          jobId: JOB_ID,
          providerId,
          amountCents: quote.amountCents,
          breakdown: quote.breakdown,
          validUntil: new Date(now + quote.validForDays * 86_400_000),
          // Every one of them PENDING: the demo is the moment *before* the client chooses, and a
          // seeded ACCEPTED row would take the screen's own decision away from whoever is looking.
          status: 'PENDING',
        },
      });
    }
  },
};
