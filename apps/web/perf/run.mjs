#!/usr/bin/env node
/**
 * The performance harness — `W12-T15`.
 *
 * **This reports. It does not block.** Performance is kept in mind while developing and is not a
 * merge gate in the MVP phase (operator, 2026-09-12): early optimisation is the root of all evil,
 * and a gate that fails a pull request over 40 ms of drift on a product with no users is exactly
 * that. The decision logic in `evaluate.mjs` already knows what a shortfall is, so turning this
 * into a gate later is an exit code, not a rewrite. See §3.3.
 *
 *   node perf/run.mjs                      # serve ./dist locally and measure it
 *   node perf/run.mjs https://example.dev  # measure a deployed URL instead
 *   node perf/run.mjs --json out.json      # also write the full rows
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { evaluate, formatShortfall, gatedAudits, medianScores } from './evaluate.mjs';
import { startServer } from './serve.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (name) => JSON.parse(readFileSync(join(here, name), 'utf8'));

const profile = readJson('profile.json');
const budget = readJson('budget.json');

const args = process.argv.slice(2);
const jsonFlag = args.indexOf('--json');
const jsonPath = jsonFlag === -1 ? null : args[jsonFlag + 1];
const baseArg = args.find((a) => a.startsWith('http'));

/**
 * The throttling profile, assembled here from `profile.json` and nowhere else.
 *
 * `simulate` rather than `devtools`: simulated (Lantern) throttling is dramatically more stable on
 * a shared runner, and stability is what makes a score floor mean something. The three numbers are
 * the ticket — see §3.1 and the test that asserts them.
 */
function lighthouseConfig() {
  return {
    extends: 'lighthouse:default',
    settings: {
      onlyCategories: ['performance'],
      formFactor: 'mobile',
      screenEmulation: { mobile: true, width: 412, height: 915, deviceScaleFactor: 2.625, disabled: false },
      throttlingMethod: 'simulate',
      throttling: {
        rttMs: profile.rttMs,
        throughputKbps: profile.throughputKbps,
        cpuSlowdownMultiplier: profile.cpuSlowdownMultiplier,
        requestLatencyMs: profile.rttMs * 4,
        downloadThroughputKbps: profile.throughputKbps,
        uploadThroughputKbps: Math.round(profile.throughputKbps * 0.3),
      },
    },
  };
}

async function main() {
  const lighthouse = (await import('lighthouse')).default;
  const chromeLauncher = await import('chrome-launcher');

  let server = null;
  let base = baseArg;
  if (base === undefined) {
    const started = await startServer(resolve(here, '..', 'dist'));
    server = started.server;
    base = `http://127.0.0.1:${started.port}`;
    process.stdout.write(`serving ./dist on ${base}\n`);
  }

  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
  });

  const audits = gatedAudits(budget);
  const routeResults = [];

  try {
    for (const route of budget.routes) {
      const url = `${base}${route.path}`;

      // A warm-up, discarded. The first request to a cold server or a cold edge cache pays for
      // something the change under review did not cause. §3.3.
      await lighthouse(url, { port: chrome.port, output: 'json', logLevel: 'error' }, lighthouseConfig());

      const lhrs = [];
      for (let run = 0; run < budget.numberOfRuns; run += 1) {
        const result = await lighthouse(
          url,
          { port: chrome.port, output: 'json', logLevel: 'error' },
          lighthouseConfig(),
        );
        if (!result?.lhr) throw new Error(`Lighthouse returned no result for ${url}`);
        lhrs.push(result.lhr);
      }

      routeResults.push({ label: route.label, path: route.path, scores: medianScores(lhrs, audits) });
    }
  } finally {
    await chrome.kill();
    server?.close();
  }

  const { rows, shortfalls } = evaluate(routeResults, budget);

  process.stdout.write(
    `\nprofile: ${profile.throughputKbps} Kbps down, ${profile.rttMs} ms RTT, ` +
      `${profile.cpuSlowdownMultiplier}x CPU — median of ${budget.numberOfRuns} runs\n\n`,
  );
  for (const row of rows) {
    const mark = row.ok ? 'ok  ' : 'LOW ';
    process.stdout.write(`  ${mark} ${row.route.padEnd(8)} ${row.audit.padEnd(26)} ${String(row.score).padStart(3)} (floor ${row.floor})\n`);
  }

  if (jsonPath !== null && jsonPath !== undefined) {
    writeFileSync(jsonPath, `${JSON.stringify({ profile, rows }, null, 2)}\n`);
    process.stdout.write(`\nwrote ${jsonPath}\n`);
  }

  if (shortfalls.length > 0) {
    process.stdout.write(`\n${shortfalls.length} below floor:\n`);
    for (const row of shortfalls) process.stdout.write(`  ${formatShortfall(row)}\n`);
    // Reported, not fatal. See the header.
    process.stdout.write('\nReported, not blocking — performance is not a merge gate in the MVP phase.\n');
  } else {
    process.stdout.write('\nEverything at or above its floor.\n');
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
