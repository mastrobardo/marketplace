/**
 * `where` → a coordinate, without a geocoding provider.
 *
 * `GET /search` requires a centre — a radius search without one is `SELECT * FROM provider_profile`
 * — and `GET /places/suggest` (`W3-T06`) does not exist because `OPS-12` has not happened. So the
 * endpoint resolves the free-text `where` itself, from a table compiled into the binary.
 *
 * **This is a port with one adapter, not a geocoder.** `resolvePlace` is the entire surface a real
 * provider has to satisfy later, and the three constraints that put it here are recorded in the
 * spec (§2.2): the database stays clean because a real address lookup may end up driven by the
 * frontend; no Maps vendor is chosen yet because Google costs materially more than the
 * alternatives; and `agents/roles/agent-discovery.md` already required that PostGIS do the
 * geography and that geocoding results be cached rather than re-fetched. A table in memory is the
 * strongest form of that cache.
 *
 * What it knows: the fifty-two provincial capitals, their province names and the usual alternative
 * spellings, plus every Spanish postal code through its first two digits — which *are* the province
 * code, so `28001` and `28914` both resolve to Madrid without a row per postcode. That is
 * deliberately coarse. It is a centre for a radius query, not an address.
 *
 * Spec: `docs/specs/S5/W3-T05-geo-search.md` §2.2.
 */

export interface Place {
  readonly latitude: number;
  readonly longitude: number;
}

