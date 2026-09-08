import { randomUUID } from 'node:crypto';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import { type IncomingMessage } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * A client-supplied id is only trusted if it is short and boring.
 *
 * The value is written into structured logs and returned in a header, so an unbounded or
 * newline-carrying value is a log-injection and log-volume problem at the same time. Anything that
 * does not match is silently replaced rather than rejected — a bad correlation id is not worth
 * failing a request over.
 */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function generateRequestId(request: IncomingMessage): string {
  const supplied = request.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(supplied) ? supplied[0] : supplied;
  return candidate !== undefined && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
}

/**
 * Echo the id back on every response, including error responses, so a user can quote it.
 *
 * Added with `addHook` at the root rather than through `app.register`: `register` creates an
 * encapsulation context, and a hook added inside one does not apply to routes registered in a
 * sibling context. A correlation header that silently covers only some routes is worse than none.
 */
export async function requestIdHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  void reply.header(REQUEST_ID_HEADER, request.id);
}
