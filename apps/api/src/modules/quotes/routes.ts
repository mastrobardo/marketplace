/**
 * `W4-T03` — the quote routes.
 *
 * Two readers with two permissions, which is the only structural decision at this boundary: a
 * client reading the quotes on their job and a provider reading their own are different
 * capabilities, and collapsing them would turn *"can a provider see a competitor's price?"* into a
 * question about a `WHERE` clause instead of about a permission.
 *
 * Spec: `docs/specs/S4/W4-T03-quote-submission.md` §3.
 */
import { type FastifyInstance, type FastifyPluginAsync, type FastifyRequest } from 'fastify';
import { AppError, QuoteInputSchema, QuoteSchema, type Quote } from '@marketplace/contracts';

import { type ZodType } from 'zod';

import { principalOf, type Guards } from '../auth/guard.js';
import { type PERMISSIONS } from '../auth/permissions.js';
import { type QuoteRepository } from './repository.js';

export interface QuoteRoutesDeps {
  readonly repository: QuoteRepository;
  /** No guard, no routes — `W2-T03` §3.7. Fail-closed has to be structural. */
  readonly guards?: Guards<typeof PERMISSIONS>;
}

/** The cap on `GET /api/me/quotes`, matching `/me/jobs`. A cursor arrives with a screen. */
const LIST_LIMIT = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idOf(request: FastifyRequest, what: string): string {
  const { id } = request.params as { id?: string };
  // A malformed id is not a row that exists, and "invalid uuid" tells a prober the well-formed ones
  // are worth trying. Same answer either way — `W4-T01`'s rule.
  if (id === undefined || !UUID.test(id)) throw new AppError('NOT_FOUND', `no such ${what}`);
  return id;
}

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

function orNotFound<T>(value: T | null, what: string): T {
  if (value === null) throw new AppError('NOT_FOUND', `no such ${what}`);
  return value;
}

export function quoteRoutes(deps: QuoteRoutesDeps): FastifyPluginAsync {
  const { repository, guards } = deps;

  return async function register(app: FastifyInstance): Promise<void> {
    if (guards === undefined) return;

    app.post(
      '/jobs/:id/quotes',
      { preHandler: guards.requirePermission('quote:create') },
      async (request, reply) => {
        const input = parseBody(QuoteInputSchema, request.body, 'The quote is not valid.');
        const quote = await repository.create(
          principalOf(request).userId,
          idOf(request, 'job'),
          input,
        );
        return reply.code(201).send(QuoteSchema.parse(orNotFound(quote, 'job')));
      },
    );

    app.get(
      '/jobs/:id/quotes',
      { preHandler: guards.requirePermission('quote:read-for-own-job') },
      async (request) => {
        const quotes = await repository.listForJob(
          principalOf(request).userId,
          idOf(request, 'job'),
        );
        return {
          items: orNotFound(quotes, 'job').map((quote: Quote) => QuoteSchema.parse(quote)),
        };
      },
    );

    // `/me/quotes`, not `/quotes/me` — a collection the principal owns (`MEM-2026-09-20-12`).
    app.get(
      '/me/quotes',
      { preHandler: guards.requirePermission('quote:read-own') },
      async (request) => {
        const quotes = await repository.listOwn(principalOf(request).userId, LIST_LIMIT);
        return { items: quotes.map((quote) => QuoteSchema.parse(quote)) };
      },
    );

    app.post(
      '/quotes/:id/withdraw',
      { preHandler: guards.requirePermission('quote:withdraw-own') },
      async (request) => {
        const quote = await repository.withdraw(
          principalOf(request).userId,
          idOf(request, 'quote'),
        );
        return QuoteSchema.parse(orNotFound(quote, 'quote'));
      },
    );
  };
}
