import { type Writable } from 'node:stream';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { type Config } from './config.js';
import {
  AppError,
  codeForStatus,
  errorEnvelope,
  INTERNAL_ERROR_MESSAGE,
  type ErrorCode,
} from './lib/errors.js';
import { generateRequestId, REQUEST_ID_HEADER, requestIdHook } from './plugins/request-id.js';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  config: Config;
  /** Tests pass a sink here so logging can be asserted rather than assumed. */
  logDestination?: Writable;
}

/**
 * Defence in depth. Fastify's default serialisers do not log headers, but a slice agent debugging
 * an auth problem will eventually log `request.headers`, and that must not put a bearer token in
 * the log sink.
 */
const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'res.headers["set-cookie"]',
];

/**
 * The composition root: everything the API is made of, assembled from an explicit `Config`.
 *
 * Kept separate from `server.ts` so tests can build an app and `inject()` into it without opening
 * a socket, and so nothing here depends on the process environment.
 */
export function buildApp({ config, logDestination }: BuildAppOptions): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
      base: { service: 'api', version: config.APP_VERSION },
      // Tests pass a sink; in production Fastify writes pino's default stdout stream.
      ...(logDestination === undefined ? {} : { stream: logDestination }),
    },
    genReqId: generateRequestId,
    // We validate the inbound header ourselves in `generateRequestId`; letting Fastify trust it
    // would echo whatever a client sent, unvalidated, into every log line.
    requestIdHeader: false,
  });

  app.addHook('onRequest', requestIdHook);
  app.register(healthRoutes(config));

  // One shape for "no such route" — never Fastify's default `{"message":"Route ... not found"}`.
  app.setNotFoundHandler((request, reply) => {
    const message = `Route ${request.method} ${request.url} not found`;
    request.log.info({ code: 'NOT_FOUND' }, message);
    void reply.status(404).send(errorEnvelope('NOT_FOUND', message, request.id));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      // Intended by the route: the message and details are safe, and this is not a defect.
      request.log.info({ err: error, code: error.code }, error.message);
      void reply
        .status(error.statusCode)
        .send(errorEnvelope(error.code, error.message, request.id, error.details));
      return;
    }

    // Framework errors — a malformed body, an unsupported media type — carry a 4xx status. The
    // client caused them, so its own message is safe to return.
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      const code: ErrorCode =
        codeForStatus(status) === 'INTERNAL_ERROR' ? 'VALIDATION_FAILED' : codeForStatus(status);
      request.log.info({ err: error, code }, error.message);
      void reply.status(status).send(errorEnvelope(code, error.message, request.id));
      return;
    }

    // Anything else is a bug. The detail is moved to the logs, never put on the wire: a stack
    // trace, a SQL fragment or a connection string in a response body is a security incident.
    request.log.error({ err: error }, error.message);
    void reply
      .status(500)
      .send(errorEnvelope('INTERNAL_ERROR', INTERNAL_ERROR_MESSAGE, request.id));
  });

  return app;
}

export { REQUEST_ID_HEADER };
