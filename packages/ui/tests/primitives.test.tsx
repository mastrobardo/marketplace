/**
 * The seven primitives, asserted through what a user — or a screen reader — can actually reach.
 *
 * Every query here is `getByRole` or `getByLabelText` on purpose. A test that reaches for a class
 * name proves the markup has not changed; a test that reaches for a role proves the control is
 * still a control. React Aria supplies the behaviour, so what these assert is that we wired it up
 * and did not quietly undo it with a prop.
 *
 * Plain attribute assertions rather than `@testing-library/jest-dom`: `apps/web`'s suites do the
 * same, and one matcher library that only half the workspace has is worse than none. `describedBy`
 * below is the one helper worth having — following `aria-describedby` to its text is the assertion
 * that actually says "a screen reader would read this".
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Combobox, Dialog, Popover, Select, TextInput, type Option } from '../src/index.js';

/** Follow `aria-describedby` to the text it points at, the way assistive technology does. */
function describedBy(element: Element): string {
  return (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');
}

/** The accessible name of a labelled element, via `aria-labelledby`. */
function accessibleName(element: Element): string {
  const labelledBy = element.getAttribute('aria-labelledby') ?? '';
  const fromIds = labelledBy
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim();
  return fromIds || (element.getAttribute('aria-label') ?? '');
}

const OPTIONS: Option[] = [
  { id: 'fontaneria', label: 'Fontanería' },
  { id: 'electricidad', label: 'Electricidad' },
  { id: 'cerrajeria', label: 'Cerrajería' },
];

describe('AC1 — the system exports its primitives', () => {
  it('exports all seven', async () => {
    const ui = await import('../src/index.js');
    for (const name of [
      'Button',
      'Field',
      'TextInput',
      'Select',
      'Combobox',
      'Dialog',
      'Popover',
    ]) {
      expect(ui, `${name} is not exported`).toHaveProperty(name);
    }
  });
});

describe('AC4/AC5/AC6 — Button', () => {
  it('renders a real button with an accessible name', () => {
    render(<Button variant="danger">Eliminar</Button>);
    expect(screen.getByRole('button', { name: 'Eliminar' }).tagName).toBe('BUTTON');
  });

  it('announces pending work and refuses the press while it is pending', async () => {
    const onPress = vi.fn();
    render(
      <Button isPending pendingLabel="Guardando" onPress={onPress}>
        Guardar
      </Button>,
    );

    const button = screen.getByRole('button', { name: /Guardar/ });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    // Announced, not merely drawn: a spinner nobody can hear is not a loading state.
    expect(screen.getByText('Guardando')).toBeDefined();

    await userEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('does not fire onPress when disabled', async () => {
    const onPress = vi.fn();
    render(
      <Button isDisabled onPress={onPress}>
        Guardar
      </Button>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('AC2/AC7/AC8/AC9 — TextInput and Field', () => {
  it('associates the label with the control', () => {
    render(<TextInput label="Código postal" />);
    expect(screen.getByLabelText('Código postal').tagName).toBe('INPUT');
  });

  it('links the description to the input', () => {
    render(<TextInput label="Código postal" description="Cinco dígitos" />);
    expect(describedBy(screen.getByLabelText('Código postal'))).toContain('Cinco dígitos');
  });

  it('marks the input invalid and links the message, and does neither without one', () => {
    const { unmount } = render(<TextInput label="Correo" errorMessage="Correo no válido" />);
    const invalid = screen.getByLabelText('Correo');
    expect(invalid.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(invalid)).toContain('Correo no válido');
    unmount();

    render(<TextInput label="Correo" />);
    expect(screen.getByLabelText('Correo').getAttribute('aria-invalid')).not.toBe('true');
  });

  it('marks a required field required', () => {
    render(<TextInput label="Teléfono" isRequired />);
    const input = screen.getByLabelText(/Teléfono/);
    expect(input.hasAttribute('required') || input.getAttribute('aria-required') === 'true').toBe(
      true,
    );
  });
});

describe('AC10/AC11 — Select', () => {
  it('opens as a listbox and selects with the keyboard', async () => {
    const onSelectionChange = vi.fn();
    render(
      <Select
        label="Servicio"
        options={OPTIONS}
        placeholder="Elige un servicio"
        onSelectionChange={onSelectionChange}
      />,
    );

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('option')).toHaveLength(OPTIONS.length);

    // Enter opens the listbox with the first option already focused, so ArrowDown lands on the
    // second. Asserting `electricidad` is therefore an assertion that the arrow key moved focus —
    // `fontaneria` would pass even if it had not.
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(onSelectionChange).toHaveBeenCalledWith('electricidad');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('links the error message to the trigger and marks the field invalid', () => {
    const { container } = render(
      <Select label="Servicio" options={OPTIONS} errorMessage="Elige un servicio" />,
    );

    // Not `aria-invalid`: that attribute belongs on an input, and a select's trigger is a button.
    // React Aria follows the ARIA practices — the message is *linked* to the trigger, and the
    // wrapper carries `data-invalid` so the stylesheet can show it. Asserting the attribute we
    // wished for instead of the behaviour that exists is how a test starts lying.
    const trigger = screen.getByRole('button', { name: /Servicio/ });
    expect(describedBy(trigger)).toContain('Elige un servicio');
    expect(container.querySelector('[data-invalid]')).not.toBeNull();
  });
});

describe('AC12 — Combobox', () => {
  it('presents the loading label and offers nothing to choose', async () => {
    render(
      <Combobox
        label="Dónde"
        options={[]}
        isLoading
        loadingLabel="Buscando…"
        emptyLabel="Sin resultados"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Mostrar/ }));
    expect(screen.getByText('Buscando…')).toBeDefined();

    // React Aria wraps the empty state in a `role="option"` container so the listbox still has
    // list semantics and the message is announced. Selectable options are the ones that carry a
    // key, so that — not the role count — is what "nothing to choose" means here.
    const selectable = screen
      .queryAllByRole('option')
      .filter((option) => option.hasAttribute('data-key'));
    expect(selectable).toHaveLength(0);
  });

  it('says there is no match without calling it an error', async () => {
    render(<Combobox label="Dónde" options={OPTIONS} emptyLabel="Sin resultados" />);

    // `getByRole('combobox')`, not `getByLabelText`: React Aria labels the suggestions button with
    // the field label too, so the label matches two elements — correctly, for a screen reader.
    const input = screen.getByRole('combobox', { name: 'Dónde' });
    await userEvent.type(input, 'zzzz');
    expect(screen.getByText('Sin resultados')).toBeDefined();
    expect(input.getAttribute('aria-invalid')).not.toBe('true');
  });
});

describe('AC13 — Dialog', () => {
  it('opens from its trigger, names itself, and returns focus on Escape', async () => {
    render(
      <Dialog title="Confirmar reserva" trigger={<Button>Reservar</Button>}>
        <p>¿Seguro?</p>
      </Dialog>,
    );

    const trigger = screen.getByRole('button', { name: 'Reservar' });
    await userEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(accessibleName(dialog)).toBe('Confirmar reserva');
    expect(dialog.contains(document.activeElement)).toBe(true);

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});

describe('AC14 — Popover', () => {
  it('opens with the name it was given', async () => {
    render(
      <Popover aria-label="Filtros" trigger={<Button>Filtros</Button>}>
        <p>Contenido</p>
      </Popover>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    expect(screen.getByRole('dialog', { name: 'Filtros' })).toBeDefined();
  });
});
