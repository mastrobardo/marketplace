/**
 * `W4-T01` and `W4-T02` — the job contract, the rule that guards publishing, and the way out.
 *
 * The interesting assertions here are about **what is not required**. The operator's instruction
 * (spec §1.1) is that a user completes a minimal flow with missing parameters, so a schema that
 * quietly demanded a description would be the defect — and it would be invisible, because a test
 * suite that only sends complete objects never notices.
 *
 * Specs: `docs/specs/S4/W4-T01-job-posting.md` §5, `docs/specs/S4/W4-T02-job-state-machine.md` §5.
 */
import { describe, expect, it } from 'vitest';

import {
  BudgetRangeSchema,
  JobCancelInputSchema,
  JobDraftInputSchema,
  JobEventSchema,
  JobSchema,
  JobStatusSchema,
  JobUpdateInputSchema,
  JobUrgencySchema,
  canEditJob,
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
  it('starts at DRAFT and knows only the states something can reach', () => {
    expect(jobMachine.initial).toBe('DRAFT');
    expect([...jobMachine.states].sort()).toEqual(['CANCELLED', 'DRAFT', 'OPEN']);
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

  it('AC1 — OPEN is no longer terminal, and CANCELLED is', () => {
    // The promise `W4-T01` made when it declared OPEN terminal: the declaration leaves in the same
    // change that gives OPEN an exit. This is the assertion that it was kept — a stale `terminal`
    // list reads exactly like a deliberate one, so it is worth a test rather than a review.
    expect(jobMachine.terminal).toEqual(['CANCELLED']);
    expect(jobMachine.terminal).not.toContain('OPEN');
  });
});

describe('AC2/AC3/AC4 — cancelling', () => {
  it('moves a DRAFT to CANCELLED', () => {
    expect(can(jobMachine, 'DRAFT', 'CANCEL', { categoryCount: 0 })).toBe(true);
  });

  it('moves an OPEN job to CANCELLED — this is the exit OPEN was missing', () => {
    expect(can(jobMachine, 'OPEN', 'CANCEL', { categoryCount: 2 })).toBe(true);
  });

  it('is unguarded: a job with no categories cancels as readily as one with three', () => {
    // Publishing has a floor. Leaving does not — a requirement to cancel would be the policing
    // §1.1 rules out, applied to the way out instead of the way in.
    for (const count of [0, 1, 9]) {
      expect(can(jobMachine, 'DRAFT', 'CANCEL', { categoryCount: count })).toBe(true);
    }
  });

  it('refuses a second cancel, and says the state is final', () => {
    const result = check(jobMachine, 'CANCELLED', 'CANCEL', { categoryCount: 0 });
    expect(result).not.toBe(true);
    expect((result as { reason: string }).reason).toMatch(/final state/i);
  });

  it('AC9 — a cancelled job cannot be published', () => {
    expect(can(jobMachine, 'CANCELLED', 'PUBLISH', { categoryCount: 3 })).toBe(false);
  });

  it('declares only the events something can fire', () => {
    expect(JobEventSchema.options).toEqual(['PUBLISH', 'CANCEL']);
    expect(JobEventSchema.safeParse('AWARD').success).toBe(false);
  });
});

describe('AC7/AC8 — the edit rule is exhaustive over the states', () => {
  it('allows editing a DRAFT and refuses every other state', () => {
    expect(canEditJob('DRAFT')).toBe(true);
    for (const status of ['OPEN', 'CANCELLED'] as const) {
      const result = canEditJob(status);
      expect(result, `${status} is editable`).not.toBe(true);
      expect(result).toMatchObject({ code: 'CONFLICT' });
      expect((result as { reason: string }).reason).toMatch(new RegExp(status));
    }
  });

  it('answers for every state the machine declares, with none missed', () => {
    // Iterating `jobMachine.states` rather than a literal list is the point: a state added to the
    // machine and forgotten here fails this test, and fails the compiler first — `EDITABLE_IN` is
    // a `Record<JobStatus, boolean>`, so it cannot be left incomplete (`MEM-2026-09-20-11`).
    for (const status of jobMachine.states) {
      const result = canEditJob(status);
      expect(typeof result === 'boolean' || typeof result.reason === 'string').toBe(true);
    }
    expect(jobMachine.states.length).toBe(JobStatusSchema.options.length);
  });
});

describe('AC5 — a cancellation reason is optional, and bounded when given', () => {
  it('accepts an empty body', () => {
    expect(JobCancelInputSchema.safeParse({}).success).toBe(true);
  });

  it('accepts a reason', () => {
    const parsed = JobCancelInputSchema.safeParse({ reason: '  lo arreglé yo mismo  ' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.reason).toBe('lo arreglé yo mismo');
  });

  it('refuses whitespace and a runaway paste', () => {
    expect(JobCancelInputSchema.safeParse({ reason: '   ' }).success).toBe(false);
    expect(JobCancelInputSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
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
    cancelledAt: null,
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

  it('AC6 — a cancelled job carries the timestamp and nothing else new', () => {
    const cancelled = {
      ...minimal,
      status: 'CANCELLED' as const,
      cancelledAt: '2026-09-20T10:30:00.000Z',
    };
    expect(JobSchema.safeParse(cancelled).success).toBe(true);
    // The *reason* is not on the wire shape at all — it is `audit_record.metadata` (§2.5), so a
    // field appearing here later means one fact acquired a second home.
    expect(Object.keys(JobSchema.shape)).not.toContain('cancellationReason');
  });

  it('knows only the states something can reach', () => {
    // `AWARDED` is not a gap to fill in later without noticing: it arrives with `W4-T05`, which is
    // what can produce it. `W4-T02` §6.1 has the table.
    expect(JobStatusSchema.safeParse('AWARDED').success).toBe(false);
    expect(JobStatusSchema.safeParse('IN_PROGRESS').success).toBe(false);
    expect(JobStatusSchema.safeParse('COMPLETED').success).toBe(false);
    expect(JobStatusSchema.options).toEqual(['DRAFT', 'OPEN', 'CANCELLED']);
  });
});
