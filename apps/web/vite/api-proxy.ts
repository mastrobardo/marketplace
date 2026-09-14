/**
 * `W0-T28` — one origin.
 *
 * A deployed browser loads the storefront from `*.pages.dev` and, without this file, calls the API
 * on `*.fly.dev`. Those are different **registrable** domains, so two things fail in order: the
 * request is cross-origin and better-auth sends no `Access-Control-Allow-Origin` for a host it does
 * not trust, and then — even with the header — the `SameSite=Lax` session cookie is never sent.
 * `ADR-005` rule 3 chose one origin over credentialed CORS for exactly that reason.
 *
 * So `/api/*` is served *from the web origin* and forwarded at the edge. Cloudflare Pages calls this
 * "advanced mode": a `_worker.js` at the root of the deployed directory takes over every request,
 * and the static site becomes a binding (`env.ASSETS`) that the worker may defer to.
 *
 * **The origin is baked in at build time.** `wrangler pages deploy` cannot set a variable for the
 * deployment it is creating, and a project-level variable is one value shared by every preview
 * while each preview has its own API. The build already knows which API it is for.
 */
import { type Plugin } from 'vite';

/** Where Pages looks. The name is not configurable; it is the file that switches advanced mode on. */
const WORKER_FILE = '_worker.js';

/**
 * The worker, as the text that ships.
 *
 * Returned as a string rather than bundled from a module because it must be self-contained — Pages
 * loads this file directly and it may import nothing. `tests/api-proxy.test.ts` loads *this string*
 * as a module and exercises it, so the thing under test is the artifact rather than a copy of its
 * logic.
 *
 * `JSON.stringify` on the origin, not template interpolation: this value becomes code, and a quote
 * in it would become a syntax error at the edge rather than a build failure here.
 */
export function workerSource(apiOrigin: string): string {
  return `const API_ORIGIN = ${JSON.stringify(apiOrigin)};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // \`/api\` itself and everything below it. Not \`startsWith('/api')\`, which would also catch
    // \`/apiary\` — and a path that merely begins with those four letters is a page, not an endpoint.
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const target = new URL(url.pathname + url.search, API_ORIGIN);
      // \`new Request(url, request)\` carries the method, the headers and the body across unchanged.
      // Three of those headers are the whole point: \`Origin\` is what better-auth's origin check
      // reads, \`Cookie\` is the session, and \`Content-Type\` decides whether the API parses a body
      // at all. The response is returned as it arrives, \`Set-Cookie\` included — and because the
      // browser is on this origin, that cookie is a first-party cookie.
      return fetch(new Request(target, request));
    }

    return env.ASSETS.fetch(request);
  },
};
`;
}

/**
 * Emit the worker into the build output — and only when there is somewhere to send.
 *
 * With no origin the site is either already same-origin (a local `vite preview`) or has no API at
 * all, and a worker pointing at nothing would turn every `/api/*` request into a 5xx from the edge
 * instead of an honest 404. Absence is the safe default and it is asserted.
 */
export function apiProxyPlugin(apiOrigin: string | undefined): Plugin {
  const origin = apiOrigin?.trim() ?? '';

  // Checked here, where it fails the build, rather than at the edge where it would be an infinite
  // loop: a relative value resolves against the worker's own URL, so the worker would forward every
  // request to itself, billed per request.
  if (origin !== '' && !/^https?:\/\/[^/]+$/.test(origin)) {
    throw new Error(
      `VITE_API_ORIGIN must be an absolute http(s) origin with no path — received "${origin}"`,
    );
  }

  return {
    name: 'mp-api-proxy',
    apply: 'build',
    generateBundle() {
      if (origin === '') return;
      this.emitFile({ type: 'asset', fileName: WORKER_FILE, source: workerSource(origin) });
    },
  };
}
