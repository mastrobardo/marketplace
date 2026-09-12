#!/usr/bin/env node
/**
 * A static server for the built storefront, with the SPA fallback the workbench's server does not
 * need — `W12-T15` §3.4 measures `/es/search?…`, which exists only as a client route.
 *
 * Forty lines instead of a dependency, for the same reason `visual/serve.mjs` gives: a network
 * fetch at run time inside a job whose point is reproducibility.
 *
 *   node perf/run.mjs            # builds nothing, serves ./dist, measures it
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export function startServer(rootDirectory, port = 0) {
  const root = resolve(rootDirectory);

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    // `normalize` then a prefix check: `/../../etc/passwd` must not escape the root. This only
    // ever faces localhost, and that is not a reason to write it wrong.
    const target = normalize(join(root, decodeURIComponent(url.pathname)));
    const safe = target.startsWith(root + sep) || target === root ? target : root;

    let file = safe;
    try {
      if (statSync(file).isDirectory()) file = join(file, 'index.html');
      statSync(file);
    } catch {
      // The SPA fallback. A client route has no file, and serving 404 here would measure the
      // 404 — which is fast, and would pass.
      file = join(root, 'index.html');
      try {
        statSync(file);
      } catch {
        response.writeHead(404, { 'content-type': 'text/plain' });
        response.end('not found');
        return;
      }
    }

    response.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      // Never measure a page the browser remembered.
      'cache-control': 'no-store',
    });
    createReadStream(file).pipe(response);
  });

  return new Promise((resolveStarted) => {
    server.listen(port, '127.0.0.1', () => {
      resolveStarted({ server, port: server.address().port });
    });
  });
}
