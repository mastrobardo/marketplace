import { type Writable } from 'node:stream';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { type Config } from './config.js';
import {
  AppError,
  codeForStatus,
  errorEnvelope,
  INTERNAL_ERROR_MESSAGE,
} from '@marketplace/contracts';
import { type Auth } from './auth/auth.js';
import { registerAuth } from './plugins/auth.js';
import { generateRequestId, REQUEST_ID_HEADER, requestIdHook } from './plugins/request-id.js';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  config: Config;
  /** Tests pass a sink here so logging can be asserted rather than assumed. */
  logDestination?: Writable;
  /**
   * better-auth, already built (`W2-T01`).
   *
   * Optional so that every existing test — and `/health` itself — can build an app without a
   * database. Passed in rather than constructed here for the reason this file exists at all:
   * nothing in the composition root may reach for ambient state.
   */
  auth?: Auth;
}

/**
 * Defence in depth. Fastify's default serialisers do not log headers, but a slice agent debugging
 * an auth problem will eventually log `request.headers`, and that must not put a bearer token in
 * the log sink.
 */
/** Loopback in the forms a config file realistically carries. */
function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127\./.test(host);
}

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
export function buildApp({ config, logDestination, auth }: BuildAppOptions): FastifyInstance {
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

  /**
   * `/api/auth/*` answers in better-auth's error shape, not `W1-T01`'s envelope — a documented
   * carve-out, argued in `W2-T01` §4.4 rather than discovered later.
   *
   * The alternative was translating: better-auth's failures into our codes. The envelope types
   * `details` *per code*, so a translation layer must either invent a code per library failure —
   * a registry that drifts on every upgrade, in the slice where an upgrade is most sensitive — or
   * collapse them all into one and throw away the difference between "wrong password" and
   * "account locked", which is precisely what `W2-T07`'s lockout work will need.
   *
   * `ci-workflow`-style assertions are not enough here, so `auth.test.ts` pins that this prefix is
   * the *only* carve-out: every other route, including 404 and 500, still answers in the envelope.
   */
  if (auth !== undefined) registerAuth(app, auth);

  /**
   * `W2-T01` §4.9. `MAIL_SMTP_HOST` defaults to `127.0.0.1`, which is Mailpit locally and nothing
   * at all in a deployed environment — and the failure is invisible: better-auth does not fail a
   * sign-up when `sendVerificationEmail` throws, so the account is created, cannot verify, cannot
   * re-register and cannot ask for another link. Demonstrated on the preview deploy, not guessed.
   *
   * A warning rather than a refusal, because `OPS-14` is unstarted: refusing to boot would mean no
   * deployed API at all, and nothing else in this service touches mail. It stops being emitted the
   * day a real sender is configured.
   */
  if (config.NODE_ENV !== 'development' && isLoopback(config.MAIL_SMTP_HOST)) {
    app.log.warn(
      { host: config.MAIL_SMTP_HOST, port: config.MAIL_SMTP_PORT, nodeEnv: config.NODE_ENV },
      'MAIL_SMTP_HOST points at this machine, so no verification or reset email can be delivered; ' +
        'sign-up will still return 200 and strand the account (OPS-14)',
    );
  }

  // One shape for "no such route" — never Fastify's default `{"message":"Route ... not found"}`.
  app.setNotFoundHandler((request, reply) => {
    const message = `Route ${request.method} ${request.url} not found`;
    request.log.info({ code: 'NOT_FOUND' }, message);
    void reply.status(404).send(errorEnvelope('NOT_FOUND', message, request.id));
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      // Intended by the route: the message and details are safe, and this is not a defect.
      // `toEnvelope` rather than `errorEnvelope` — the code/details pairing was type-checked at the
      // throw site, and here `code` is only known at runtime (W1-T01 §4.5).
      request.log.info({ err: error, code: error.code }, error.message);
      void reply.status(error.statusCode).send(error.toEnvelope(request.id));
      return;
    }

    // Framework errors — a malformed body, an unsupported media type — carry a 4xx status. The
    // client caused them, so its own message is safe to return.
    const status = error.statusCode ?? 500;
    if (status >= 400 && status < 500) {
      const { code, matched } = codeForStatus(status);
      if (matched) {
        request.log.info({ err: error, code }, error.message);
      } else {
        // The registry has no code for this status, so `code` is a fallback, not a mapping. Warn
        // and name the status: W0-T03 made the same substitution silently, and its run record
        // called it "a guess dressed as a mapping". A gap should be visible to us, not reported to
        // a client as a validation failure it was not.
        request.log.warn(
          { err: error, code, status },
          `No error code is registered for HTTP ${status}; falling back to ${code}`,
        );
      }
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
