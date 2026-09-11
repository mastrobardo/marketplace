// @vitest-environment node
//
// The half of `W12-T07` that has no DOM in it — which is deliberately most of it. ADR-011 R4 puts
// the search in the URL and R1 lets a loader run on a Worker, so the functions that turn a value
// bag into a query string and back have to be pure, total and browser-free. A test that could only
// run in jsdom would be proving the wrong thing about them.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  missingRequiredFields,
  parseSearchQuery,
  serializeSearchQuery,
  toSearchQuery,
  type SearchSchema,
} from '../src/index.js';

/**
 * The product's own instance, near enough — `what · where · when · mode` from ADR-011 §3, plus one
 * filter-rail extra. It lives here rather than in `src/`: the design system holds the shape, the
 * discovery feature holds the instance.
 */
const SCHEMA: SearchSchema = {
  fields: [
    {
      kind: 'category',
      name: 'what',
      label: 'Servicio',
      isRequired: true,
      options: [
        { id: 'fontaneria', label: 'Fontanería' },
        { id: 'electricidad', label: 'Electricidad' },
      ],
    },
    {
      kind: 'place',
      name: 'where',
      label: 'Dónde',
      isRequired: true,
      allowsCustomValue: true,
      options: [{ id: '28013', label: 'Madrid — Centro' }],
    },
    {
      kind: 'choice',
      name: 'when',
      label: 'Cuándo',
      options: [
        { id: 'hoy', label: 'Hoy' },
        { id: 'semana', label: 'Esta semana' },
      ],
    },
    {
      kind: 'choice',
      name: 'mode',
      label: 'Modo',
      options: [
        { id: 'quote', label: 'Pedir presupuesto' },
        { id: 'booking', label: 'Reservar' },
      ],
    },
  ],
  renderings: {
    hero: { layout: 'row', prominence: 'primary' },
    header: { layout: 'compact', collapseTo: 'what' },
    filters: {
      layout: 'stack',
      extra: [
        {
          kind: 'choice',
          name: 'valoracion',
          label: 'Valoración mínima',
          options: [
            { id: '4', label: '4 estrellas o más' },
            { id: '3', label: '3 estrellas o más' },
          ],
        },
      ],
    },
  },
};

describe('AC1 — the package exports the pattern', () => {
  it('exports the renderer, the four functions and the field helper', async () => {
    const ui = await import('../src/index.js');
    for (const name of [
      'SearchBar',
      'fieldsFor',
      'toSearchQuery',
      'serializeSearchQuery',
      'parseSearchQuery',
      'missingRequiredFields',
    ]) {
      expect(ui, `${name} is not exported`).toHaveProperty(name);
    }
  });
});

describe('AC2 — the query is what the schema declares, and nothing else', () => {
  it('drops a name the schema does not declare', () => {
    expect(toSearchQuery(SCHEMA, { what: 'fontaneria', utm_source: 'newsletter' })).toEqual({
      what: 'fontaneria',
    });
  });

  it('drops null, empty and whitespace-only rather than serialising them empty', () => {
    expect(
      toSearchQuery(SCHEMA, { what: 'fontaneria', where: null, when: '', mode: '   ' }),
    ).toEqual({ what: 'fontaneria' });
  });

  it('trims what it keeps', () => {
    expect(toSearchQuery(SCHEMA, { what: '  fontaneria  ' })).toEqual({ what: 'fontaneria' });
  });

  it('includes a filter-rail extra, which is a field like any other', () => {
    expect(toSearchQuery(SCHEMA, { valoracion: '4' })).toEqual({ valoracion: '4' });
  });
});

describe('AC3 — two identical searches make one identical URL', () => {
  it('orders keys by the schema, not by the values object', () => {
    const query = toSearchQuery(SCHEMA, {
      valoracion: '4',
      mode: 'quote',
      what: 'fontaneria',
      where: '28013',
    });
    expect(Object.keys(query)).toEqual(['what', 'where', 'mode', 'valoracion']);
  });

  it('serialises the same search to the same string whatever order it was built in', () => {
    const a = toSearchQuery(SCHEMA, { what: 'fontaneria', where: '28013' });
    const b = toSearchQuery(SCHEMA, { where: '28013', what: 'fontaneria' });
    expect(serializeSearchQuery(a)).toBe(serializeSearchQuery(b));
    expect(serializeSearchQuery(a)).toBe('what=fontaneria&where=28013');
  });
});

