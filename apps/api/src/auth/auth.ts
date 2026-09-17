import { betterAuth, APIError, BASE_ERROR_CODES } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { PrismaClient } from '@prisma/client';

import { type Config } from '../config.js';
import { type Mailer } from './mail.js';

/**
 * `ADR-005`: better-auth, self-hosted, against our own Postgres, with `app_user` staying the user
 * record. This file is the mapping — the whole of `W2-T01`'s decision surface in one object.
 *
 * Read `docs/specs/S2/W2-T01-auth-signup-login.md` §4 alongside it. Nearly every option below is
 * there because a default was wrong for us, and the comment says which.
 */

export interface BuildAuthOptions {
  config: Config;
  prisma: PrismaClient;
  mailer: Mailer;
}

export type Auth = ReturnType<typeof buildAuth>;

/**
 * Refuse a sign-in the same way better-auth refuses a wrong password — the same status, the same
 * code, the same message, byte for byte.
 *
 * `sign-in.mjs` throws `APIError.from("UNAUTHORIZED", BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD)`
 * for an unknown address, a missing credential and a wrong password alike. Our two extra refusals
 * (§4.5) must be indistinguishable from those, or the API becomes an oracle: "this address exists
 * and is suspended" tells an attacker which addresses are real and which are worth pursuing.
 *
 * Constructed from the library's own constant rather than from a copied string, so a message the
 * library changes changes here too.
 */
function refuseIndistinguishably(): never {
  throw APIError.from('UNAUTHORIZED', BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD);
}

