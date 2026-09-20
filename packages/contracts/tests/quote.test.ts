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
  QuoteCoverageSchema,
  QuoteEventSchema,
  QuoteInputSchema,
  QuoteSchema,
  QuoteStatusSchema,
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
    expect(QuoteStatusSchema.options).toEqual(['PENDING', 'WITHDRAWN']);
    expect(QuoteStatusSchema.safeParse('EXPIRED').success).toBe(false);
  });
});

describe('the machine', () => {
  it('starts PENDING and ends WITHDRAWN', () => {
    expect(quoteMachine.initial).toBe('PENDING');
    expect(quoteMachine.terminal).toEqual(['WITHDRAWN']);
    expect(can(quoteMachine, 'PENDING', 'WITHDRAW', undefined)).toBe(true);
  });

  it('refuses a second withdrawal', () => {
    const result = check(quoteMachine, 'WITHDRAWN', 'WITHDRAW', undefined);
    expect(result).not.toBe(true);
    expect((result as { reason: string }).reason).toMatch(/final state/i);
  });

  it('declares only the events something can fire — ACCEPT is W4-T04 s', () => {
    expect(QuoteEventSchema.options).toEqual(['WITHDRAW']);
    expect(QuoteEventSchema.safeParse('ACCEPT').success).toBe(false);
    expect(QuoteStatusSchema.safeParse('ACCEPTED').success).toBe(false);
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
