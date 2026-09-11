/**
 * One mechanism for moving anything between states.
 *
 * Six things in this product have a lifecycle — Job, Booking, Payment, Auction, EmergencyRequest,
 * Certification (`TODO.md` §3) — and six different agents will build them. Without this, each one
 * writes `status = 'X'` at whatever call site needed it, guards it with whatever `if` was to hand,
 * and records the change nowhere. The question "why is this booking cancelled?" then has no
 * answer, because the only evidence a transition happened is the column that no longer shows what
 * it replaced.
 *
 * This module owns no states of its own. `Booking`'s states belong to `agent-money`. What belongs
 * here is the guarantee that whatever those states are, moving between them is declared, guarded
 * and recorded the same way.
 *
 * Frozen seam — changing a shape here costs an ADR (`agents/policies/contract-change.md`).
 * Spec: `docs/specs/S1/W1-T07-state-machine.md`.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------------------------------- *
 * Shapes
 * ------------------------------------------------------------------------------------------- */

export type Json = z.infer<ReturnType<typeof z.json>>;
export type JsonObject = Record<string, Json>;

/**
 * `CONFLICT` (409) is the default because it is the safe error to be wrong with: it tells the
 * caller nothing about whether *someone else* could have done it. A guard that refuses on who is
 * asking rather than on the entity's condition says `FORBIDDEN` (403) explicitly. Both codes are
 * already in `ERROR_CODES` (`W1-T01`), so a rejection needs no new code.
 */
export type RejectionCode = 'CONFLICT' | 'FORBIDDEN';

export interface TransitionRejection {
  readonly reason: string;
  readonly code?: RejectionCode;
}

/**
 * A guard allows by returning `true` and refuses by returning a reason. Bare `false` is
 * deliberately not accepted: an unexplained 409 becomes a support ticket. The union reads
 * naturally with `||`:
 *
 * ```ts
 * guard: (ctx) => ctx.isPaid || { reason: 'The booking is not paid.' }
 * ```
 */
export type GuardResult = true | TransitionRejection;

export interface TransitionDef<S extends string, E extends string, Ctx> {
  /** One state, or several — `CANCEL` from any of four states is one rule in the reader's head. */
  readonly from: S | readonly S[];
  readonly on: E;
  readonly to: S;
  /**
   * Synchronous and pure, on purpose (spec Decision D). A guard that could query is a guard that
   * decides differently depending on when it runs, and it drags a database into every test of the
   * decision. Whatever it needs, the caller loads first and passes as `context`.
   */
  readonly guard?: (context: Ctx) => GuardResult;
}

export interface MachineDefinition<S extends string, E extends string, Ctx> {
  /** Written into every audit record as `entity` — `booking`, `job`, `app_user`. */
  readonly name: string;
  readonly initial: S;
  readonly states: readonly S[];
  /** States with no way out. Declared rather than inferred — see `defineMachine`. */
  readonly terminal: readonly S[];
  readonly transitions: readonly TransitionDef<S, E, Ctx>[];
}

export type StateMachine<S extends string, E extends string, Ctx> = MachineDefinition<S, E, Ctx>;

/** A scheduled auction close and a Stripe webhook are real transitions with nobody behind them. */
export type Actor = { readonly type: 'USER'; readonly id: string } | { readonly type: 'SYSTEM' };

export interface AuditRecord {
  readonly entity: string;
  readonly entityId: string;
  readonly action: string;
  readonly fromState: string;
  readonly toState: string;
  readonly actorType: 'USER' | 'SYSTEM';
  readonly actorId: string | null;
  readonly metadata?: JsonObject;
  readonly at: Date;
}

/**
 * Whatever persists the record. Typed as a plain function rather than a Prisma client because
 * `apps/web` imports this package: a Prisma import here would put the query engine into the
 * browser bundle. The caller binds it to its own transaction client (spec Decision B/C):
 *
 * ```ts
 * (audit) => tx.auditRecord.create({ data: audit }).then(() => undefined)
 * ```
 */
export type AuditRecorder = (record: AuditRecord) => Promise<void>;

export interface TransitionRequest<S extends string, E extends string, Ctx> {
  readonly entityId: string;
  readonly from: S;
  readonly event: E;
  readonly actor: Actor;
  readonly context: Ctx;
  readonly metadata?: JsonObject;
  /** Injectable clock, so a test asserts an exact instant rather than a range. */
  readonly now?: () => Date;
}

export interface TransitionResult<S extends string> {
  readonly to: S;
  readonly audit: AuditRecord;
}

/* ------------------------------------------------------------------------------------------- *
 * Failures
 * ------------------------------------------------------------------------------------------- */

/**
 * A malformed transition table. A **defect**, in the same class as `MoneyError` (`W1-T06` §4.5):
 * it means an agent wrote a table that does not describe a machine. Thrown at module load, so the
 * process does not start — never caught and turned into a client error, because there is no input
 * a client can send that causes it.
 */
