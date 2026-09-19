/**
 * `W3-T07` — `GET /api/providers/:id`.
 *
 * The HTTP boundary: parse the id, ask the repository, and parse the answer on the way out.
 * Everything it knows about data it learned from `repository.ts`.
 *
 * Spec: `docs/specs/S3/W3-T07-provider-profile-api.md`.
 */
import { type FastifyInstance, type FastifyPluginAsync, type FastifyRequest } from 'fastify';
import {
  AppError,
  ProviderIdSchema,
  ProviderProfileOwnSchema,
  ProviderProfileSchema,
  ProviderProfileWriteSchema,
  type ProviderProfile,
  type ProviderProfileOwn,
} from '@marketplace/contracts';
import { principalOf, type Guards } from '../auth/guard.js';
import { type PERMISSIONS } from '../auth/permissions.js';
import { type ProviderRepository } from './repository.js';
import { type ProviderOwnRepository, type ProviderWriter } from './write-repository.js';

export interface ProviderRoutesDeps {
  readonly repository: ProviderRepository;
  /**
   * The three the **private** routes need, and they arrive together or not at all.
   *
   * `W2-T03` §3.7: a route that needs a guard is registered only when the guard exists, so a build
   * without `auth` answers `404` on `/providers/me` rather than serving it to anybody. Fail-closed
   * has to be structural here — a guard that silently degrades to "no guard" is the outage that
   * looks like a successful deploy.
   */
  readonly guards?: Guards<typeof PERMISSIONS>;
  readonly own?: ProviderOwnRepository;
  readonly writer?: ProviderWriter;
}

/**
 * `nameEs` or `nameEn`, decided here so the client never sees the pair — the same rule
 * `modules/search/routes.ts` follows. Spanish is the default because the market is Spain.
 *
 * **Exported since `W3-T01`**, which needed it for a third endpoint. Copying eight lines a third
 * time is a review failure, and spec §3.7 names this one as the source. A neutral home would read
 * better, but that edit lands in `modules/search/`, which belongs to another slice — so the import
 * points here until someone owns both files in one ticket.
 */
export function localeOf(request: FastifyRequest): 'es' | 'en' {
  const header = request.headers['accept-language'];
  return typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'es';
}

/**
 * `/providers/:id`, under `/api` — `MEM-2026-09-14-3`. The prefix is applied at the composition
 * root rather than spelled into the path here, so every route this module ever adds inherits it.
 */
export function providerRoutes({
  repository,
  guards,
  own,
  writer,
}: ProviderRoutesDeps): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
    if (guards !== undefined && own !== undefined && writer !== undefined) {
      /**
       * `/me`, not `/:id`. The row is resolved **from the principal**, so there is no id to compare
       * and no way to address somebody else's profile at all — `W2-T03` §3.6's rule, and this is
       * its first consumer. A static segment wins over a parameter in find-my-way, so `/me` never
       * reaches the public route below; `tests/provider-write.test.ts` pins that rather than
       * trusting it.
       */
      app.get(
        '/providers/me',
        { preHandler: guards.requireSession },
        async (request): Promise<ProviderProfileOwn> => {
          const profile = await own({
            userId: principalOf(request).userId,
            locale: localeOf(request),
          });

          // Not an error: a signed-in user who has never saved a profile has none, and `PUT`
          // resolves it. A client without the PROVIDER role reaches exactly this answer too — it
          // costs one indexed lookup and tells them nothing they could not have guessed.
          if (profile === undefined) {
            throw new AppError('NOT_FOUND', 'You have no provider profile yet.');
          }

          return ProviderProfileOwnSchema.parse(profile);
        },
      );

      app.put(
        '/providers/me',
        { preHandler: guards.requirePermission('provider-profile:update-own') },
        async (request): Promise<ProviderProfile> => {
          const parsed = ProviderProfileWriteSchema.safeParse(request.body);

          if (!parsed.success) {
            throw new AppError('VALIDATION_FAILED', 'The profile is not valid.', {
              issues: parsed.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                message: issue.message,
              })),
            });
          }

          const result = await writer({
            userId: principalOf(request).userId,
            locale: localeOf(request),
            write: parsed.data,
          });

          // A slug nobody has is the provider's mistake, not a 500 — and it is named, because a
          // category silently dropped from a save is a provider who never appears in that search
          // and has no way to find out why.
          if (!result.ok) {
            throw new AppError('VALIDATION_FAILED', 'The profile is not valid.', {
              issues: result.unknownSlugs.map((slug) => ({
                path: 'categories',
                message: `"${slug}" is not a category we list.`,
              })),
            });
          }

          // The **public** projection: what you saved is what a visitor will see, parsed through
          // the same schema the public endpoint answers with.
          return ProviderProfileSchema.parse(result.profile);
        },
      );
    }

    app.get<{ Params: { id: string } }>(
      '/providers/:id',
      async (request): Promise<ProviderProfile> => {
        // Parsed before anything is looked up, so a malformed id costs no query — and, more to the
        // point, so it is never answered with a 404. One is a request nobody should have sent; the
        // other is a provider who is gone, and only the second deserves "no longer listed" in
        // front of a visitor (§2.3).
        const id = ProviderIdSchema.safeParse(request.params.id);

        if (!id.success) {
          throw new AppError('VALIDATION_FAILED', 'The provider id is not a uuid.', {
            issues: id.error.issues.map((issue) => ({ path: 'id', message: issue.message })),
          });
        }

        const profile = await repository({ id: id.data, locale: localeOf(request) });

        // `undefined` is both "no such row" and "a row with no base address" — §2.4. The second is
        // a provider the product should not be able to create, and `W3-T02` is what stops it;
        // until then they are unlisted everywhere else too, so they are unlisted here.
        if (profile === undefined) {
          throw new AppError('NOT_FOUND', 'No such provider.');
        }

        // Parsed, not merely typed. Types are erased at runtime; this is what makes the strict
        // projection and the coarse-point refinement a gate rather than a convention
        // (`MEM-2026-09-17-11`).
        return ProviderProfileSchema.parse(profile);
      },
    );
  };
}
