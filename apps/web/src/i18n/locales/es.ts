/**
 * The source of truth. Its keys define `TranslationKey`, so every other catalogue must satisfy
 * this shape exactly — a key added here is a compile error in `en.ts` until it is translated.
 *
 * Spain first (`TODO.md` §1): a feature is specified in Spanish, so it is written in Spanish, and
 * the untranslated language is the one that fails the build.
 *
 * Flat dotted keys on purpose. Nested catalogues read better and compare worse: `keyof` gives you
 * one level, and the parity test then has to walk a tree it could have compared as a set.
 */
export const es = {
  'app.name': 'Marketplace',
  'app.tagline': 'Reformas, mantenimiento y urgencias',

  'nav.home': 'Inicio',
  'nav.skipToContent': 'Saltar al contenido',

  'home.title': 'Encuentra a un profesional de confianza',
  'home.intro':
    'Reformas, mantenimiento del hogar y urgencias, con profesionales verificados cerca de ti.',

  'notFound.title': 'Página no encontrada',
  'notFound.body': 'La dirección que has abierto no existe o ha cambiado.',
  'notFound.back': 'Volver al inicio',

  'language.label': 'Idioma',
  'language.es': 'Español',
  'language.en': 'English',

  'nav.search': 'Buscar',
  'nav.primary': 'Principal',
  'nav.legal': 'Legal',

  'search.submit': 'Buscar',
  'search.expand': 'Abrir el buscador',
  'search.label': 'Buscar profesionales',
  'search.what.label': 'Servicio',
  'search.what.placeholder': '¿Qué necesitas?',
  'search.what.empty': 'No hay servicios que coincidan',
  'search.where.label': 'Dónde',
  'search.where.placeholder': 'Código postal o ciudad',
  'search.where.empty': 'Escribe tu código postal',
  'search.where.required': 'Dinos dónde necesitas el servicio',
  'search.when.label': 'Cuándo',
  'search.when.placeholder': 'Cuando sea',
  'search.when.urgente': 'Es una urgencia',
  'search.when.hoy': 'Hoy',
  'search.when.semana': 'Esta semana',
  'search.when.flexible': 'Sin prisa',
  'search.mode.label': 'Cómo',
  'search.mode.placeholder': 'Como prefieras',
  'search.mode.quote': 'Pedir presupuesto',
  'search.mode.booking': 'Reservar directamente',

  'legal.terms.title': 'Términos y condiciones',
  'legal.privacy.title': 'Política de privacidad',
  'legal.cookies.title': 'Política de cookies',
  'legal.pending':
    'Este documento todavía no está publicado. Lo redacta un abogado y se publicará antes del lanzamiento.',

  'error.title': 'Algo ha fallado',
  'error.body': 'No hemos podido cargar esta página. Vuelve a intentarlo en un momento.',
  'error.retry': 'Reintentar',

  'footer.rights': 'Todos los derechos reservados',
} as const;

/** Every key the application may translate. An unknown key is a compile error, not a fallback. */
export type TranslationKey = keyof typeof es;

/** The shape every other catalogue must match: same keys, no more, no fewer. */
export type Translations = Record<TranslationKey, string>;
