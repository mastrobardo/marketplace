/**
 * `W4-T07` §3.3 — the feed screen.
 *
 * The order and the filters are asserted without a DOM in `feed-filters.test.ts`; what is asserted
 * here is what only the rendered page can answer. That it needs a session. That the loader follows
 * the cursor instead of showing a first page it would then sort wrongly. That the two empty states
 * are two different sentences, because *the market is empty* and *your own switch emptied it* are
 * different facts. And that a `409` from an unfinished profile reads as what to fix.
 *
 * Spec: `docs/specs/S4/W4-T07-provider-job-feed.md` §5 AC19.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type JobFeedPage } from '@marketplace/contracts';

import { changeLanguage, setupI18n } from '../src/i18n/index.js';
import { ApiError } from '../src/shared/api.js';
import { renderApp, stubApi, STUB_USER } from './app-harness.js';
import { FEED_JOB_IDS, demoFeed } from './fixtures/feed.js';

const signedIn = () => vi.fn().mockResolvedValue(STUB_USER);

const FEED = '/es/feed';

beforeEach(async () => {
  await setupI18n();
  await changeLanguage('es');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The job titles in the order the list renders them. */
async function renderedTitles(): Promise<string[]> {
  const list = await screen.findByTestId('feed-list');
  return within(list)
    .getAllByRole('heading', { level: 2 })
    .map((heading) => heading.textContent ?? '');
}

describe('AC19 — the page needs a session', () => {
  it('sends a signed-out visitor to the login form', async () => {
    renderApp(FEED, stubApi({ getSession: vi.fn().mockResolvedValue(null) }));

    expect(await screen.findByRole('heading', { name: /accede a tu cuenta/i })).not.toBeNull();
  });
});

describe('AC19 — what a row says', () => {
  it('lists the matched jobs newest first, which is the order the API served', async () => {
    renderApp(FEED, stubApi({ getSession: signedIn() }));

    await waitFor(async () => {
      expect(await renderedTitles()).toEqual([
        'Radiadores y caldera',
        'Grifo del jardín',
        'Cambiar el termo eléctrico',
        'Cerradura forzada',
      ]);
    });
  });

  it('shows the distance in kilometres, not in metres', async () => {
    renderApp(FEED, stubApi({ getSession: signedIn() }));

    const row = await screen.findByTestId(`feed-job-${FEED_JOB_IDS.quoted}`);
    // 1840 m. A provider reads kilometres; nobody reads 1840.
    expect(row.textContent).toMatch(/1,8\s*km/);
  });

  it('labels a regulated trade the provider does not list', async () => {
    renderApp(FEED, stubApi({ getSession: signedIn() }));

    const row = await screen.findByTestId(`feed-job-${FEED_JOB_IDS.gas}`);
    expect(row.textContent).toMatch(/oficio regulado/i);
    expect(row.textContent).toMatch(/no lo tienes en tu perfil/i);
  });

  it('marks a job it has already quoted rather than hiding it', async () => {
    renderApp(FEED, stubApi({ getSession: signedIn() }));

    const row = await screen.findByTestId(`feed-job-${FEED_JOB_IDS.quoted}`);
    expect(row.textContent).toMatch(/ya has enviado/i);
  });
});

describe('AC19 — the controls are the provider’s', () => {
  it('re-sorts by distance without asking the API again', async () => {
    const getJobFeed = vi
      .fn()
      .mockResolvedValue({ items: demoFeed(), page: { nextCursor: null, hasMore: false } });
    renderApp(FEED, stubApi({ getSession: signedIn(), getJobFeed }));

    await screen.findByTestId('feed-list');
    const calls = getJobFeed.mock.calls.length;

    await userEvent.selectOptions(screen.getByLabelText(/ordenar por/i), 'nearest');

    await waitFor(async () => {
      expect((await renderedTitles())[0]).toBe('Cerradura forzada');
    });
    // The whole point of loading the set: sorting is not a round trip (§3.3).
    expect(getJobFeed.mock.calls).toHaveLength(calls);
  });

  it('hides the regulated gap when the switch is on, and says how many are shown', async () => {
    renderApp(FEED, stubApi({ getSession: signedIn() }));
    await screen.findByTestId('feed-list');

    await userEvent.click(screen.getByLabelText(/oficios regulados/i));

    await waitFor(async () => {
      expect(await renderedTitles()).not.toContain('Radiadores y caldera');
    });
    expect(screen.getByTestId('feed-count').textContent).toMatch(/3/);
  });

  it('hides what it has already quoted when asked', async () => {
    renderApp(FEED, stubApi({ getSession: signedIn() }));
    await screen.findByTestId('feed-list');

    await userEvent.click(screen.getByLabelText(/ya has enviado/i));

    await waitFor(async () => {
      expect(await renderedTitles()).not.toContain('Cambiar el termo eléctrico');
    });
  });
});

describe('AC19 — two empty states, because they are two different facts', () => {
  it('says the market is empty when the feed is', async () => {
    const empty: JobFeedPage = { items: [], page: { nextCursor: null, hasMore: false } };
    renderApp(
      FEED,
      stubApi({ getSession: signedIn(), getJobFeed: vi.fn().mockResolvedValue(empty) }),
    );

    expect(await screen.findByTestId('feed-empty-market')).not.toBeNull();
    expect(screen.queryByTestId('feed-empty-filtered')).toBeNull();
  });

  it('says the filters are, when they are the reason, and keeps the controls in view', async () => {
    renderApp(FEED, stubApi({ getSession: signedIn() }));
    await screen.findByTestId('feed-list');

    // Every job in the fixture is either already quoted, a licence gap, or not plumbing.
    // `/^oficio$/` — the switch below is labelled "oficios regulados", and a looser matcher would
    // find two controls.
    await userEvent.selectOptions(screen.getByLabelText(/^oficio$/i), 'gas');
    await userEvent.click(screen.getByLabelText(/oficios regulados/i));

    expect(await screen.findByTestId('feed-empty-filtered')).not.toBeNull();
    expect(screen.queryByTestId('feed-empty-market')).toBeNull();
    // The control that caused it is still there to undo it.
    expect(screen.getByLabelText(/oficios regulados/i)).not.toBeNull();
  });
});

describe('AC19 — an unfinished profile reads as what to fix', () => {
  it('renders the 409 as a sentence, not as an error page', async () => {
    renderApp(
      FEED,
      stubApi({
        getSession: signedIn(),
        getJobFeed: vi.fn().mockRejectedValue(new ApiError(409, 'CONFLICT')),
      }),
    );

    expect(await screen.findByTestId('feed-blocked')).not.toBeNull();
  });
});

describe('AC19 — the loader follows the cursor, bounded', () => {
  it('assembles the pages the API hands back, and says when it stopped early', async () => {
    const first = demoFeed();
    const second = demoFeed().map((item, index) => ({
      ...item,
      id: `ffff${String(index)}666-6666-4666-8666-ffffffffffff`,
      title: `Segunda página ${String(index)}`,
    }));

    const getJobFeed = vi
      .fn()
      .mockResolvedValueOnce({ items: first, page: { nextCursor: 'next', hasMore: true } })
      .mockResolvedValueOnce({ items: second, page: { nextCursor: null, hasMore: false } });

    renderApp(FEED, stubApi({ getSession: signedIn(), getJobFeed }));

    await waitFor(async () => {
      expect(await renderedTitles()).toHaveLength(first.length + second.length);
    });
    expect(getJobFeed.mock.calls).toHaveLength(2);
    expect(getJobFeed.mock.calls[1]?.[0]).toBe('next');
  });
});
