import { describe, expect, it, vi } from 'vitest';
import {
  AuditRecordSchema,
  StateMachineDefinitionError,
  TransitionRejected,
  can,
  check,
  defineMachine,
  transition,
  type AuditRecord,
  type AuditRecorder,
  type MachineDefinition,
} from '../src/index.js';

/* ------------------------------------------------------------------------------------------- *
 * The reference machine. `app_user.status` from W1-T05 — real states, already migrated, so the
 * live suite in apps/api can drive the same table (spec §3).
 * ------------------------------------------------------------------------------------------- */

type UserState = 'ACTIVE' | 'SUSPENDED' | 'DELETED';
type UserEvent = 'SUSPEND' | 'REINSTATE' | 'ERASE';
interface UserContext {
  readonly actorIsAdmin: boolean;
}

const adminOnly = (ctx: UserContext) =>
  ctx.actorIsAdmin ||
  ({ reason: 'Only an administrator may do this.', code: 'FORBIDDEN' } as const);

function userStatusDefinition(): MachineDefinition<UserState, UserEvent, UserContext> {
  return {
    name: 'app_user',
    initial: 'ACTIVE',
    states: ['ACTIVE', 'SUSPENDED', 'DELETED'],
    terminal: ['DELETED'],
    transitions: [
      { from: 'ACTIVE', on: 'SUSPEND', to: 'SUSPENDED', guard: adminOnly },
      { from: 'SUSPENDED', on: 'REINSTATE', to: 'ACTIVE', guard: adminOnly },
      { from: ['ACTIVE', 'SUSPENDED'], on: 'ERASE', to: 'DELETED' },
    ],
  };
}

const userStatus = () => defineMachine(userStatusDefinition());

const ADMIN: UserContext = { actorIsAdmin: true };
const NOT_ADMIN: UserContext = { actorIsAdmin: false };

const ENTITY_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const AT = new Date('2026-09-10T12:00:00.000Z');

/** A recorder that captures what it was given, so a test can assert on the record. */
function spyRecorder(): AuditRecorder & { calls: AuditRecord[] } {
  const calls: AuditRecord[] = [];
  const fn = vi.fn(async (record: AuditRecord) => {
    calls.push(record);
  });
  return Object.assign(fn as unknown as AuditRecorder, { calls });
}

function suspendRequest(overrides: Record<string, unknown> = {}) {
  return {
    entityId: ENTITY_ID,
    from: 'ACTIVE' as const,
    event: 'SUSPEND' as const,
    actor: { type: 'USER' as const, id: ACTOR_ID },
    context: ADMIN,
    now: () => AT,
    ...overrides,
  };
}

/* ------------------------------------------------------------------------------------------- *
 * §7 AC1..AC6 — the table is checked before it is used.
 * ------------------------------------------------------------------------------------------- */

describe('AC1..AC6 — defineMachine refuses a table that does not describe a machine', () => {
  it('AC1 — returns a frozen machine exposing what it was given', () => {
    const machine = userStatus();
    expect(machine.name).toBe('app_user');
    expect(machine.initial).toBe('ACTIVE');
    expect([...machine.states]).toEqual(['ACTIVE', 'SUSPENDED', 'DELETED']);
    expect([...machine.terminal]).toEqual(['DELETED']);
    expect(machine.transitions).toHaveLength(3);
    expect(Object.isFrozen(machine), 'a machine that can be mutated is a shared-state bug').toBe(
      true,
    );
  });

  it('AC2 — refuses a rule naming a state that is not declared, naming the state', () => {
    const broken = userStatusDefinition();
    const transitions = [
      ...broken.transitions,
      { from: 'ACTIVE' as UserState, on: 'ARCHIVE' as UserEvent, to: 'ARCHIVED' as UserState },
    ];
    expect(() => defineMachine({ ...broken, transitions })).toThrow(StateMachineDefinitionError);
    expect(() => defineMachine({ ...broken, transitions })).toThrow(/ARCHIVED/);
  });

  it('AC3 — refuses two rules for the same (from, event), which would depend on array order', () => {
    const broken = userStatusDefinition();
    const transitions = [
      ...broken.transitions,
      { from: 'ACTIVE' as UserState, on: 'SUSPEND' as UserEvent, to: 'DELETED' as UserState },
    ];
    expect(() => defineMachine({ ...broken, transitions })).toThrow(StateMachineDefinitionError);
    expect(() => defineMachine({ ...broken, transitions })).toThrow(
      /ACTIVE.*SUSPEND|SUSPEND.*ACTIVE/s,
    );
  });

  it('AC4 — refuses a state unreachable from initial, naming it', () => {
    const broken = userStatusDefinition();
    expect(() =>
      defineMachine({
        ...broken,
        states: [...broken.states, 'ORPHANED' as UserState],
        terminal: [...broken.terminal, 'ORPHANED' as UserState],
      }),
    ).toThrow(/ORPHANED/);
  });

  it('AC5 — refuses a dead-end state that was not declared terminal', () => {
    const broken = userStatusDefinition();
    expect(() => defineMachine({ ...broken, terminal: [] })).toThrow(StateMachineDefinitionError);
    expect(() => defineMachine({ ...broken, terminal: [] })).toThrow(/DELETED/);
  });

  it('AC6 — refuses a terminal state that has an outgoing transition', () => {
    const broken = userStatusDefinition();
    expect(() =>
      defineMachine({ ...broken, terminal: ['DELETED' as UserState, 'ACTIVE' as UserState] }),
    ).toThrow(/ACTIVE/);
  });
});

