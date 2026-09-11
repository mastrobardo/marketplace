/**
 * The rendering half of `W12-T07`. What each of the three renderings shows, what submitting hands
 * over, and whether two search bars on one page are two landmarks a screen-reader user can tell
 * apart — which is what `W12-T11` will have, header and filter rail on the results page.
 *
 * Queries are by role and accessible name, as in `primitives.test.tsx`: the assertion worth making
 * is that the control is still a control, not that a class name survived.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBar, type SearchSchema } from '../src/index.js';

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
          options: [{ id: '4', label: '4 estrellas o más' }],
        },
      ],
    },
  },
};

const LABELS = {
  label: 'Buscar profesionales',
  submitLabel: 'Buscar',
  expandLabel: 'Más opciones de búsqueda',
} as const;

/** Follow `aria-describedby` to the text it points at, the way assistive technology does. */
function describedBy(element: Element): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

describe('AC9 — three renderings of one declaration', () => {
  it('renders every field in the hero', () => {
    render(<SearchBar schema={SCHEMA} rendering="hero" {...LABELS} />);
    expect(screen.getByRole('combobox', { name: 'Servicio' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Dónde' })).toBeDefined();
    expect(screen.getByRole('button', { name: /Cuándo/ })).toBeDefined();
  });

  it('adds the rail’s extras in the filters rendering, and only there', () => {
    const { unmount } = render(<SearchBar schema={SCHEMA} rendering="filters" {...LABELS} />);
    expect(screen.getByRole('button', { name: /Valoración mínima/ })).toBeDefined();
    unmount();

    render(<SearchBar schema={SCHEMA} rendering="hero" {...LABELS} />);
    expect(screen.queryByRole('button', { name: /Valoración mínima/ })).toBeNull();
  });

  it('collapses the header to the one field it names, and expands to all of them', async () => {
    const user = userEvent.setup();
    render(<SearchBar schema={SCHEMA} rendering="header" {...LABELS} />);

    expect(screen.getByRole('combobox', { name: 'Servicio' })).toBeDefined();
    expect(screen.queryByRole('combobox', { name: 'Dónde' })).toBeNull();

    await user.click(screen.getByRole('button', { name: LABELS.expandLabel }));
    expect(screen.getByRole('combobox', { name: 'Dónde' })).toBeDefined();
  });

  it('falls back to the first field when collapseTo names one that does not exist', () => {
    const broken: SearchSchema = {
      ...SCHEMA,
      renderings: { ...SCHEMA.renderings, header: { layout: 'compact', collapseTo: 'nosuch' } },
    };
    render(<SearchBar schema={broken} rendering="header" {...LABELS} />);
    expect(screen.getByRole('combobox', { name: 'Servicio' })).toBeDefined();
  });
});

describe('AC10 — submitting hands over the query, not the event', () => {
  it('gives onSubmit exactly what the pure function would have produced', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <SearchBar
        schema={SCHEMA}
        rendering="hero"
        values={{ what: 'fontaneria', where: 'Calle Mayor 3', when: null }}
        onSubmit={onSubmit}
        {...LABELS}
      />,
    );

    await user.click(screen.getByRole('button', { name: LABELS.submitLabel }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ what: 'fontaneria', where: 'Calle Mayor 3' });
  });

  it('reports a choice back through onValuesChange under the field’s name', async () => {
    const user = userEvent.setup();
    const onValuesChange = vi.fn();
    render(
      <SearchBar
        schema={SCHEMA}
        rendering="hero"
        values={{}}
        onValuesChange={onValuesChange}
        {...LABELS}
      />,
    );

    await user.click(screen.getByRole('button', { name: /Cuándo/ }));
    await user.click(await screen.findByRole('option', { name: 'Esta semana' }));

    expect(onValuesChange).toHaveBeenCalledWith(expect.objectContaining({ when: 'semana' }));
  });

  it('submits even when a required field is empty — the page owns the message', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<SearchBar schema={SCHEMA} rendering="hero" onSubmit={onSubmit} {...LABELS} />);

    await user.click(screen.getByRole('button', { name: LABELS.submitLabel }));
    expect(onSubmit).toHaveBeenCalledWith({});
  });
});

describe('AC11 — two search bars on one page are two landmarks', () => {
  it('is a search landmark with the name it was given', () => {
    render(<SearchBar schema={SCHEMA} rendering="hero" {...LABELS} />);
    expect(screen.getByRole('search', { name: LABELS.label })).toBeDefined();
  });

  it('keeps two renderings on one page distinguishable', () => {
    render(
      <>
        <SearchBar {...LABELS} schema={SCHEMA} rendering="header" label="Buscar en la cabecera" />
        <SearchBar {...LABELS} schema={SCHEMA} rendering="filters" label="Filtrar resultados" />
      </>,
    );
    expect(screen.getByRole('search', { name: 'Buscar en la cabecera' })).toBeDefined();
    expect(screen.getByRole('search', { name: 'Filtrar resultados' })).toBeDefined();
  });

  it('reaches the field with an error the application supplied', () => {
    render(
      <SearchBar
        schema={SCHEMA}
        rendering="hero"
        errors={{ what: 'Elige un servicio para continuar' }}
        {...LABELS}
      />,
    );

    const field = screen.getByRole('combobox', { name: 'Servicio' });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(field)).toContain('Elige un servicio para continuar');
  });
});
