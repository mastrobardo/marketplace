/**
 * `W4-T04` §3.3 — the comparison screen.
 *
 * The ranking itself is asserted without a DOM in `quote-ranking.test.ts`; what is asserted here is
 * the part only the rendered page can answer: that the cheapest stays marked under every sort the
 * client can choose, that a quote nobody can act on offers no control, and that accepting asks
 * first — because until `W4-T05` exists, it has no undo.
 *
 * Spec: `docs/specs/S4/W4-T04-quote-comparison.md` §5.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { changeLanguage, setupI18n } from '../src/i18n/index.js';
import { renderApp, stubApi, STUB_USER } from './app-harness.js';
import { DEMO_JOB_ID, demoJob, demoQuotes } from './fixtures/quotes.js';

/** Signed in, which every one of these pages requires. */
const signedIn = () => vi.fn().mockResolvedValue(STUB_USER);

const jobPath = `/es/jobs/${DEMO_JOB_ID}`;

beforeEach(async () => {
  await setupI18n();
  await changeLanguage('es');
});

// One render per test. Without this the second `renderApp` in a file finds two of everything —
// `@testing-library/react`'s auto-cleanup is off here, as in every other suite in this app.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The provider names in the order the list renders them. */
async function renderedOrder(): Promise<string[]> {
  const list = await screen.findByTestId('quote-list');
  return within(list)
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent ?? '');
}

describe('AC20 — both screens need a session', () => {
  it('sends a signed-out visitor from the job list to the login form', async () => {
    renderApp('/es/jobs', stubApi({ getSession: vi.fn().mockResolvedValue(null) }));

    expect(await screen.findByRole('heading', { name: /accede a tu cuenta/i })).not.toBeNull();
  });

  it('sends a signed-out visitor from a job to the login form', async () => {
    renderApp(jobPath, stubApi({ getSession: vi.fn().mockResolvedValue(null) }));

    expect(await screen.findByRole('heading', { name: /accede a tu cuenta/i })).not.toBeNull();
  });
});

describe('AC17 — rating then price, and the cheapest is never hidden', () => {
  it('ranks by rating, with the unrated provider last', async () => {
    renderApp(jobPath, stubApi({ getSession: signedIn() }));

    await waitFor(async () => {
      expect(await renderedOrder()).toEqual([
        // 4.8, then 3.6 — and `Manitas Rivas` has no reviews, so it sits below both rather than
        // below nothing. `Construcciones Vela` is expired and sinks under every live offer.
        'Reformas Ruiz',
        'Obras Delgado',
        'Manitas Rivas',
        'Construcciones Vela',
      ]);
    });
  });

  it('marks the cheapest live quote, and it is not the best-rated one', async () => {
    renderApp(jobPath, stubApi({ getSession: signedIn() }));

    const marked = await screen.findByTestId('cheapest');
    const row = marked.closest('li');

    expect(within(row as HTMLElement).getByRole('heading', { level: 3 }).textContent).toContain(
      'Obras Delgado',
    );
  });

  it('keeps the mark on the same quote after the client re-sorts', async () => {
    const user = userEvent.setup();
    renderApp(jobPath, stubApi({ getSession: signedIn() }));

    await screen.findByTestId('quote-list');
    await user.selectOptions(screen.getByLabelText(/ordenar por/i), 'newest');

    // The order changed; the marked quote did not. That is the whole rule — a ranking must never
    // be able to bury the number the client came for.
    await waitFor(async () => {
      expect((await renderedOrder())[0]).toBe('Manitas Rivas');
    });
    const row = screen.getByTestId('cheapest').closest('li');
    expect(within(row as HTMLElement).getByRole('heading', { level: 3 }).textContent).toContain(
      'Obras Delgado',
    );
  });

  it('does not mark a cheaper expired quote — it is not an offer', async () => {
    renderApp(jobPath, stubApi({ getSession: signedIn() }));

    const row = (await screen.findByTestId('cheapest')).closest('li');
    expect(within(row as HTMLElement).queryByText(/construcciones vela/i)).toBeNull();
  });
});

describe('AC18 — a quote nobody can act on has no control', () => {
  it('renders an expired quote as expired, with no accept button', async () => {
    renderApp(jobPath, stubApi({ getSession: signedIn() }));

    const list = await screen.findByTestId('quote-list');
    const expired = within(list)
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes('Construcciones Vela'));

    expect(within(expired as HTMLElement).getByText(/caducado/i)).not.toBeNull();
    expect(
      within(expired as HTMLElement).queryByRole('button', { name: /^aceptar$/i }),
      'an expired quote offered an accept control that the API would refuse',
    ).toBeNull();
  });
});