export function buildAuth({ config, prisma, mailer }: BuildAuthOptions) {
  return betterAuth({
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    basePath: '/api/auth',

    database: prismaAdapter(prisma, { provider: 'postgresql' }),

    /**
     * Explicit, even though 1.7.4 already defaults it off.
     *
     * `ADR-005`'s premise is that nothing about a user leaves the EU or the connection string. A
     * default is a thing that can change in a minor release and a reviewer cannot see; `false`
     * written here is a thing they can. AC14 asserts it.
     */
    telemetry: { enabled: false },

    advanced: {
      database: {
        /**
         * `ADR-005` rule 1. `app_user.id` is `uuid` with `DEFAULT gen_random_uuid()`, and every
         * foreign key in the schema is `UUID` — better-auth's default base62 string would be
         * rejected by the column type, and any that got through would be a user whose id does not
         * look like every other id in the system.
         */
        generateId: false,
      },
    },

    /**
     * ── A correction to `ADR-005` rule 1, found by running it ────────────────────────────────
     *
     * The rule says `modelName: "app_user"` maps better-auth's `user` model onto the existing
     * table. Through the **Prisma** adapter that is wrong, and it fails loudly: better-auth
     * validates its models against Prisma's schema and reports `Missing tables: app_user`.
     *
     * The adapter speaks Prisma, not SQL. It calls `prisma.user.create({ data: { userId … } })`,
     * so `modelName` and `fields` must name the *Prisma model and its fields* — and the mapping
     * onto `app_user`, `user_id` and the rest is already done, once, by `@@map`/`@map` in
     * `schema.prisma`. Telling better-auth about the column names as well makes it look for
     * Prisma fields called `user_id`, which do not exist.
     *
     * So the ADR's *intent* holds exactly — `app_user` is still the table, still for the reason
     * `W1-T05` gave — and the mechanism it named is one layer too low. Recorded in the run record
     * and in the spec rather than silently corrected, because the next person to read rule 1 will
     * otherwise try what it says.
     */
    user: {
      modelName: 'user',

      /**
       * Our columns, reaching better-auth under its own logical names.
       *
       * `roles`, `status` and `locale` are database enums with defaults, so they are `required:
       * false` — better-auth does not write them on sign-up and Postgres supplies `[CLIENT]`,
       * `ACTIVE` and `ES`. `input: false` on all four: these are *ours*. A field better-auth
       * accepts as input is a field a sign-up request can set, and a sign-up body carrying
       * `roles: ["ADMIN"]` must not be a privilege escalation. `W2-T03` decides who may change
       * them and through which route.
       */
      additionalFields: {
        roles: { type: 'string[]', required: false, input: false },
        status: { type: 'string', required: false, input: false },
        locale: { type: 'string', required: false, input: false },
        deletedAt: { type: 'date', required: false, input: false },
        /**
         * Declared so the adapter does not *strip* it.
         *
         * `additionalFields` is not only a type declaration — better-auth drops any key it does
         * not recognise before the write reaches Prisma. Without this line the hook below sets
         * `emailVerifiedAt` on every verification, silently loses it, and the audit fact stays
         * null while the boolean says true. Which is the exact drift the pair exists to avoid, and
         * it fails without an error.
         */
        emailVerifiedAt: { type: 'date', required: false, input: false },
      },
    },

    session: {
      modelName: 'session',
      /**
       * `ADR-005` rule 4. better-auth can cache session data in a signed cookie to save the
       * per-request lookup. Its own documentation says revoked sessions stay live on other devices
       * until that cache expires — which is the exact property rule 3 chose database sessions to
       * prevent. Revisit only with a measured query-load problem.
       */
      cookieCache: { enabled: false },
    },

    account: { modelName: 'account' },

    verification: { modelName: 'verification' },

    emailAndPassword: {
      enabled: true,

      /**
       * §4.6, and the operator's decision (2026-09-12).
       *
       * The cost is real — a step before a cold-start marketplace's scarce supply side reaches
       * value, which `R3` says is the expensive kind of friction. The benefit wins: an unverified
       * address is a provider who never receives a lead and a client a provider cannot reach, and
       * that failure is silent on both sides.
       */
      requireEmailVerification: true,

      sendResetPassword: async ({ user, url }) => {
        await mailer.sendPasswordReset({ to: user.email, url });
      },
    },

    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.sendVerification({ to: user.email, url });
      },
      /** The link a user clicks should leave them signed in, not at a login form. */
      autoSignInAfterVerification: true,
    },

    databaseHooks: {
      user: {
        create: {
          /**
           * Keep `email_verified_at` in step with `email_verified`.
           *
           * `ADR-005` calls the pair "the one place this decision costs us a redundant column":
           * better-auth's flag is a Boolean and ours is a timestamp, and `fields` renames columns
           * without converting types. A redundant column is only a cost while it agrees; the
           * moment it drifts it is a lie, so both writes happen together rather than one being
           * left to a later ticket.
           */
          before: async (user) => {
            /**
             * `W2-T10` §2.2 — trust the address, while nothing can check it.
             *
             * Off by default and warned about at boot. It rides on this hook rather than on
             * `requireEmailVerification: false`, and the difference is not stylistic: better-auth
             * builds its synthetic duplicate-sign-up response from that option —
             *
             *     shouldReturnGenericDuplicateResponse = requireEmailVerification || autoSignIn === false
             *
             * — so switching it off would delete the enumeration defence `W2-T01` §4.5 exists for,
             * silently, as a side effect of a convenience. Marking the user verified instead leaves
             * every other behaviour exactly where it was: the duplicate response, the uniform
             * `token: null`, the verification mail, the link, the reset flow.
             */
            const verified = config.AUTH_TRUST_EMAIL_ON_SIGNUP || user.emailVerified;

            return {
              data: {
                ...user,
                emailVerified: verified,
                // The pair, still written together: `ADR-005` calls the redundant column a cost only
                // while it agrees, and the moment it drifts it is a lie.
                ...(verified ? { emailVerifiedAt: new Date() } : {}),
              },
            };
          },
        },
        update: {
          before: async (user) => ({
            data: {
              ...user,
              ...(user.emailVerified === true ? { emailVerifiedAt: new Date() } : {}),
            },
          }),
        },
      },

      session: {
        create: {
          /**
           * §4.5 — the two refusals better-auth cannot make.
           *
           * On *session creation*, not on sign-in, and the library's own documentation points
           * here: "Non-provider returning sign-ins are not re-validated; use the admin plugin's
           * ban controls or a `databaseHooks.session.create.before` hook for those."
           *
           * It is also the single choke point every credential type passes through. Google
           * (`ADR-005` rule 6) will inherit this guard without a line changing; a guard bolted
           * onto the password path would have to be remembered and re-added.
           */
          before: async (session) => {
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: { deletedAt: true, status: true },
            });

            // No row at all. Should be unreachable — a session is being created *for* this user —
            // but refusing is the only safe answer to "I cannot tell", and failing closed on an
            // unreachable branch costs nothing.
            if (user === null) refuseIndistinguishably();

            // `W2-T08` owns erasure; this is what makes `deleted_at` mean something before it
            // exists. A soft-deleted user is, as far as authentication is concerned, not a user.
            if (user.deletedAt !== null) refuseIndistinguishably();

            // Operator decision, 2026-09-12: SUSPENDED cannot sign in. The kinder design — sign in
            // to a restricted shell that explains why and offers an appeal — is deferred to `W9`,
            // where there is something to let them in *to*. Revisit in `W2-T03`; no migration
            // either way. Spec §10 Q1.
            if (user.status !== 'ACTIVE') refuseIndistinguishably();

            return { data: session };
          },
        },
      },
    },
  });
}
