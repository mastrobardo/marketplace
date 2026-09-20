/**
 * `W4-T03` — the quote contract.
 *
 * The assertions worth reading here are about **what is absent**: no `verified` field on coverage,
 * no `EXPIRED` row state, no per-category price. Each absence is a decision the spec argues, and a
 * test suite that only checks what exists would let any of them be added back silently.
 *
 * Spec: `docs/specs/S4/W4-T03-quote-submission.md` §5.
 */
import { describe, expect, it } from 'vitest';

import {
  QUOTE_SORTABLE,
  QuoteCoverageSchema,
  QuoteEventSchema,
  QuoteInputSchema,
  QuoteListQuerySchema,
  QuotePageSchema,
  QuoteSchema,
  QuoteStatusSchema,
  canDecideOn,
  canQuoteOn,
  quoteMachine,
  quoteStatusOf,
} from '../src/quote.js';
import { JobStatusSchema, jobMachine } from '../src/job.js';
import { can, check } from '../src/state-machine.js';

const PROVIDER = {
  id: '11111111-1111-4111-8111-111111111111',
  displayName: 'Fontanería Ruiz',
  ratingAvg: 4.5,
  ratingCount: 12,
  hourlyRateCents: null,
};

const minimal = {
  id: '22222222-2222-4222-8222-222222222222',
  jobId: '33333333-3333-4333-8333-333333333333',
  status: 'PENDING' as const,
  amountCents: 250000,
  breakdown: null,
  validUntil: '2026-10-20T10:00:00.000Z',
  provider: PROVIDER,
  coverage: [],
  createdAt: '2026-09-20T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z',
};

describe('AC1/AC11 — writing a quote asks for a price and a date', () => {
  it('accepts a total and a validity, and nothing else', () => {
    const parsed = QuoteInputSchema.safeParse({
      amountCents: 250000,
      validUntil: '2026-10-20T10:00:00.000Z',
    });
    expect(parsed.success).toBe(true);
  });

  it('accepts an optional prose breakdown', () => {
    expect(
      QuoteInputSchema.safeParse({
        amountCents: 1,
        validUntil: '2026-10-20T10:00:00.000Z',
        breakdown: 'Alicatado 900€, fontanería 1200€, electricidad 400€',
      }).success,
    ).toBe(true);
  });

  it('refuses a quote with no price — that is not a quote', () => {
    expect(QuoteInputSchema.safeParse({ validUntil: '2026-10-20T10:00:00.000Z' }).success).toBe(
      false,
    );
  });

  it('refuses money that is not integer cents, and refuses owing the client', () => {
    for (const amountCents of [-1, 12.5, '250000']) {
      expect(
        QuoteInputSchema.safeParse({ amountCents, validUntil: '2026-10-20T10:00:00.000Z' }).success,
        String(amountCents),
      ).toBe(false);
    }
    // Free work is expressible. It is unusual, not invalid.
    expect(
      QuoteInputSchema.safeParse({ amountCents: 0, validUntil: '2026-10-20T10:00:00.000Z' })
        .success,
    ).toBe(true);
  });

  it('has no per-category price — one quote covers the whole job', () => {
    expect(Object.keys(QuoteInputSchema.shape).sort()).toEqual([
      'amountCents',
      'breakdown',
      'validUntil',
    ]);
  });
});

describe('AC2 — who may be quoted on', () => {
  it('allows OPEN and refuses everything else', () => {
    expect(canQuoteOn('OPEN')).toBe(true);
    for (const status of ['DRAFT', 'CANCELLED'] as const) {
      const result = canQuoteOn(status);
      expect(result, `${status} accepted a quote`).not.toBe(true);
      expect(result).toMatchObject({ code: 'CONFLICT' });
    }
  });

  it('answers for every job state the machine declares', () => {
    // Iterating the machine rather than a literal list: a state added to `JobStatus` fails the
    // compiler at `QUOTABLE_IN` first, and this catches the machine drifting from the enum.
    for (const status of jobMachine.states) {
      expect(typeof canQuoteOn(status) === 'boolean' || canQuoteOn(status)).toBeTruthy();
    }
    expect(jobMachine.states.length).toBe(JobStatusSchema.options.length);
  });
});