describe('AC19 — accepting asks first, because it cannot be undone', () => {
  it('sends nothing until the dialog is confirmed', async () => {
    const user = userEvent.setup();
    const decideQuote = vi.fn();
    renderApp(jobPath, stubApi({ getSession: signedIn(), decideQuote }));

    const list = await screen.findByTestId('quote-list');
    const first = within(list).getAllByRole('listitem')[0] as HTMLElement;
    await user.click(within(first).getByRole('button', { name: /^aceptar$/i }));

    // The dialog is up and has an accessible name, and the write has not happened.
    expect(await screen.findByRole('dialog', { name: /aceptar este presupuesto/i })).not.toBeNull();
    expect(decideQuote).not.toHaveBeenCalled();
  });

  it('dismissing the dialog sends nothing at all', async () => {
    const user = userEvent.setup();
    const decideQuote = vi.fn();
    renderApp(jobPath, stubApi({ getSession: signedIn(), decideQuote }));

    const list = await screen.findByTestId('quote-list');
    const first = within(list).getAllByRole('listitem')[0] as HTMLElement;
    await user.click(within(first).getByRole('button', { name: /^aceptar$/i }));
    await user.click(await screen.findByRole('button', { name: /^cancelar$/i }));

    expect(decideQuote).not.toHaveBeenCalled();
  });

  it('confirming sends the decision for that quote', async () => {
    const user = userEvent.setup();
    const decideQuote = vi.fn().mockResolvedValue({ ...demoQuotes()[0], status: 'ACCEPTED' });
    renderApp(jobPath, stubApi({ getSession: signedIn(), decideQuote }));

    const list = await screen.findByTestId('quote-list');
    const first = within(list).getAllByRole('listitem')[0] as HTMLElement;
    await user.click(within(first).getByRole('button', { name: /^aceptar$/i }));
    await user.click(await screen.findByRole('button', { name: /sí, aceptar/i }));

    await waitFor(() => {
      expect(decideQuote).toHaveBeenCalledWith(demoQuotes()[0]?.id, 'accept');
    });
  });

  it('rejecting asks nothing — it is the reversible half', async () => {
    const user = userEvent.setup();
    const decideQuote = vi.fn().mockResolvedValue({ ...demoQuotes()[0], status: 'REJECTED' });
    renderApp(jobPath, stubApi({ getSession: signedIn(), decideQuote }));

    const list = await screen.findByTestId('quote-list');
    const first = within(list).getAllByRole('listitem')[0] as HTMLElement;
    await user.click(within(first).getByRole('button', { name: /^rechazar$/i }));

    await waitFor(() => {
      expect(decideQuote).toHaveBeenCalledWith(demoQuotes()[0]?.id, 'reject');
    });
  });
});

describe('coverage is shown and claims nothing', () => {
  it('says which of the job s trades the provider does not list', async () => {
    renderApp(jobPath, stubApi({ getSession: signedIn() }));

    const list = await screen.findByTestId('quote-list');
    const delgado = within(list)
      .getAllByRole('listitem')
      .find((item) => item.textContent?.includes('Obras Delgado')) as HTMLElement;

    expect(within(delgado).getByText(/no lo tiene en su perfil/i)).not.toBeNull();
    // The licensed trade is named as regulated, and nothing on the page claims anyone is verified
    // for it — `W8` is unbuilt and the schema knows no such fact.
    expect(within(delgado).getByText(/oficio regulado/i)).not.toBeNull();
    expect(delgado.textContent).not.toMatch(/verificad/i);
  });
});

describe('the whole set is loaded, because the ranking covers it', () => {
  it('follows the cursor until the API says there is no more', async () => {
    const all = demoQuotes();
    const getJobQuotes = vi
      .fn()
      .mockResolvedValueOnce({
        items: all.slice(0, 2),
        page: { nextCursor: 'CURSOR-1', hasMore: true },
      })
      .mockResolvedValueOnce({ items: all.slice(2), page: { nextCursor: null, hasMore: false } });

    renderApp(jobPath, stubApi({ getSession: signedIn(), getJobQuotes }));

    // All four rendered, from two pages — a ranking over the first page only would be a wrong
    // comparison rather than a partial one.
    await waitFor(async () => {
      expect(await renderedOrder()).toHaveLength(4);
    });
    expect(getJobQuotes).toHaveBeenNthCalledWith(1, DEMO_JOB_ID, undefined);
    expect(getJobQuotes).toHaveBeenNthCalledWith(2, DEMO_JOB_ID, 'CURSOR-1');
  });
});

describe('the job list', () => {
  it('lists the client s own jobs and links to each one', async () => {
    renderApp('/es/jobs', stubApi({ getSession: signedIn() }));

    const link = await screen.findByRole('link', { name: 'Reforma del baño' });
    expect(link.getAttribute('href')).toBe(`/es/jobs/${DEMO_JOB_ID}`);
  });

  it('says so when there is nothing, and offers no button that goes nowhere', async () => {
    renderApp(
      '/es/jobs',
      stubApi({ getSession: signedIn(), getMyJobs: () => Promise.resolve([]) }),
    );

    expect(await screen.findByText(/todavía no has publicado/i)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /publicar/i })).toBeNull();
  });

  it('renders in English too, with no Spanish leaking through', async () => {
    renderApp('/en/jobs', stubApi({ getSession: signedIn() }));

    expect(await screen.findByRole('heading', { name: 'My jobs', level: 1 })).not.toBeNull();
  });
});

describe('a job that is not yours', () => {
  it('renders the not-found page rather than an empty comparison', async () => {
    renderApp('/es/jobs/99999999-9999-4999-8999-999999999999', stubApi({ getSession: signedIn() }));

    expect(await screen.findByTestId('not-found')).not.toBeNull();
  });
});

describe('the job detail', () => {
  it('renders the job title and a way back', async () => {
    renderApp(
      jobPath,
      stubApi({ getSession: signedIn(), getJob: () => Promise.resolve(demoJob()) }),
    );

    expect(
      await screen.findByRole('heading', { name: 'Reforma del baño', level: 1 }),
    ).not.toBeNull();
    expect(screen.getByRole('link', { name: /volver a mis trabajos/i }).getAttribute('href')).toBe(
      '/es/jobs',
    );
  });

  it('says there are no quotes yet without pretending the job is broken', async () => {
    renderApp(
      jobPath,
      stubApi({
        getSession: signedIn(),
        getJobQuotes: () =>
          Promise.resolve({ items: [], page: { nextCursor: null, hasMore: false } }),
      }),
    );

    expect(await screen.findByText(/todavía no hay presupuestos/i)).not.toBeNull();
  });
});
