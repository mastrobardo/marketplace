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
  ProviderProfileSchema,
  type ProviderProfile,
} from '@marketplace/contracts';
import { type ProviderRepository } from './repository.js';

export interface ProviderRoutesDeps {
  readonly repository: ProviderRepository;
}

/**
 * `nameEs` or `nameEn`, decided here so the client never sees the pair — the same rule
 * `modules/search/routes.ts` follows. Spanish is the default because the market is Spain.
 */
function localeOf(request: FastifyRequest): 'es' | 'en' {
  const header = request.headers['accept-language'];
  return typeof header === 'string' && header.toLowerCase().startsWith('en') ? 'en' : 'es';
}

/**
 * `/providers/:id`, under `/api` — `MEM-2026-09-14-3`. The prefix is applied at the composition
 * root rather than spelled into the path here, so every route this module ever adds inherits it.
 */
export function providerRoutes({ repository }: ProviderRoutesDeps): FastifyPluginAsync {
  return async (app: FastifyInstance) => {
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