export class StateMachineDefinitionError extends Error {
  public override readonly name = 'StateMachineDefinitionError';
}

/**
 * The transition was not permitted. Carries `entity`, `from`, `event`, `reason` and `code` as
 * fields rather than only in the message, so a route builds the error envelope without parsing a
 * string.
 */
export class TransitionRejected extends Error {
  public override readonly name = 'TransitionRejected';
  public readonly code: RejectionCode;
  public readonly reason: string;
  public readonly entity: string;
  public readonly from: string;
  public readonly event: string;

  constructor(entity: string, from: string, event: string, rejection: TransitionRejection) {
    super(`${entity}: cannot apply ${event} from ${from} — ${rejection.reason}`);
    this.entity = entity;
    this.from = from;
    this.event = event;
    this.reason = rejection.reason;
    this.code = rejection.code ?? 'CONFLICT';
  }
}

/* ------------------------------------------------------------------------------------------- *
 * The audit record schema
 * ------------------------------------------------------------------------------------------- */

const AUDIT_BASE = {
  entity: z.string().min(1),
  entityId: z.uuid(),
  action: z.string().min(1),
  fromState: z.string().min(1),
  toState: z.string().min(1),
  metadata: z.record(z.string(), z.json()).optional(),
  at: z.date(),
};

/**
 * Discriminated on `actorType` for the same reason `ErrorBodySchema` is (`W1-T01`): the two actor
 * columns are **one fact** and must not be able to disagree. A `SYSTEM` actor carrying a user id
 * is not a variation, it is a contradiction. `audit_record_actor_pairing_check` says the same
 * thing at the column, because not every writer will come through this seam.
 */
export const AuditRecordSchema = z.discriminatedUnion('actorType', [
  z.strictObject({ actorType: z.literal('USER'), actorId: z.uuid(), ...AUDIT_BASE }),
  z.strictObject({ actorType: z.literal('SYSTEM'), actorId: z.null(), ...AUDIT_BASE }),
]);

/* ------------------------------------------------------------------------------------------- *
 * Definition
 * ------------------------------------------------------------------------------------------- */

function fail(message: string): never {
  throw new StateMachineDefinitionError(message);
}

const froms = <S extends string>(from: S | readonly S[]): readonly S[] =>
  Array.isArray(from) ? (from as readonly S[]) : ([from] as readonly S[]);

/**
 * Validates the table and returns it frozen. Everything is checked **at definition time**, which
 * is module load: a malformed machine fails the process at boot rather than the first request that
 * happens to touch it.
 */
export function defineMachine<const S extends string, const E extends string, Ctx = void>(
  definition: MachineDefinition<S, E, Ctx>,
): StateMachine<S, E, Ctx> {
  const { name, initial, states, terminal, transitions } = definition;

  if (name.trim() === '') fail('A machine needs a name: it is written into every audit record.');
  if (states.length === 0) fail(`${name}: a machine with no states is not a machine.`);

  const declared = new Set<string>(states);
  if (!declared.has(initial)) {
    fail(`${name}: initial state "${initial}" is not in states [${states.join(', ')}].`);
  }

  // Unknown states first: every later check reads the table as if the names were real.
  for (const rule of transitions) {
    for (const from of froms(rule.from)) {
      if (!declared.has(from)) {
        fail(`${name}: rule (${from}, ${rule.on}) names unknown state "${from}".`);
      }
    }
    if (!declared.has(rule.to)) {
      fail(`${name}: rule (${String(rule.from)}, ${rule.on}) names unknown state "${rule.to}".`);
    }
  }

  // Determinism. Two rules for one (from, event) would make the outcome depend on array order,
  // which is the kind of bug that survives review because the table still reads correctly.
  const seen = new Map<string, S>();
  const outgoing = new Map<S, number>();
  for (const rule of transitions) {
    for (const from of froms(rule.from)) {
      const key = `${from} ${rule.on}`;
      const existing = seen.get(key);
      if (existing !== undefined) {
        fail(
          `${name}: two rules for (${from}, ${rule.on}) — one to "${existing}", one to ` +
            `"${rule.to}". Which one wins would depend on the order of the array.`,
        );
      }
      seen.set(key, rule.to);
      outgoing.set(from, (outgoing.get(from) ?? 0) + 1);
    }
  }

  // Terminal states are declared, not inferred. A state that became a dead end because a rule was
  // forgotten is indistinguishable from one that is terminal by design unless the author says so.
  const terminalSet = new Set<string>(terminal);
  for (const state of terminal) {
    if (!declared.has(state)) fail(`${name}: terminal state "${state}" is not in states.`);
  }
  for (const state of states) {
    const hasExit = (outgoing.get(state) ?? 0) > 0;
    if (hasExit && terminalSet.has(state)) {
      fail(`${name}: state "${state}" is declared terminal but has an outgoing transition.`);
    }
    if (!hasExit && !terminalSet.has(state)) {
      fail(
        `${name}: state "${state}" has no outgoing transition but is not declared terminal. ` +
          `Add it to \`terminal\`, or add the rule that is missing.`,
      );
    }
  }

  // Reachability. An orphan state is either a typo or a flow nobody can enter; both are bugs.
  const reachable = new Set<S>([initial]);
  const queue: S[] = [initial];
  while (queue.length > 0) {
    const current = queue.shift() as S;
    for (const rule of transitions) {
      if (froms(rule.from).includes(current) && !reachable.has(rule.to)) {
        reachable.add(rule.to);
        queue.push(rule.to);
      }
    }
  }
  for (const state of states) {
    if (!reachable.has(state)) {
      fail(`${name}: state "${state}" is not reachable from "${initial}" by any declared rule.`);
    }
  }

  return Object.freeze({
    name,
    initial,
    states: Object.freeze([...states]),
    terminal: Object.freeze([...terminal]),
    transitions: Object.freeze(transitions.map((rule) => Object.freeze({ ...rule }))),
  });
}

