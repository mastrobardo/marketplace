// @vitest-environment node
//
// `W0-T28` — the worker that makes a deployed browser see one origin.
//
// **The module under test is the artifact, not a copy of it.** `workerSource()` produces the exact
// text that ships as `_worker.js`, and every assertion below loads *that string* as a module and
// calls it. A test that matched the source with a regular expression would pass for a worker that
// does not run, which on Cloudflare is a silent failure: `/api/*` falls through to the SPA's
// `index.html` and the first symptom is a JSON parse error in somebody's browser.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { apiProxyPlugin, workerSource } from '../vite/api-proxy.js';

const ORIGIN = 'https://marketplace-api-pr-247.fly.dev';

interface WorkerModule {
  default: {
    fetch(
      request: Request,
      env: { ASSETS: { fetch(request: Request): Promise<Response> } },
    ): Promise<Response>;
  };
}

/** Load the emitted source the way Cloudflare would: as an ES module. */
async function loadWorker(origin = ORIGIN): Promise<WorkerModule> {
  const source = workerSource(origin);
  return (await import(
    `data:text/javascript,${encodeURIComponent(source)}`
  )) as unknown as WorkerModule;
}

/** Pages' static-assets binding, as the worker sees it: one method, and a record of the calls. */
type AssetsBinding = { fetch: ReturnType<typeof vi.fn> } & {
  fetch(request: Request): Promise<Response>;
};

function assets(): AssetsBinding {
  return {
    fetch: vi.fn().mockResolvedValue(new Response('<!doctype html>')),
  } as unknown as AssetsBinding;
}

describe('AC3/AC6 — a request to /api reaches the API, and the answer comes back whole', () => {
  it('forwards method, headers and body to the configured origin', async () => {
    const worker = await loadWorker();
    const upstream = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"status":true}', { status: 200 }));

    const response = await worker.default.fetch(
      new Request('https://pr-247.marketplace-web-ane.pages.dev/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://pr-247.marketplace-web-ane.pages.dev',
          cookie: 'better-auth.session_token=opaque',
        },
        body: '{"email":"ana@example.com","password":"x"}',
      }),
      { ASSETS: assets() },
    );

    expect(response.status).toBe(200);
    const forwarded = upstream.mock.calls[0]?.[0] as Request;
    expect(forwarded.url).toBe(`${ORIGIN}/api/auth/sign-in/email`);
    expect(forwarded.method).toBe('POST');
    // The three headers the seam actually depends on. `Origin` is what better-auth's origin check
    // reads, `Cookie` is the session, and without the content type the API answers 415.
    expect(forwarded.headers.get('origin')).toBe('https://pr-247.marketplace-web-ane.pages.dev');
    expect(forwarded.headers.get('cookie')).toBe('better-auth.session_token=opaque');
    expect(forwarded.headers.get('content-type')).toBe('application/json');
    expect(await forwarded.text()).toBe('{"email":"ana@example.com","password":"x"}');

    upstream.mockRestore();
  });

  it('keeps the query string', async () => {
    const worker = await loadWorker();
    const upstream = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 302 }));

    await worker.default.fetch(
      new Request(
        'https://pr-247.pages.dev/api/auth/verify-email?token=abc&callbackURL=%2Fes%2Fverify-email',
      ),
      { ASSETS: assets() },
    );

    const forwarded = upstream.mock.calls[0]?.[0] as Request;
    expect(forwarded.url).toBe(
      `${ORIGIN}/api/auth/verify-email?token=abc&callbackURL=%2Fes%2Fverify-email`,
    );
    upstream.mockRestore();
  });

  it('AC6 — a Set-Cookie survives the round trip unmodified', async () => {
    // The whole point of the ticket. The cookie better-auth sets carries no `Domain`, so it becomes
    // a host cookie for the Pages hostname — which is the origin the browser is already on, which
    // is what makes `SameSite=Lax` work instead of needing to be relaxed.
    const cookie = 'better-auth.session_token=opaque; Path=/; HttpOnly; Secure; SameSite=Lax';
    const worker = await loadWorker();
    const upstream = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { headers: { 'set-cookie': cookie } }));

    const response = await worker.default.fetch(
      new Request('https://pr-247.pages.dev/api/auth/sign-in/email', { method: 'POST' }),
      { ASSETS: assets() },
    );

    expect(response.headers.get('set-cookie')).toBe(cookie);
    upstream.mockRestore();
  });
});

