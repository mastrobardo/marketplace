import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Fingerprint } from './environment.js';
import { VISUAL_CONFIG } from './config.js';

/**
 * What environment is this run actually in — `W12-T16` §4.3.
 *
 * Three of the five fields are facts the process can read. Two — which container image, and at
 * which digest — cannot be known from inside the container, so the workflow passes them in. That is
 * the honest shape: a run with no `VISUAL_IMAGE` is *not claiming* to be the reference environment,
 * and `compareFingerprint` will say so rather than guessing in its favour.
 *
 * The default of `'local'` matters. An empty string would also mismatch, but `'local'` is what a
 * developer reads in the skip message, and the message is the whole point of the local path.
 */
const require = createRequire(import.meta.url);

export function referenceFingerprint(): Fingerprint {
  const path = fileURLToPath(new URL('./fingerprint.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as Fingerprint;
}

export function playwrightVersion(): string {
  const root = dirname(require.resolve('playwright/package.json'));
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

export function actualFingerprint(chromium: string): Fingerprint {
  return {
    image: process.env['VISUAL_IMAGE'] ?? 'local',
    imageDigest: process.env['VISUAL_IMAGE_DIGEST'] ?? 'local',
    playwright: playwrightVersion(),
    chromium,
    viewport: VISUAL_CONFIG.use.viewport,
    deviceScaleFactor: VISUAL_CONFIG.use.deviceScaleFactor,
  };
}

/**
 * `CI` is set by GitHub Actions and by essentially every other runner. Read here rather than in
 * `environment.ts` so that the decision logic stays pure and testable in both directions.
 */
export function isCI(): boolean {
  return process.env['CI'] === 'true' || process.env['CI'] === '1';
}
