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

  /**
   * `W4-T01`, and `job:cancel-own` from `W4-T02`. All five are `CLIENT`, and that is a statement
   * about *capacity*, not about people: `roles` is a set and a provider is normally
   * `['CLIENT','PROVIDER']`, so a tradesperson posting a job is a client doing it and passes.
   *
   * "Own" is **not** enforced here either. Four of these address `/:id`, where it cannot be
   * structural, so the repository scopes every query by `clientId` and a stranger's job is `404`
   * (spec §3). A permission that needed the row to decide would not be a permission — it would be
   * a query, and guards run before any repository. `job:read-own` is the exception and now reads
   * as one: it guards `GET /api/me/jobs`, where the principal *is* the scope (`W4-T02` §2.4).
   *
   * Cancelling is its own permission rather than part of `job:update-own`, because they are not
   * the same capability: editing changes what a job says, cancelling ends it. A subscription tier
   * or a moderation rule that wanted to restrict one of those would have no way to name it.
   */
  'job:create': ['CLIENT'],
  'job:read-own': ['CLIENT'],
  'job:update-own': ['CLIENT'],
  'job:publish-own': ['CLIENT'],
  'job:cancel-own': ['CLIENT'],

  /**
   * `W4-T03`. **Three for the provider, one for the client, and the split is the point.**
   *
   * A client reading the quotes on their own job and a provider reading their own quotes are not
   * the same capability. One permission covering both would make *"can a provider see a
   * competitor's price?"* a question about a `WHERE` clause somewhere, rather than a question a
   * reader can answer from this file.
   *
   * `quote:create` is `PROVIDER` because quoting is a professional capacity — and, unlike the job
   * permissions above, the role is not enough on its own: the repository also requires a
   * `ProviderProfile`, since a quote is written *by a profile*, which is what carries the rating
   * and the rate a client weighs it by.
   */
  'quote:create': ['PROVIDER'],
  'quote:read-own': ['PROVIDER'],
  'quote:withdraw-own': ['PROVIDER'],
  'quote:read-for-own-job': ['CLIENT'],
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
