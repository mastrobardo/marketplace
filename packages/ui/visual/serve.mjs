#!/usr/bin/env node
/**
 * A static file server for the built workbench — `W12-T16` §4.1.
 *
 * Forty lines instead of a dependency. The alternatives were `npx serve` (a network fetch at run
 * time, inside a job whose whole point is reproducibility) or `vite preview` (which wants a Vite
 * config describing a build this directory is not the output of). ADR-012 §6 rejected a fifth
 * vendor for the screenshots; it would be odd to add one to hand out the files.
 *
 *   node visual/serve.mjs storybook-static 6007
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? 'storybook-static');
const port = Number(process.argv[3] ?? 6007);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  // `normalize` then a prefix check: a request for `/../../etc/passwd` must not escape the root.
  // This server only ever faces localhost inside a CI job, and that is not a reason to write it
  // wrong.
  const target = normalize(join(root, decodeURIComponent(url.pathname)));
  const path = target.startsWith(root + sep) || target === root ? target : root;

  let file = path;
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    statSync(file);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
    return;
  }

  response.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    // A baseline must not be compared against a page the browser remembered.
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`serving ${root} on http://127.0.0.1:${port}\n`);
});