/* ------------------------------------------------------------------------------------------- *
 * The decision
 * ------------------------------------------------------------------------------------------- */

function ruleFor<S extends string, E extends string, Ctx>(
  machine: StateMachine<S, E, Ctx>,
  from: S,
  event: E,
): TransitionDef<S, E, Ctx> | undefined {
  return machine.transitions.find((rule) => rule.on === event && froms(rule.from).includes(from));
}

/**
 * The whole decision, with no side effects. `transition` is this plus the write, so the two can
 * never disagree about whether something is allowed.
 */
export function check<S extends string, E extends string, Ctx>(
  machine: StateMachine<S, E, Ctx>,
  from: S,
  event: E,
  context: Ctx,
): true | Required<TransitionRejection> {
  const rule = ruleFor(machine, from, event);
  if (rule === undefined) {
    return {
      code: 'CONFLICT',
      reason: machine.terminal.includes(from)
        ? `${from} is a final state: nothing further can happen to this ${machine.name}.`
        : `${machine.name} cannot go from ${from} via ${event}.`,
    };
  }
  if (rule.guard !== undefined) {
    const verdict = rule.guard(context);
    if (verdict !== true) return { code: verdict.code ?? 'CONFLICT', reason: verdict.reason };
  }
  return true;
}

/** `check(...) === true`. For the caller that only needs to decide whether to render a button. */
export function can<S extends string, E extends string, Ctx>(
  machine: StateMachine<S, E, Ctx>,
  from: S,
  event: E,
  context: Ctx,
): boolean {
  return check(machine, from, event, context) === true;
}

/* ------------------------------------------------------------------------------------------- *
 * The transition
 * ------------------------------------------------------------------------------------------- */

/**
 * Move an entity between states, recording that it happened.
 *
 * The recorder is a **required parameter**: there is no overload that omits it, so a caller cannot
 * obtain the new state without having supplied something that persists the record. That is what
 * makes "every transition writes an audit record" a fact the type checker enforces rather than one
 * review has to notice.
 *
 * Call it inside a transaction and let the recorder write through the same client. `transition`
 * cannot open one — it has no database handle, by design (Decision B) — so atomicity is the
 * caller's to provide, and the recorder's failure is propagated unchanged to make it possible.
 */
export async function transition<S extends string, E extends string, Ctx>(
  machine: StateMachine<S, E, Ctx>,
  request: TransitionRequest<S, E, Ctx>,
  record: AuditRecorder,
): Promise<TransitionResult<S>> {
  const verdict = check(machine, request.from, request.event, request.context);
  if (verdict !== true) {
    throw new TransitionRejected(machine.name, request.from, request.event, verdict);
  }

  // `check` returning true means a rule exists, so this cannot be undefined.
  const to = (ruleFor(machine, request.from, request.event) as TransitionDef<S, E, Ctx>).to;
  const now = request.now ?? (() => new Date());

  const audit: AuditRecord = Object.freeze({
    entity: machine.name,
    entityId: request.entityId,
    action: request.event,
    fromState: request.from,
    toState: to,
    actorType: request.actor.type,
    actorId: request.actor.type === 'USER' ? request.actor.id : null,
    // Omitted rather than null when absent: Prisma's nullable Json fields do not accept a plain
    // `null`, and an absent key is what produces a NULL column.
    ...(request.metadata === undefined ? {} : { metadata: request.metadata }),
    at: now(),
  });

  // Before the state is returned, and its failure is not swallowed. A rejected transition never
  // reaches this line (AC17): a refusal is not an event that happened to the entity.
  await record(audit);

  return { to, audit };
}
