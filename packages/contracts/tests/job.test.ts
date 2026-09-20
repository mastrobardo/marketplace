/**
 * `W4-T01` — the job contract, and the one rule that guards publishing.
 *
 * The interesting assertions here are about **what is not required**. The operator's instruction
 * (spec §1.1) is that a user completes a minimal flow with missing parameters, so a schema that
 * quietly demanded a description would be the defect — and it would be invisible, because a test
 * suite that only sends complete objects never notices.
 *
 * Spec: `docs/specs/S4/W4-T01-job-posting.md` §5.
 */
import { describe, expect, it } from 'vitest';

import {
  BudgetRangeSchema,
  JobDraftInputSchema,
  JobSchema,
  JobStatusSchema,
  JobUpdateInputSchema,
  JobUrgencySchema,
  hasAnyCategory,
  jobMachine,
} from '../src/job.js';
import { SearchUrgencySchema } from '../src/search.js';
import { can, check } from '../src/state-machine.js';

describe('AC1/AC2 — a draft asks for nothing', () => {
  it('accepts an entirely empty body', () => {
    const parsed = JobDraftInputSchema.safeParse({});
    expect(parsed.success, 'an empty draft was rejected — §2.2 says it must not be').toBe(true);
  });

  it('accepts any single field on its own', () => {
    for (const body of [
      { title: 'Reforma baño' },
      { description: 'Cambiar azulejos y sanitarios' },
      { categorySlugs: ['fontaneria'] },
      { urgency: 'semana' },
      { budget: { minCents: null, maxCents: 400000 } },
    ]) {
      expect(JobDraftInputSchema.safeParse(body).success, JSON.stringify(body)).toBe(true);
    }
  });

  it('an update may clear a field with null, and omit means leave alone', () => {
    expect(JobUpdateInputSchema.safeParse({ title: null }).success).toBe(true);
    expect(JobUpdateInputSchema.safeParse({}).success).toBe(true);
  });

  it('still refuses text that is not text', () => {
    // Permissive about *absence*, not about nonsense. An empty title is a bug in a form, not a
    // user expressing themselves minimally.
    expect(JobDraftInputSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(JobDraftInputSchema.safeParse({ title: 'x'.repeat(141) }).success).toBe(false);
    expect(JobDraftInputSchema.safeParse({ categorySlugs: 'fontaneria' }).success).toBe(false);
  });
});

describe('AC3/AC5 — publishing requires one thing, and it is the category set', () => {
  it('refuses a job with no category, and says why', () => {
    const result = hasAnyCategory({ categoryCount: 0 });
    expect(result).not.toBe(true);
    expect(result).toMatchObject({ code: 'CONFLICT' });
    expect((result as { reason: string }).reason).toMatch(/category/i);
  });

  it('allows a job with one', () => {
    expect(hasAnyCategory({ categoryCount: 1 })).toBe(true);
  });

  it('allows a job with several, because a bathroom is not one trade', () => {
    expect(hasAnyCategory({ categoryCount: 3 })).toBe(true);
  });

  it('asks for nothing else — no description, no budget, no title', () => {
    // The guard's whole input is a count. If this interface ever grows a field, publishing has
    // acquired a requirement that §2.3 says it must not have, and this test is the place to argue.
    expect(hasAnyCategory({ categoryCount: 1 })).toBe(true);
    expect(Object.keys({ categoryCount: 1 })).toEqual(['categoryCount']);
  });
});

describe('AC4/AC12 — the machine', () => {
  it('starts at DRAFT and knows only the two states this ticket ships', () => {
    expect(jobMachine.initial).toBe('DRAFT');
    expect([...jobMachine.states].sort()).toEqual(['DRAFT', 'OPEN']);
  });

  it('is named `job`, which is what lands in every audit row', () => {
    expect(jobMachine.name).toBe('job');
  });

  it('moves DRAFT → OPEN on PUBLISH when a category exists', () => {
    expect(can(jobMachine, 'DRAFT', 'PUBLISH', { categoryCount: 1 })).toBe(true);
  });

  it('refuses PUBLISH from DRAFT with no category', () => {
    expect(can(jobMachine, 'DRAFT', 'PUBLISH', { categoryCount: 0 })).toBe(false);
  });

  it('refuses PUBLISH from OPEN — publishing twice is not a transition', () => {
    const result = check(jobMachine, 'OPEN', 'PUBLISH', { categoryCount: 1 });
    expect(result).not.toBe(true);
  });

  it('declares OPEN terminal — true of this machine, not of the product', () => {
    // `defineMachine` refuses an undeclared dead end, and it is right to: within W4-T01 there is
    // genuinely no way out of OPEN. W4-T02 removes this in the same change that adds AWARDED.
    expect(jobMachine.terminal).toEqual(['OPEN']);
  });
});

describe('AC8 — urgency is the vocabulary that already exists', () => {
  it('is exactly SearchUrgencySchema values, not a parallel enum', () => {
    expect(JobUrgencySchema.options).toEqual(SearchUrgencySchema.options);
  });
});

describe('the budget range', () => {
  it('accepts both ends null — "I don\'t know" is a legitimate answer', () => {
    expect(BudgetRangeSchema.safeParse({ minCents: null, maxCents: null }).success).toBe(true);
  });

  it('accepts one end only', () => {
    expect(BudgetRangeSchema.safeParse({ minCents: 100000, maxCents: null }).success).toBe(true);
    expect(BudgetRangeSchema.safeParse({ minCents: null, maxCents: 100000 }).success).toBe(true);
  });

  it('refuses an inverted range, which is a typo rather than a preference', () => {
    const result = BudgetRangeSchema.safeParse({ minCents: 500000, maxCents: 100000 });
    expect(result.success).toBe(false);
  });

  it('refuses negative money', () => {
    expect(BudgetRangeSchema.safeParse({ minCents: -1, maxCents: null }).success).toBe(false);
  });
});

describe('the wire shape', () => {
  const minimal = {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'DRAFT' as const,
    title: null,
    description: null,
    categories: [],
    urgency: null,
    budget: { minCents: null, maxCents: null },
    location: null,
    publishedAt: null,
    createdAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
  };

  it('a job with nothing filled in is a valid job', () => {
    expect(JobSchema.safeParse(minimal).success).toBe(true);
  });

  it('an OPEN job may still have a null location — AC7', () => {
    // A client with no saved address still gets to post. The job will not match a radius query
    // until one exists, which is W4-T07's problem, not a reason to refuse the post.
    const open = { ...minimal, status: 'OPEN' as const, publishedAt: '2026-09-20T10:05:00.000Z' };
    expect(JobSchema.safeParse(open).success).toBe(true);
  });

  it('carries several categories', () => {
    const parsed = JobSchema.safeParse({
      ...minimal,
      categories: [
        { slug: 'alicatado', nameEs: 'Alicatado', nameEn: 'Tiling', requiresLicence: false },
        { slug: 'fontaneria', nameEs: 'Fontanería', nameEn: 'Plumbing', requiresLicence: false },
        {
          slug: 'electricidad',
          nameEs: 'Electricidad',
          nameEn: 'Electrical',
          requiresLicence: true,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('knows only the states this ticket ships', () => {
    expect(JobStatusSchema.safeParse('AWARDED').success).toBe(false);
    expect(JobStatusSchema.options).toEqual(['DRAFT', 'OPEN']);
  });
});
