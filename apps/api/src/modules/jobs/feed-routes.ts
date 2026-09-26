/**
 * `W4-T07` — `GET /api/me/job-feed`.
 *
 * The HTTP boundary: parse the query, ask the repository, parse the answer on the way out. It is a
 * plugin of its own rather than a route on `jobRoutes` because the two are guarded by different
 * capacities of the same person — `job:read-own` is a client reading their postings, `job:read-feed`
 * is a professional reading the market — and because a new dependency on `JobRepository` would have
 * made every existing stub of that interface a compile error for no gain.
 *
 * Spec: `docs/specs/S4/W4-T07-provider-job-feed.md` §2.9, §3.1.
 */
import { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import { AppError, JobFeedPageSchema, JobFeedQuerySchema } from '@marketplace/contracts';

import { principalOf, type Guards } from '../auth/guard.js';
import { type PERMISSIONS } from '../auth/permissions.js';
import { type JobFeedRepository } from './feed-repository.js';

export interface JobFeedRoutesDeps {
  readonly repository: JobFeedRepository;
  /**
   * No guard, no route — `W2-T03` §3.7. This one matters more than most: without it the market, and
   * with it every open job's postal code, would be readable by anybody who asks. Fail-closed has to
   * be structural, because a guard that degrades to "no guard" is the outage that looks like a
   * successful deploy.
   */
  readonly guards?: Guards<typeof PERMISSIONS>;
}

export function jobFeedRoutes(deps: JobFeedRoutesDeps): FastifyPluginAsync {
  const { repository, guards } = deps;

  return async function register(app: FastifyInstance): Promise<void> {
    if (guards === undefined) return;

    /**
     * `/me/job-feed`, not `/jobs/feed` — `MEM-2026-09-20-12`'s rule and `W4-T02` §2.4's reason. It is
     * a collection scoped to the principal, and `/jobs/feed` would share a path space with
     * `/jobs/:id` and work only while registered first. This shares one with nothing.
     *
     * **"Own" is structural here in a way it is not on `/jobs/:id`.** There is no id to scope: the
     * radius, the base address and the trades all come from the caller's own profile, so a request
     * cannot name somebody else's feed even by accident.
     */
    app.get(
      '/me/job-feed',
      { preHandler: guards.requirePermission('job:read-feed') },
      async (request) => {
        const parsed = JobFeedQuerySchema.safeParse(request.query ?? {});
        if (!parsed.success) {
          throw new AppError('VALIDATION_FAILED', 'The job feed request is not valid.', {
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          });
        }

        const page = await repository.read(principalOf(request).userId, parsed.data);

        // Parsed, not merely typed. Types are erased at runtime; this is what makes the disclosure
        // rule (§2.3) a gate rather than a convention — a widened `SELECT` fails here instead of
        // putting somebody's street on the wire.
        return JobFeedPageSchema.parse(page);
      },
    );
  };
}