describe('AC8 — expiry is arithmetic, not a state', () => {
  const validUntil = new Date('2026-10-20T10:00:00.000Z');

  it('reads PENDING before the date and EXPIRED after it', () => {
    expect(quoteStatusOf('PENDING', validUntil, new Date('2026-10-19T09:59:59.000Z'))).toBe(
      'PENDING',
    );
    expect(quoteStatusOf('PENDING', validUntil, new Date('2026-10-20T10:00:01.000Z'))).toBe(
      'EXPIRED',
    );
  });

  it('treats the exact instant as expired — an offer good "until" a time is over at it', () => {
    expect(quoteStatusOf('PENDING', validUntil, validUntil)).toBe('EXPIRED');
  });

  it('keeps a withdrawn quote withdrawn, whatever the date says', () => {
    // Ended by a person, which is the more specific fact about it.
    expect(quoteStatusOf('WITHDRAWN', validUntil, new Date('2026-10-30T00:00:00.000Z'))).toBe(
      'WITHDRAWN',
    );
  });

  it('is not a value the database can hold', () => {
    // `W4-T04` added ACCEPTED and REJECTED. EXPIRED is still absent, and that is what this
    // asserts — the column holds what somebody *did*, never what the clock did.
    expect(QuoteStatusSchema.options).toEqual(['PENDING', 'WITHDRAWN', 'ACCEPTED', 'REJECTED']);
    expect(QuoteStatusSchema.safeParse('EXPIRED').success).toBe(false);
  });
});

describe('the machine', () => {
  const ANY = { validUntil: new Date('2026-10-20T10:00:00.000Z'), now: new Date('2026-09-20T10:00:00.000Z') };

  it('starts PENDING, and every way out of it is final', () => {
    expect(quoteMachine.initial).toBe('PENDING');
    expect(can(quoteMachine, 'PENDING', 'WITHDRAW', ANY)).toBe(true);
  });

  it('refuses a second withdrawal', () => {
    const result = check(quoteMachine, 'WITHDRAWN', 'WITHDRAW', ANY);
    expect(result).not.toBe(true);
    expect((result as { reason: string }).reason).toMatch(/final state/i);
  });

  it('declares only the events something can fire — AWARD is W4-T05 s', () => {
    // `W4-T03` asserted ACCEPT was absent because nothing could fire it. It can now; AWARD
    // cannot, and takes its place here.
    expect(QuoteEventSchema.options).toEqual(['WITHDRAW', 'ACCEPT', 'REJECT']);
    expect(QuoteEventSchema.safeParse('AWARD').success).toBe(false);
    expect(QuoteStatusSchema.safeParse('AWARDED').success).toBe(false);
  });
});