describe('AC4/AC5 — what is and is not the API', () => {
  it.each([
    ['/api', true],
    ['/api/health', true],
    ['/api/auth/get-session', true],
    ['/apiary', false],
    ['/es/api', false],
    ['/', false],
    ['/es/signup', false],
    ['/assets/index-abc123.js', false],
  ])('%s → forwarded: %s', async (path, forwarded) => {
    const worker = await loadWorker();
    const binding = assets();
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));

    await worker.default.fetch(new Request(`https://pr-247.pages.dev${path}`), { ASSETS: binding });

    expect(upstream.mock.calls.length, `${path} upstream`).toBe(forwarded ? 1 : 0);
    expect(binding.fetch.mock.calls.length, `${path} assets`).toBe(forwarded ? 0 : 1);
    upstream.mockRestore();
  });

  it('AC5 — hands the assets binding the request it was given, untouched', async () => {
    const worker = await loadWorker();
    const binding = assets();
    const request = new Request('https://pr-247.pages.dev/es/signup');

    await worker.default.fetch(request, { ASSETS: binding });

    expect(binding.fetch.mock.calls[0]?.[0]).toBe(request);
  });
});

describe('AC1/AC2 — the plugin emits it only when there is somewhere to send', () => {
  /** What Rollup would call. The plugin is a `generateBundle` hook and an `apply: build` flag. */
  function emitFrom(origin: string | undefined): { fileName: string; source: string }[] {
    const emitted: { fileName: string; source: string }[] = [];
    const plugin = apiProxyPlugin(origin) as unknown as {
      generateBundle?: (this: {
        emitFile: (file: { fileName: string; source: string }) => void;
      }) => void;
    };
    plugin.generateBundle?.call({
      emitFile: (file) => emitted.push(file),
    });
    return emitted;
  }

  it('AC1 — emits _worker.js at the root of the output, naming the origin', () => {
    const emitted = emitFrom(ORIGIN);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.fileName).toBe('_worker.js');
    expect(emitted[0]?.source).toContain(ORIGIN);
  });

  it('AC2 — emits nothing when no origin is configured', () => {
    // A worker pointing at nothing is worse than no worker: every `/api/*` call becomes a 5xx from
    // the edge instead of an honest 404, and the site that needs no proxy is the common case
    // (a local `vite preview`, and production until `OPS-16`).
    expect(emitFrom(undefined)).toEqual([]);
    expect(emitFrom('')).toEqual([]);
  });

  it('refuses an origin that is not an absolute http(s) URL', () => {
    // Baked into a string that becomes code. A relative value would produce a worker that forwards
    // to itself — an infinite loop at the edge, billed per request.
    expect(() => apiProxyPlugin('/api')).toThrow(/absolute/i);
    expect(() => apiProxyPlugin('marketplace-api.fly.dev')).toThrow(/absolute/i);
  });
});

describe('AC7 — the client and the edge agree on what "the API" means', () => {
  it('requests only `api/`-prefixed paths, and defaults to the same origin', () => {
    // Derived from the source, not a list kept by hand: the failure mode is a *new* call added
    // without the prefix, which the edge would answer with the SPA's `index.html` — a 200 full of
    // HTML that fails as a JSON parse error a long way from its cause.
    const source = readFileSync(new URL('../src/shared/api.ts', import.meta.url), 'utf8');
    const requested = [...source.matchAll(/http\.(?:get|post)<unknown>\(\s*[`'"]([^`'"]+)/g)].map(
      (match) => match[1] ?? '',
    );

    // Three on `main` today (categories, search, provider) and ten once `W2-T09`'s auth calls land.
    // The number is not the assertion — the derivation is — but zero would make the loop below
    // vacuous, which is how a gate like this fails silently.
    expect(
      requested.length,
      'no calls found — the matcher has stopped matching',
    ).toBeGreaterThanOrEqual(3);
    for (const path of requested) {
      expect(path, `"${path}" would be answered by the SPA, not the API`).toMatch(/^api\//);
    }

    // And the base stays same-origin, which is the half of `W0-T28` the application already had.
    expect(source).toMatch(
      /return typeof configured === 'string' && configured !== ''\s*\?\s*configured\s*:\s*'\/';/,
    );
  });
});
