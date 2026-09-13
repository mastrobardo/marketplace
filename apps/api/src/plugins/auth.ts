import { type FastifyInstance, type FastifyPluginCallback } from 'fastify';
import { toNodeHandler } from 'better-auth/node';

import { type Auth } from '../auth/auth.js';

/** Everything better-auth serves lives under this prefix, and nothing else does. */
export const AUTH_PREFIX = '/api/auth';

/**
 * Mount better-auth on Fastify — `W2-T01` §4.3.
 *
 * **Not the bridge in better-auth's Fastify guide.** That snippet forwards the response headers
 * with `response.headers.forEach((value, key) => reply.header(key, value))`, and the `Headers` API
 * folds repeated headers into one comma-joined value. `Set-Cookie` is the one header where that is
 * not a legal transformation: a response that sets a session cookie *and* clears a stale one
 * arrives at the browser as a single malformed cookie.
 *
 * The library already ships a correct bridge that its Fastify page does not use — `toNodeHandler`
 * delegates to `better-call/node`, whose `setResponse` splits the folded value back apart with
 * `set-cookie-parser`. So the bug is in the guide, not in the library, and the fix is to use the
 * library's own Node integration rather than to write a better `forEach`.
 *
 * Using it against a Node handler inside Fastify costs two things, both below.
 */
const authPlugin: FastifyPluginCallback<{ auth: Auth }> = (fastify, options, done) => {
  /**
   * **Cost one: the body has to survive Fastify on its way to better-auth.**
   *
   * `getRequest` prefers to read `request.raw` as a stream, and falls back to `request.raw.body`
   * when the stream is spent. Inside Fastify the stream is always spent by the time a handler
   * runs, and Fastify's parsed body lives on the *Fastify* request, not on `raw` — so better-auth
   * finds neither and rejects a perfectly good sign-in as `VALIDATION_ERROR: expected object,
   * received undefined`. A confusing symptom: the credentials look wrong when the body is simply
   * absent.
   *
   * So the body is buffered here as a **string** and handed over untouched. Not
   * `JSON.stringify(request.body)`, which is what better-auth's own Fastify guide does: that
   * re-serialises whatever Fastify's parser produced, and round-tripping a payload through
   * `parse`/`stringify` is not an identity — key order, number formatting and any duplicate key
   * all change. Nothing today signs this body, but "the bytes we forward are the bytes we
   * received" is a property worth keeping by construction rather than by luck.
   *
   * Content-type parsers are encapsulated per plugin scope in Fastify, so this applies to the auth
   * routes and to nothing else. Every other route keeps its JSON parsing and the `400` that a
   * malformed body produces.
   */
  fastify.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, onDone) => {
    onDone(null, body);
  });

  fastify.route({
    method: ['GET', 'POST'],
    url: `${AUTH_PREFIX}/*`,
    handler: async (request, reply) => {
      /**
       * **Cost two: Fastify must not also try to reply.**
       *
       * `toNodeHandler` writes status, headers and body straight to the Node response. Without
       * `hijack()` Fastify believes it still owns the reply and serialises a second one onto the
       * same socket.
       *
       * The trade is that a hijacked reply skips Fastify's `onSend` hooks and its error handler —
       * which is the same boundary §4.4 draws for error *shape*, so the two costs land in exactly
       * the same place rather than in two places a reader has to reconcile.
       */
      reply.hijack();

      // Where `getRequest` looks when the stream is spent. `request.body` is the raw string the
      // parser above buffered, so this is a hand-off, not a re-encode.
      (request.raw as { body?: unknown }).body = request.body;

      try {
        await toNodeHandler(options.auth)(request.raw, reply.raw);
      } catch (error) {
        // Past `hijack()` the error handler in `app.ts` will never see this, so it is logged here
        // or it is lost. The response body is a bare 500 with no detail: a stack trace or a SQL
        // fragment on the auth endpoint is a security incident, and this is the one route whose
        // failures cannot pass through the handler that already knows that.
        request.log.error({ err: error }, 'better-auth handler threw');
        if (!reply.raw.headersSent) reply.raw.writeHead(500);
        reply.raw.end();
      }
    },
  });

  done();
};

/**
 * Registered without `fastify-plugin`, deliberately: the encapsulation is the feature. Wrapping it
 * would leak the pass-through content-type parser onto every route in the application, and the
 * first casualty would be the `400` that a malformed JSON body currently produces everywhere else.
 */
export function registerAuth(app: FastifyInstance, auth: Auth): void {
  app.register(authPlugin, { auth });
}