interface Province {
  /** The postal-code prefix, which in Spain is the province code. */
  readonly code: string;
  /** Normalised spellings: the capital, the province, and the names in the co-official languages. */
  readonly names: readonly string[];
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Coordinates are the capital's centre, to four decimals — about 11 m, far finer than a search
 * radius needs and far coarser than any address.
 */
const PROVINCES: readonly Province[] = [
  {
    code: '01',
    names: ['alava', 'araba', 'vitoria', 'vitoria-gasteiz', 'gasteiz'],
    latitude: 42.8467,
    longitude: -2.6716,
  },
  { code: '02', names: ['albacete'], latitude: 38.9943, longitude: -1.8585 },
  { code: '03', names: ['alicante', 'alacant'], latitude: 38.3452, longitude: -0.481 },
  { code: '04', names: ['almeria'], latitude: 36.834, longitude: -2.4637 },
  { code: '05', names: ['avila'], latitude: 40.6565, longitude: -4.6818 },
  { code: '06', names: ['badajoz'], latitude: 38.8794, longitude: -6.9707 },
  {
    code: '07',
    names: [
      'baleares',
      'illes balears',
      'islas baleares',
      'palma',
      'palma de mallorca',
      'mallorca',
    ],
    latitude: 39.5696,
    longitude: 2.6502,
  },
  { code: '08', names: ['barcelona'], latitude: 41.3874, longitude: 2.1686 },
  { code: '09', names: ['burgos'], latitude: 42.3439, longitude: -3.6969 },
  { code: '10', names: ['caceres'], latitude: 39.4753, longitude: -6.3724 },
  { code: '11', names: ['cadiz'], latitude: 36.5271, longitude: -6.2886 },
  {
    code: '12',
    names: ['castellon', 'castello', 'castellon de la plana'],
    latitude: 39.9864,
    longitude: -0.0513,
  },
  { code: '13', names: ['ciudad real'], latitude: 38.9848, longitude: -3.9273 },
  { code: '14', names: ['cordoba'], latitude: 37.8882, longitude: -4.7794 },
  { code: '15', names: ['a coruna', 'la coruna', 'coruna'], latitude: 43.3623, longitude: -8.4115 },
  { code: '16', names: ['cuenca'], latitude: 40.0704, longitude: -2.1374 },
  { code: '17', names: ['girona', 'gerona'], latitude: 41.9794, longitude: 2.8214 },
  { code: '18', names: ['granada'], latitude: 37.1773, longitude: -3.5986 },
  { code: '19', names: ['guadalajara'], latitude: 40.6297, longitude: -3.1669 },
  {
    code: '20',
    names: ['guipuzcoa', 'gipuzkoa', 'san sebastian', 'donostia'],
    latitude: 43.3183,
    longitude: -1.9812,
  },
  { code: '21', names: ['huelva'], latitude: 37.2614, longitude: -6.9447 },
  { code: '22', names: ['huesca'], latitude: 42.1401, longitude: -0.4089 },
  { code: '23', names: ['jaen'], latitude: 37.7796, longitude: -3.7849 },
  { code: '24', names: ['leon'], latitude: 42.5987, longitude: -5.5671 },
  { code: '25', names: ['lleida', 'lerida'], latitude: 41.6176, longitude: 0.62 },
  { code: '26', names: ['la rioja', 'rioja', 'logrono'], latitude: 42.4627, longitude: -2.445 },
  { code: '27', names: ['lugo'], latitude: 43.0097, longitude: -7.5567 },
  { code: '28', names: ['madrid'], latitude: 40.4168, longitude: -3.7038 },
  { code: '29', names: ['malaga'], latitude: 36.7213, longitude: -4.4214 },
  { code: '30', names: ['murcia'], latitude: 37.9922, longitude: -1.1307 },
  {
    code: '31',
    names: ['navarra', 'nafarroa', 'pamplona', 'irunea'],
    latitude: 42.8125,
    longitude: -1.6458,
  },
  { code: '32', names: ['ourense', 'orense'], latitude: 42.3357, longitude: -7.8639 },
  { code: '33', names: ['asturias', 'oviedo'], latitude: 43.3619, longitude: -5.8494 },
  { code: '34', names: ['palencia'], latitude: 42.0096, longitude: -4.5288 },
  {
    code: '35',
    names: ['las palmas', 'gran canaria', 'las palmas de gran canaria'],
    latitude: 28.1235,
    longitude: -15.4363,
  },
  { code: '36', names: ['pontevedra', 'vigo'], latitude: 42.431, longitude: -8.6444 },
  { code: '37', names: ['salamanca'], latitude: 40.9701, longitude: -5.6635 },
  {
    code: '38',
    names: ['santa cruz de tenerife', 'tenerife'],
    latitude: 28.4636,
    longitude: -16.2518,
  },
  { code: '39', names: ['cantabria', 'santander'], latitude: 43.4623, longitude: -3.81 },
  { code: '40', names: ['segovia'], latitude: 40.9429, longitude: -4.1088 },
  { code: '41', names: ['sevilla'], latitude: 37.3891, longitude: -5.9845 },
  { code: '42', names: ['soria'], latitude: 41.7665, longitude: -2.479 },
  { code: '43', names: ['tarragona'], latitude: 41.1189, longitude: 1.2445 },
  { code: '44', names: ['teruel'], latitude: 40.3456, longitude: -1.1065 },
  { code: '45', names: ['toledo'], latitude: 39.8628, longitude: -4.0273 },
  { code: '46', names: ['valencia'], latitude: 39.4699, longitude: -0.3763 },
  { code: '47', names: ['valladolid'], latitude: 41.6523, longitude: -4.7245 },
  { code: '48', names: ['vizcaya', 'bizkaia', 'bilbao'], latitude: 43.263, longitude: -2.935 },
  { code: '49', names: ['zamora'], latitude: 41.5033, longitude: -5.7446 },
  { code: '50', names: ['zaragoza'], latitude: 41.6488, longitude: -0.8891 },
  { code: '51', names: ['ceuta'], latitude: 35.8894, longitude: -5.3213 },
  { code: '52', names: ['melilla'], latitude: 35.2923, longitude: -2.9381 },
];

const POSTAL_CODE = /^\d{5}$/;

/**
 * Lowercase, unaccented, space-collapsed. `MÁLAGA`, `malaga` and `  Málaga ` are one query typed
 * three ways, and a search box is where all three arrive.
 *
 * Accents are stripped rather than preserved because the input is a person typing a place name on a
 * phone — unlike `CATEGORY_SLUG`, where `fontanería` is correctly a rejected request because a slug
 * is a URL token rather than something anybody types by hand.
 */
function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function place(province: Province): Place {
  return Object.freeze({ latitude: province.latitude, longitude: province.longitude });
}

/** Built once, at module load. The lookup is the cache the role file asks for. */
const BY_NAME = new Map<string, Place>(
  PROVINCES.flatMap((province) => province.names.map((name) => [name, place(province)] as const)),
);

const BY_CODE = new Map<string, Place>(
  PROVINCES.map((province) => [province.code, place(province)] as const),
);

/**
 * Resolve a `where` to a search centre, or `undefined` when it is not a place we know.
 *
 * `undefined` rather than a fallback centre on purpose: defaulting an unrecognised place to Madrid
 * would answer a search for a town we cannot find with a confident list of providers 400 km away,
 * and nothing in the response would say so.
 */
export function resolvePlace(where: string): Place | undefined {
  const normalised = normalise(where);
  if (normalised === '') return undefined;

  if (POSTAL_CODE.test(normalised)) return BY_CODE.get(normalised.slice(0, 2));

  const direct = BY_NAME.get(normalised);
  if (direct !== undefined) return direct;

  // "Madrid, España" and "28001, Madrid" are what a browser's autofill produces. Try the parts
  // before giving up, so a correct place with a country glued to it is not an unknown one.
  for (const segment of normalised.split(',')) {
    const trimmed = segment.trim();
    if (trimmed === '') continue;
    if (POSTAL_CODE.test(trimmed)) {
      const byCode = BY_CODE.get(trimmed.slice(0, 2));
      if (byCode !== undefined) return byCode;
      continue;
    }
    const byName = BY_NAME.get(trimmed);
    if (byName !== undefined) return byName;
  }

  return undefined;
}