describe('AC4 — the URL round-trips', () => {
  it('parses back exactly what it serialised', () => {
    const query = toSearchQuery(SCHEMA, {
      what: 'fontaneria',
      where: 'Calle Mayor 3',
      when: 'semana',
      mode: 'quote',
    });
    expect(parseSearchQuery(SCHEMA, serializeSearchQuery(query))).toEqual(query);
  });

  it('accepts a leading ? and a URLSearchParams alike', () => {
    expect(parseSearchQuery(SCHEMA, '?what=fontaneria')).toEqual({ what: 'fontaneria' });
    expect(parseSearchQuery(SCHEMA, new URLSearchParams('what=fontaneria'))).toEqual({
      what: 'fontaneria',
    });
  });

  it('survives an accent and a space through the round trip', () => {
    const query = toSearchQuery(SCHEMA, { where: 'Alcalá de Henares' });
    expect(serializeSearchQuery(query)).toBe('where=Alcal%C3%A1+de+Henares');
    expect(parseSearchQuery(SCHEMA, serializeSearchQuery(query))).toEqual(query);
  });
});

describe('AC5 — a URL is untrusted input', () => {
  it('drops a parameter the schema does not declare', () => {
    expect(parseSearchQuery(SCHEMA, 'what=fontaneria&utm_source=newsletter&admin=1')).toEqual({
      what: 'fontaneria',
    });
  });

  it('drops a value outside a closed field’s options', () => {
    expect(parseSearchQuery(SCHEMA, 'what=nosuch&when=semana')).toEqual({ when: 'semana' });
  });

  it('takes the first of a repeated key, deterministically', () => {
    expect(parseSearchQuery(SCHEMA, 'when=hoy&when=semana')).toEqual({ when: 'hoy' });
  });

  it('drops an empty value rather than treating it as a choice', () => {
    expect(parseSearchQuery(SCHEMA, 'what=&when=hoy')).toEqual({ when: 'hoy' });
  });
});

describe('AC6 — free text is what a postcode is before /places/suggest exists', () => {
  it('keeps a place value that is not one of the options', () => {
    expect(parseSearchQuery(SCHEMA, 'where=Calle+Mayor+3')).toEqual({ where: 'Calle Mayor 3' });
  });

  it('does not keep one when the field is closed', () => {
    const closed: SearchSchema = {
      ...SCHEMA,
      fields: SCHEMA.fields.map((field) =>
        field.name === 'where' ? { ...field, allowsCustomValue: false } : field,
      ),
    };
    expect(parseSearchQuery(closed, 'where=Calle+Mayor+3')).toEqual({});
  });
});

describe('AC7 — validation returns data, never copy', () => {
  it('names every empty required field, in schema order', () => {
    expect(missingRequiredFields(SCHEMA, {})).toEqual(['what', 'where']);
  });

  it('names none when the required fields are answered', () => {
    expect(missingRequiredFields(SCHEMA, { what: 'fontaneria', where: '28013' })).toEqual([]);
  });

  it('does not name an optional field', () => {
    expect(missingRequiredFields(SCHEMA, { what: 'fontaneria', where: '28013' })).not.toContain(
      'when',
    );
  });
});

describe('AC8 — a Worker parses the URL with this same code', () => {
  const sources = ['schema.ts', 'query.ts'].map((name) => ({
    name,
    code: readFileSync(
      fileURLToPath(new URL(`../src/patterns/search/${name}`, import.meta.url)),
      'utf8',
    ),
  }));

  it('reads no browser global at all', () => {
    for (const { name, code } of sources) {
      const offending = code
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
        .filter((line) => /\b(window|document|localStorage|navigator|location)\b/.test(line));
      expect(offending, `${name} reads a browser global (ADR-011 R4)`).toEqual([]);
    }
  });
});