describe('AC6/AC7 — coverage states, and does not enforce', () => {
  it('names a job category, whether the provider lists it, and whether it is licensed', () => {
    const parsed = QuoteCoverageSchema.safeParse({
      slug: 'electricidad',
      nameEs: 'Electricidad',
      nameEn: 'Electrical',
      requiresLicence: true,
      listedByProvider: false,
    });
    expect(parsed.success).toBe(true);
  });

  it('carries no verification field, because nothing in this system knows one', () => {
    // W8-T01/W8-T02 are unbuilt. A nullable `verified` that is always null would be the empty
    // promise W4-T01 refused for photos — a shape implying a capability nothing can deliver.
    const keys = Object.keys(QuoteCoverageSchema.shape);
    expect(keys).not.toContain('verified');
    expect(keys).not.toContain('verifiedAt');
    expect(keys.sort()).toEqual([
      'listedByProvider',
      'nameEn',
      'nameEs',
      'requiresLicence',
      'slug',
    ]);
  });

  it('a quote from a provider listing none of the job s trades is still a valid quote', () => {
    // AC5. "It is up to the professional to decide to apply or not" — the contract does not gate.
    const parsed = QuoteSchema.safeParse({
      ...minimal,
      coverage: [
        {
          slug: 'electricidad',
          nameEs: 'Electricidad',
          nameEn: 'Electrical',
          requiresLicence: true,
          listedByProvider: false,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });
});

describe('the wire shape', () => {
  it('is valid with no breakdown and no coverage', () => {
    expect(QuoteSchema.safeParse(minimal).success).toBe(true);
  });

  it('reports EXPIRED even though the column cannot hold it', () => {
    expect(QuoteSchema.safeParse({ ...minimal, status: 'EXPIRED' }).success).toBe(true);
  });

  it('never carries the provider s location', () => {
    // Deliberately not SearchResultSchema: a quote list is not a place to disclose where anyone is.
    const keys = Object.keys(QuoteSchema.shape.provider.shape);
    expect(keys).not.toContain('point');
    expect(keys).not.toContain('distanceMetres');
    expect(keys).not.toContain('baseAddressId');
  });

  it('a null rating is "no reviews yet", not zero', () => {
    const parsed = QuoteSchema.safeParse({
      ...minimal,
      provider: { ...PROVIDER, ratingAvg: null, ratingCount: 0 },
    });
    expect(parsed.success).toBe(true);
  });
});

/* ============================================================================================= *
 * `W4-T04` — the client's answer.
 *
 * Spec: `docs/specs/S4/W4-T04-quote-comparison.md` §5.
 * ============================================================================================= */

const NOW = new Date('2026-09-20T12:00:00.000Z');
const TOMORROW = new Date('2026-09-21T12:00:00.000Z');
const YESTERDAY = new Date('2026-09-19T12:00:00.000Z');

describe('W4-T04 AC1/AC2 — a client answers a quote', () => {
  /** Where the machine says an event leads. `check` answers *whether*; this answers *to what*. */
  const destinationOf = (event: string): string | undefined =>
    quoteMachine.transitions.find((rule) => rule.on === event && rule.from === 'PENDING')?.to;

  it('accepts a pending quote', () => {
    expect(can(quoteMachine, 'PENDING', 'ACCEPT', { validUntil: TOMORROW, now: NOW })).toBe(true);
    expect(destinationOf('ACCEPT')).toBe('ACCEPTED');
  });

  it('rejects a pending quote', () => {
    expect(can(quoteMachine, 'PENDING', 'REJECT', { validUntil: TOMORROW, now: NOW })).toBe(true);
    expect(destinationOf('REJECT')).toBe('REJECTED');
  });
});

describe('W4-T04 AC7/AC8 — expiry blocks accepting and does not block rejecting', () => {
  it('refuses to accept a quote past its validity date', () => {
    const attempt = check(quoteMachine, 'PENDING', 'ACCEPT', { validUntil: YESTERDAY, now: NOW });

    expect(attempt).not.toBe(true);
    expect(attempt).toMatchObject({ code: 'CONFLICT' });
    expect((attempt as { reason: string }).reason).toMatch(/expired/i);
  });

  it('allows rejecting a quote past its validity date — a client tidying their screen', () => {
    expect(can(quoteMachine, 'PENDING', 'REJECT', { validUntil: YESTERDAY, now: NOW })).toBe(true);
  });

  it('refuses a quote expiring exactly now — the window is closed, not closing', () => {
    expect(can(quoteMachine, 'PENDING', 'ACCEPT', { validUntil: NOW, now: NOW })).not.toBe(true);
  });
});

describe('W4-T04 AC9 — a decision is final', () => {
  for (const from of ['ACCEPTED', 'REJECTED', 'WITHDRAWN'] as const) {
    for (const event of ['ACCEPT', 'REJECT'] as const) {
      it(`refuses ${event} on a ${from} quote`, () => {
        expect(
          can(quoteMachine, from, event, { validUntil: TOMORROW, now: NOW }),
        ).not.toBe(true);
      });
    }
  }

  it('declares all three answered states terminal', () => {
    expect([...quoteMachine.terminal].sort()).toEqual(['ACCEPTED', 'REJECTED', 'WITHDRAWN']);
  });
});

describe('W4-T04 AC15 — a decision by a person outranks the calendar', () => {
  it('reports an accepted quote as ACCEPTED after its validity date passes', () => {
    expect(quoteStatusOf('ACCEPTED', YESTERDAY, NOW)).toBe('ACCEPTED');
  });

  it('reports a rejected quote as REJECTED after its validity date passes', () => {
    expect(quoteStatusOf('REJECTED', YESTERDAY, NOW)).toBe('REJECTED');
  });

  it('still reports an unanswered quote as EXPIRED — the rule is about answers, not about status', () => {
    expect(quoteStatusOf('PENDING', YESTERDAY, NOW)).toBe('EXPIRED');
  });
});

describe('W4-T04 AC10 — which job states allow a decision', () => {
  it('allows a decision on an OPEN job', () => {
    expect(canDecideOn('OPEN')).toBe(true);
  });

  for (const status of ['DRAFT', 'CANCELLED'] as const) {
    it(`refuses a decision on a ${status} job`, () => {
      expect(canDecideOn(status)).toMatchObject({ code: 'CONFLICT' });
    });
  }

  it('answers for every job state, so a new one fails the build rather than the request', () => {
    for (const status of JobStatusSchema.options) {
      expect(() => canDecideOn(status)).not.toThrow();
    }
  });
});

describe('W4-T04 AC16 — the quotes on a job are a paged list', () => {
  it('defaults to 20 with no cursor', () => {
    const parsed = QuoteListQuerySchema.parse({});

    expect(parsed.limit).toBe(20);
    expect(parsed.cursor).toBeUndefined();
  });

  it('refuses a limit above the contract-wide maximum', () => {
    expect(QuoteListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('pages newest first by default', () => {
    expect(QuoteListQuerySchema.parse({}).sort).toEqual([
      { field: 'createdAt', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ]);
  });

  it('does not offer a rating sort, for the reason search.ts refused one', () => {
    expect(QUOTE_SORTABLE).not.toContain('ratingAvg');
    expect(QuoteListQuerySchema.safeParse({ sort: '-ratingAvg' }).success).toBe(false);
  });

  it('carries the page envelope every other list returns', () => {
    const page = QuotePageSchema.parse({
      items: [minimal],
      page: { nextCursor: null, hasMore: false },
    });

    expect(page.page).toEqual({ nextCursor: null, hasMore: false });
  });
});