/* ------------------------------------------------------------------------------------------- *
 * §7 AC7..AC14 — the decision.
 * ------------------------------------------------------------------------------------------- */

describe('AC7..AC14 — a transition is permitted only if the table says so', () => {
  it('AC7 — a declared transition whose guard passes resolves with the target state', async () => {
    const result = await transition(userStatus(), suspendRequest(), spyRecorder());
    expect(result.to).toBe('SUSPENDED');
  });

  it('AC8 — no rule for (from, event) is CONFLICT, and names entity, from and event', async () => {
    const record = spyRecorder();
    const failure = await transition(
      userStatus(),
      suspendRequest({ from: 'SUSPENDED', event: 'SUSPEND' }),
      record,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TransitionRejected);
    const rejected = failure as TransitionRejected;
    expect(rejected.code).toBe('CONFLICT');
    expect(rejected.entity).toBe('app_user');
    expect(rejected.from).toBe('SUSPENDED');
    expect(rejected.event).toBe('SUSPEND');
  });

  it('AC9 — any event applied to a terminal state is CONFLICT', async () => {
    const failure = await transition(
      userStatus(),
      suspendRequest({ from: 'DELETED', event: 'REINSTATE' }),
      spyRecorder(),
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(TransitionRejected);
    expect((failure as TransitionRejected).code).toBe('CONFLICT');
  });

  it('AC10 — a guard rejection carries its own reason, and defaults to CONFLICT', async () => {
    const machine = defineMachine<UserState, UserEvent, UserContext>({
      ...userStatusDefinition(),
      transitions: [
        {
          from: 'ACTIVE',
          on: 'SUSPEND',
          to: 'SUSPENDED',
          guard: () => ({ reason: 'The account has an open booking.' }),
        },
        { from: 'SUSPENDED', on: 'REINSTATE', to: 'ACTIVE' },
        { from: ['ACTIVE', 'SUSPENDED'], on: 'ERASE', to: 'DELETED' },
      ],
    });

    const failure = await transition(machine, suspendRequest(), spyRecorder()).catch(
      (error: unknown) => error,
    );
    expect((failure as TransitionRejected).reason).toBe('The account has an open booking.');
    expect((failure as TransitionRejected).code).toBe('CONFLICT');
  });

  it('AC11 — a guard may reject with FORBIDDEN, and that reaches the caller', async () => {
    const failure = await transition(
      userStatus(),
      suspendRequest({ context: NOT_ADMIN }),
      spyRecorder(),
    ).catch((error: unknown) => error);

    expect((failure as TransitionRejected).code).toBe('FORBIDDEN');
    expect((failure as TransitionRejected).reason).toMatch(/administrator/i);
  });

  it('AC12 — the guard receives the context the caller passed', async () => {
    const seen: UserContext[] = [];
    const machine = defineMachine<UserState, UserEvent, UserContext>({
      ...userStatusDefinition(),
      transitions: [
        {
          from: 'ACTIVE',
          on: 'SUSPEND',
          to: 'SUSPENDED',
          guard: (ctx) => {
            seen.push(ctx);
            return true;
          },
        },
        { from: 'SUSPENDED', on: 'REINSTATE', to: 'ACTIVE' },
        { from: ['ACTIVE', 'SUSPENDED'], on: 'ERASE', to: 'DELETED' },
      ],
    });

    await transition(machine, suspendRequest({ context: NOT_ADMIN }), spyRecorder());
    expect(seen).toEqual([NOT_ADMIN]);
  });

  it('AC13 — check returns the rejection transition would throw, and records nothing', () => {
    const machine = userStatus();
    const result = check(machine, 'ACTIVE', 'SUSPEND', NOT_ADMIN);
    expect(result).not.toBe(true);
    expect(result).toMatchObject({ code: 'FORBIDDEN' });
    expect(check(machine, 'SUSPENDED', 'SUSPEND', ADMIN)).toMatchObject({ code: 'CONFLICT' });
    expect(check(machine, 'ACTIVE', 'SUSPEND', ADMIN)).toBe(true);
  });

  it('AC14 — can is true exactly when check returns true', () => {
    const machine = userStatus();
    expect(can(machine, 'ACTIVE', 'SUSPEND', ADMIN)).toBe(true);
    expect(can(machine, 'ACTIVE', 'SUSPEND', NOT_ADMIN)).toBe(false);
    expect(can(machine, 'DELETED', 'ERASE', ADMIN)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------- *
 * §7 AC15..AC21 — the audit record.
 * ------------------------------------------------------------------------------------------- */

describe('AC15..AC21 — no path to a new state avoids the recorder', () => {
  it('AC15 — a permitted transition calls the recorder exactly once', async () => {
    const record = spyRecorder();
    await transition(userStatus(), suspendRequest(), record);
    expect(record.calls).toHaveLength(1);
  });

  it('AC16 — the record parses, and carries the machine, the entity, the event and the actor', async () => {
    const record = spyRecorder();
    const result = await transition(
      userStatus(),
      suspendRequest({ metadata: { note: 'repeated chargebacks' } }),
      record,
    );

    const written = record.calls[0];
    expect(written).toEqual(result.audit);
    expect(
      AuditRecordSchema.safeParse(written).success,
      'the record does not match its schema',
    ).toBe(true);
    expect(written).toMatchObject({
      entity: 'app_user',
      entityId: ENTITY_ID,
      action: 'SUSPEND',
      fromState: 'ACTIVE',
      toState: 'SUSPENDED',
      actorType: 'USER',
      actorId: ACTOR_ID,
      metadata: { note: 'repeated chargebacks' },
    });
  });

  it('AC16b — a SYSTEM actor writes a null actorId', async () => {
    const record = spyRecorder();
    await transition(
      userStatus(),
      suspendRequest({ event: 'ERASE', actor: { type: 'SYSTEM' } }),
      record,
    );
    expect(record.calls[0]).toMatchObject({ actorType: 'SYSTEM', actorId: null });
    expect(AuditRecordSchema.safeParse(record.calls[0]).success).toBe(true);
  });

  it('AC17 — a rejected transition records nothing', async () => {
    const record = spyRecorder();
    await transition(userStatus(), suspendRequest({ context: NOT_ADMIN }), record).catch(
      () => undefined,
    );
    await transition(userStatus(), suspendRequest({ from: 'DELETED' }), record).catch(
      () => undefined,
    );
    expect(record.calls).toHaveLength(0);
  });

  it('AC18 — a recorder that rejects fails the transition, and no state comes back', async () => {
    const boom = new Error('audit write failed');
    const failure = await transition(userStatus(), suspendRequest(), () =>
      Promise.reject(boom),
    ).catch((error: unknown) => error);
    expect(failure).toBe(boom);
  });

  it('AC19 — the schema is strict: an undeclared key is rejected', () => {
    const record = spyRecorder();
    return transition(userStatus(), suspendRequest(), record).then(() => {
      const written = { ...(record.calls[0] as AuditRecord), sneaked: 'in' };
      expect(AuditRecordSchema.safeParse(written).success).toBe(false);
    });
  });

  it('AC20 — actorType and actorId are one fact and cannot disagree', () => {
    const base = {
      entity: 'app_user',
      entityId: ENTITY_ID,
      action: 'SUSPEND',
      fromState: 'ACTIVE',
      toState: 'SUSPENDED',
      at: AT,
    };
    expect(
      AuditRecordSchema.safeParse({ ...base, actorType: 'SYSTEM', actorId: ACTOR_ID }).success,
      'a SYSTEM actor carrying a user id was accepted',
    ).toBe(false);
    expect(
      AuditRecordSchema.safeParse({ ...base, actorType: 'USER', actorId: null }).success,
      'a USER actor with no id was accepted',
    ).toBe(false);
  });

  it('AC21 — `at` comes from the injected clock, so a test can assert an exact instant', async () => {
    const record = spyRecorder();
    await transition(userStatus(), suspendRequest(), record);
    expect(record.calls[0]?.at).toEqual(AT);
  });
});
