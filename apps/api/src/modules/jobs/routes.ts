/**
 * `W4-T01` — the job posting routes.
 *
 * The HTTP boundary: parse the body, ask the repository, parse the answer on the way out. The one
 * rule worth stating here is the refusal shape — a job belonging to somebody else is **`404`, not
 * `403`**, because the existence of a stranger's draft is not information this API gives away.
 *
 * Spec: `docs/specs/S4/W4-T01-job-posting.md` §3.
 */
import { type FastifyInstance, type FastifyPluginAsync, type FastifyRequest } from 'fastify';
import {
  AppError,
  JobDraftInputSchema,
  JobSchema,
  JobUpdateInputSchema,
  type Job,
} from '@marketplace/contracts';

import { type ZodType } from 'zod';

import { principalOf, type Guards } from '../auth/guard.js';
import { type PERMISSIONS } from '../auth/permissions.js';
import { type JobRepository } from './repository.js';

export interface JobRoutesDeps {
  readonly repository: JobRepository;
  /**
   * Every route here is guarded, so without this the plugin registers **nothing**.
   *
   * `W2-T03` §3.7: a route that needs a guard exists only when the guard does. A build with no
   * `auth` answers `404` on `/api/jobs` rather than serving somebody else's drafts — fail-closed
   * has to be structural, because a guard that degrades to "no guard" is the outage that looks
   * like a successful deploy.
   */
  readonly guards?: Guards<typeof PERMISSIONS>;
}

/** The cap on `GET /api/jobs/me`. Deliberately small; `W4-T02` can paginate properly when asked. */
const LIST_LIMIT = 50;

function jobIdOf(request: FastifyRequest): string {
  const { id } = request.params as { id?: string };
  if (
    id === undefined ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  ) {
    // A malformed id is not a job that exists, and saying "invalid uuid" tells a prober that the
    // well-formed ones are worth trying. Same answer either way.
    throw new AppError('NOT_FOUND', 'no such job');
  }
  return id;
}

/**
 * Parse a body, or refuse it as `VALIDATION_FAILED` with the issues named.
 *
 * `safeParse` and an explicit `AppError`, which is the convention `modules/providers/routes.ts`
 * established — a bare `.parse()` throws a `ZodError` that nothing maps, and the caller gets a 500
 * for a typo in their own request.
 */
function parseBody<T>(schema: ZodType<T>, body: unknown, what: string): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', what, {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

/** `null` from the repository means *not yours or not there* — the caller cannot tell which. */
function orNotFound(job: Job | null): Job {
  if (job === null) throw new AppError('NOT_FOUND', 'no such job');
  return job;
}

export function jobRoutes(deps: JobRoutesDeps): FastifyPluginAsync {
  const { repository, guards } = deps;

  return async function register(app: FastifyInstance): Promise<void> {
    if (guards === undefined) return;

    app.post(
      '/jobs',
      { preHandler: guards.requirePermission('job:create') },
      async (request, reply) => {
        const input = parseBody(JobDraftInputSchema, request.body, 'The job is not valid.');
        const job = await repository.createDraft(principalOf(request).userId, input);
        return reply.code(201).send(JobSchema.parse(job));
      },
    );

    // Registered **before** `/jobs/:id`, so `me` is never read as an id. `W3-T02` found this the
    // hard way: a shared path space answers `/me` as a malformed uuid if the order is wrong.
    app.get(
      '/jobs/me',
      { preHandler: guards.requirePermission('job:read-own') },
      async (request) => {
        const jobs = await repository.listOwn(principalOf(request).userId, LIST_LIMIT);
        return { items: jobs.map((job) => JobSchema.parse(job)) };
      },
    );

    app.get(
      '/jobs/:id',
      { preHandler: guards.requirePermission('job:read-own') },
      async (request) => {
        const job = await repository.findOwn(principalOf(request).userId, jobIdOf(request));
        return JobSchema.parse(orNotFound(job));
      },
    );

    app.put(
      '/jobs/:id',
      { preHandler: guards.requirePermission('job:update-own') },
      async (request) => {
        const input = parseBody(JobUpdateInputSchema, request.body, 'The job update is not valid.');
        const job = await repository.update(principalOf(request).userId, jobIdOf(request), input);
        return JobSchema.parse(orNotFound(job));
      },
    );

    app.post(
      '/jobs/:id/publish',
      { preHandler: guards.requirePermission('job:publish-own') },
      async (request) => {
        const job = await repository.publish(principalOf(request).userId, jobIdOf(request));
        return JobSchema.parse(orNotFound(job));
      },
    );
  };
}
