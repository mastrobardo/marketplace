import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button.js';
import { Dialog } from './Dialog.js';

/**
 * Every story opens the dialog through its trigger rather than rendering it open, because the part
 * worth reviewing is what focus does — in, trapped, and back out to the trigger on close.
 */
const meta: Meta<typeof Dialog> = {
  title: 'Primitives/Dialog',
  component: Dialog,
  args: {
    title: 'Confirmar la reserva',
    trigger: <Button variant="primary">Reservar</Button>,
    children: <p>Vas a reservar a Manuel G. para el martes 16 a las 10:00.</p>,
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector('button')?.click();
  },
};

export const WithFooter: Story = {
  args: {
    footer: (
      <>
        <Button>Volver</Button>
        <Button variant="primary">Confirmar</Button>
      </>
    ),
  },
};

/** A decision that must be made: no Escape, no click on the scrim. Used sparingly, and never for a nag. */
export const NotDismissable: Story = { args: { isDismissable: false } };

export const LongText: Story = {
  args: {
    title: 'Confirmar la solicitud de presupuesto sin compromiso',
    children: (
      <p>
        Vamos a enviar tu solicitud a los profesionales de fontanería disponibles en tu zona.
        Recibirás hasta cinco presupuestos y decides tú si aceptas alguno: la solicitud no te
        compromete a nada y puedes cancelarla en cualquier momento desde tu perfil.
      </p>
    ),
  },
};
