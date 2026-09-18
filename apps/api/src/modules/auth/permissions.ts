/**
 * `W2-T03` — the permissions matrix.
 *
 * One table, and a predicate over it. It is deliberately dull: everything interesting about a
 * refusal happens in `guard.ts`, and everything interesting about *who may do what* should be
 * readable in twenty seconds by an agent who has never opened this slice.
 *
 * Spec: `docs/specs/S2/W2-T03-route-guards.md` §3.5, §5.
 */
import { UserRole } from '@prisma/client';

/**
 * A matrix keys on `UserRole` and nothing else — §3.5.2.
 *
 * `MANITAS`/`PRO` is `ProviderProfile.kind`, a column on the *profile*; `electricista` and
 * `fontanero` are rows in the `Category` tree; "may work a gated category" is a `Certification`.
 * None of them can appear here, and that is enforced by this type rather than by review: a guard
 * runs before any repository, so a permission that needs a row to evaluate is not a permission, it
 * is a query.
 */
export type PermissionMatrix = Readonly<Record<string, readonly UserRole[]>>;

/**
 * Every operation the API guards, and the roles allowed to perform it.
 *
 * **A permission enters this table in the same pull request as the route that guards with it.**
 * Pre-populating rows for tickets that have not landed produces cells nothing enforces — the same
 * empty promise as a database column nothing ever writes to. One row today, because one route
 * needs one (`W3-T02`).
 *
 * **`ADMIN` is not implicit.** There is no superuser branch anywhere in this module: an admin is
 * allowed exactly what lists it, which is currently nothing. A blanket bypass is how a back-office
 * role acquires a refund permission without anyone deciding it should — and the role that will
 * read money is deliberately *not* the one `W9-T04` gives to moderators (`MEM-2026-09-18-2`).
 */
export const PERMISSIONS = {
  /** `W3-T02`. "Own" is not checked here — `/me` addressing makes it structural (§3.6). */
  'provider-profile:update-own': ['PROVIDER'],
} as const satisfies PermissionMatrix;

export type Permission = keyof typeof PERMISSIONS;

/**
 * The roles the schema has, read from Prisma's generated enum rather than restated.
 *
 * The matrix-driven test enumerates this, so a role added to `schema.prisma` immediately gets a
 * deny test against every existing permission — which is the moment to decide what it may do,
 * rather than six tickets later.
 */
export const ALL_ROLES: readonly UserRole[] = Object.values(UserRole);

/**
 * May any of these roles perform this operation?
 *
 * Roles are a **set**: `app_user.roles` is `UserRole[]` and a provider is normally
 * `['CLIENT','PROVIDER']`, so this is an intersection test and never `roles[0]`.
 *
 * An operation absent from the matrix is denied. A typo in a route's `requirePermission` is a type
 * error at the call site; this is the second gate, for the case where the matrix is built at
 * runtime.
 */
export function can(
  matrix: PermissionMatrix,
  roles: readonly UserRole[],
  permission: string,
): boolean {
  const allowed = matrix[permission];
  if (allowed === undefined) return false;
  return roles.some((role) => allowed.includes(role));
}
