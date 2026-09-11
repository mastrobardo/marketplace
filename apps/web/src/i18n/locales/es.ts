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

  'home.categories.title': 'Todos los servicios',
  'home.categories.intro': 'Cada servicio es una búsqueda ya empezada: elige uno y dinos dónde.',

  'home.how.title': 'Cómo funciona',
  'home.how.search.title': 'Dinos qué necesitas',
  'home.how.search.body': 'Elige el servicio, tu zona y para cuándo lo necesitas.',
  'home.how.compare.title': 'Compara profesionales',
  'home.how.compare.body': 'Mira perfiles, valoraciones y presupuestos antes de decidir.',
  'home.how.hire.title': 'Contrata con tranquilidad',
  'home.how.hire.body': 'Reserva directamente o acepta un presupuesto, y paga por la plataforma.',

  'home.trust.title': 'Por qué contratar aquí',
  'home.trust.verified.title': 'Profesionales verificados',
  'home.trust.verified.body':
    'Comprobamos la identidad y, cuando el oficio lo exige, la licencia en vigor.',
  'home.trust.reviews.title': 'Opiniones de trabajos reales',
  'home.trust.reviews.body':
    'Solo valora quien ha contratado, y cada opinión se publica junto al trabajo que la motivó.',
  'home.trust.payment.title': 'Pago protegido',
  'home.trust.payment.body':
    'El importe se libera al profesional cuando el trabajo está hecho, no antes.',

  'home.pro.title': '¿Eres profesional?',
  'home.pro.body':
    'Recibe solicitudes de clientes de tu zona, decide qué trabajos aceptas y cobra por la plataforma.',
  'home.pro.cta': 'Trabaja con nosotros',

  'pro.title': 'Trabaja con nosotros',
  'pro.intro':
    'Da de alta tu perfil, recibe solicitudes de tu zona y decide qué trabajos aceptas. Sin cuota de alta.',
  'pro.benefits.title': 'Cómo trabajamos con los profesionales',
  'pro.benefits.leads.title': 'Solicitudes de tu zona',
  'pro.benefits.leads.body': 'Solo te llegan trabajos del radio que tú marques.',
  'pro.benefits.control.title': 'Tú decides',
  'pro.benefits.control.body': 'Aceptas lo que te encaja y rechazas lo demás, sin penalización.',
  'pro.benefits.payment.title': 'Cobro garantizado',
  'pro.benefits.payment.body':
    'El cliente paga por la plataforma antes de que empieces el trabajo.',
  'pro.pending': 'El registro de profesionales todavía no está abierto.',

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
  'search.hero.label': 'Buscar profesionales cerca de ti',
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

  'search.filters.label': 'Filtrar resultados',

  'results.title': 'Profesionales cerca de ti',
  'results.showing': 'Mostrando {{count}} profesionales',
  'results.facets.title': 'Filtros',
  'results.facets.kinds': 'Tipo de profesional',
  'results.next': 'Siguiente',
  'results.more': 'Más resultados',
  'results.quoteOnly': 'Sólo presupuesto',
  'results.perHour': '{{rate}} / h',
  'results.unrated': 'Sin valoraciones',
  'results.rating': '{{average}} ({{count}})',
  'results.kind.PRO': 'Profesional',
  'results.kind.MANITAS': 'Manitas',
  'results.needWhere.title': '¿Dónde necesitas el servicio?',
  'results.needWhere.body':
    'Dinos tu código postal o tu ciudad y te enseñamos a los profesionales que trabajan en tu zona.',
  'results.empty.title': 'No hemos encontrado profesionales',
  'results.empty.body': 'Prueba a ampliar la zona o a quitar algún filtro.',
  'results.empty.filters': 'Has buscado:',
  'results.empty.clear': 'Quitar los filtros',
  'results.error.body': 'No hemos podido cargar los resultados. Vuelve a intentarlo en un momento.',
  'results.map.title': 'Mapa',
  'results.map.pending': 'El mapa todavía no está disponible.',
  'results.filter.what': 'Servicio',
  'results.filter.where': 'Dónde',
  'results.filter.when': 'Cuándo',
  'results.filter.mode': 'Cómo',

  'provider.kind.PRO': 'Profesional',
  'provider.kind.MANITAS': 'Manitas',
  'provider.about.title': 'Sobre {{name}}',
  'provider.about.pending': 'Todavía no ha escrito una descripción.',
  'provider.services.title': 'Servicios',
  'provider.rating.summary': '{{average}} de 5 ({{count}} valoraciones)',
  'provider.rating.none': 'Todavía no tiene valoraciones',
  'provider.rate.hourly': '{{rate}} / h',
  'provider.rate.quote': 'Sólo presupuesto',
  'provider.area.title': 'Zona de trabajo',
  'provider.area.radius': 'Trabaja hasta {{distance}} km de {{city}}',
  'provider.area.unset': 'Todavía no ha indicado su zona de trabajo.',
  'provider.memberSince': 'En la plataforma desde {{date}}',
  'provider.gallery.title': 'Trabajos realizados',
  'provider.gallery.pending': 'Las fotos de trabajos todavía no están disponibles.',
  'provider.badges.title': 'Acreditaciones',
  'provider.badges.pending': 'Las acreditaciones y licencias todavía no están disponibles.',
  'provider.reviews.title': 'Valoraciones',
  'provider.reviews.pending': 'Las valoraciones de clientes todavía no se pueden leer aquí.',
  'provider.cta.title': 'Contactar con {{name}}',
  'provider.cta.body':
    'Las cuentas de cliente todavía no están abiertas, así que de momento no se puede contactar desde aquí.',
  'provider.notFound.title': 'Este profesional ya no está publicado',
  'provider.notFound.body': 'Puede que haya dado de baja su perfil o que el enlace sea antiguo.',
  'provider.notFound.search': 'Buscar profesionales',
  'provider.error.body': 'No hemos podido cargar este perfil. Vuelve a intentarlo en un momento.',

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
