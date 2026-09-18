/**
 * `W2-T03` — the permissions matrix, as a pure table.
 *
 * No Fastify, no session, no database: what is asserted here is the table and the predicate over
 * it. `guard.test.ts` asserts what an HTTP request does with the answer.
 *
 * Spec: `docs/specs/S2/W2-T03-route-guards.md` §3.5, §5.
 */
import { describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import { ALL_ROLES, can, PERMISSIONS } from '../src/modules/auth/permissions.js';

describe('W2-T03 §5 — the matrix', () => {
  it('lists every role the schema has, and no others', () => {
    // The matrix keys on `UserRole`; if a role is added to the enum this assertion is the first
    // thing that notices, before a cell somewhere silently means "deny".
    expect([...ALL_ROLES].sort()).toEqual(Object.values(UserRole).sort());
  });

  it('allows a PROVIDER to update their own profile — the one row with a consumer', () => {
    expect(can(PERMISSIONS, ['PROVIDER'], 'provider-profile:update-own')).toBe(true);
  });

  it('denies a CLIENT the same permission — being a customer is not being a provider', () => {
    expect(can(PERMISSIONS, ['CLIENT'], 'provider-profile:update-own')).toBe(false);
  });

  it('denies an ADMIN a permission that does not list it — no implicit superuser', () => {
    expect(can(PERMISSIONS, ['ADMIN'], 'provider-profile:update-own')).toBe(false);
  });

  it('treats roles as a set, not a scalar — [CLIENT, PROVIDER] passes a PROVIDER permission', () => {
    expect(can(PERMISSIONS, ['CLIENT', 'PROVIDER'], 'provider-profile:update-own')).toBe(true);
  });

  it('denies an empty role list', () => {
    expect(can(PERMISSIONS, [], 'provider-profile:update-own')).toBe(false);
  });

  it('denies a permission that is not in the matrix at all', () => {
    // A typo in a route's `requirePermission` must not be an open door. The type system catches
    // this at the call site; the predicate is the second gate.
    expect(can(PERMISSIONS, ['ADMIN'], 'no-such-permission')).toBe(false);
  });
});

describe('W2-T03 §3.5.2 — the matrix keys on UserRole and nothing else', () => {
  it('AC17: a ProviderKind in a cell does not compile', () => {
    // MANITAS/PRO is `ProviderProfile.kind` — a column, not a role (`schema.prisma:58`), and a
    // trade like `electricista` is a Category. Neither may become a role: the guard runs before
    // any repository, so a permission that needs a row to evaluate is a query, not a permission.
    // @ts-expect-error 'MANITAS' is a ProviderKind, not a UserRole
    const invalid = { 'provider-profile:update-own': ['MANITAS'] } satisfies Record<
      string,
      readonly UserRole[]
    >;

    expect(invalid).toBeDefined();
  });
});
