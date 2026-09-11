/**
 * Numbers and dates as a person reads them — once, for every page.
 *
 * `W12-T11` wrote `formatDistance` and `formatRate` inside `routes/search.tsx`, which was right when
 * there was one page. `W12-T12` is the second, and two private copies of "how this product writes a
 * price" is how one of them ends up with a hard-coded `€`. ES is the primary locale and it puts the
 * symbol *after* the number with a decimal comma, so every one of these is `Intl` rather than a
 * template string.
 *
 * Display layer only. Storage stays integer cents and metres (`W1-T06`, and `ST_DWithin` takes
 * metres) — nothing here is ever parsed back.
 */

/** Metres to something a person reads. `Intl` so that es-ES gets "1,2 km" and en gets "1.2 km". */
export function formatDistance(metres: number, locale: string): string {
  const kilometres = metres / 1000;
  return kilometres >= 1
    ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(kilometres)} km`
    : `${new Intl.NumberFormat(locale).format(metres)} m`;
}

/**
 * Integer cents to currency (`W1-T06`). es-ES puts the euro after the number and uses a decimal
 * comma; a hard-coded `€${cents / 100}` is wrong in the product's first language.
 */
export function formatRate(cents: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR' }).format(cents / 100);
}

/**
 * One decimal, always — `5` renders as "5,0" beside "4,7" so a column of ratings lines up and no
 * provider's score reads as an integer while another's reads as a measurement.
 */
export function formatRating(average: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(average);
}

/**
 * An ISO instant to "marzo de 2026".
 *
 * Month precision on purpose: the exact day someone created an account is not a fact a public page
 * owes anyone, and "since 3 March" invites a reader to compute how new they are to the week.
 */
export function formatMonthYear(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(iso));
}
