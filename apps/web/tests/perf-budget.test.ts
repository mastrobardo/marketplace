/**
 * `W12-T15` — the performance harness's configuration and its decision logic.
 *
 * Lighthouse is not run here. The browser half is exercised by `pnpm --filter @marketplace/web
 * perf` and evidenced in the run record with a deliberate regression; what is asserted here is
 * everything that can go wrong *without* a browser — which, on the evidence of `W12-T16`, is where
 * a gate's real failures live. That ticket's Finding 1 was a threshold that made a carefully
 * configured gate incapable of failing, with every configuration assertion passing throughout.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  evaluate,
  formatShortfall,
  gatedAudits,
  median,
  medianScores,
  scoresFromRun,
} from '../perf/evaluate.mjs';

/** `evaluate.mjs` is plain ESM run by node, so TypeScript infers its shapes rather than being told them. */
type Scores = Record<string, number>;
type Row = { route: string; audit: string; score: number; floor: number; ok: boolean };

const scoresOf = (result: unknown, audits: string[]): Scores =>
  scoresFromRun(result, audits) as Scores;

const perfDir = join(__dirname, '..', 'perf');
const readJson = (name: string) => JSON.parse(readFileSync(join(perfDir, name), 'utf8'));

const profile = readJson('profile.json');
const budget = readJson('budget.json');
const runSource = readFileSync(join(perfDir, 'run.mjs'), 'utf8');

/** A Lighthouse result, cut down to the shape `scoresFromRun` reads. Scores are 0–1, as Lighthouse emits them. */
const lhr = (scores: Record<string, number>) => ({
  audits: Object.fromEntries(Object.entries(scores).map(([id, score]) => [id, { score }])),
});

const perfect = () => lhr(Object.fromEntries(gatedAudits(budget).map((id: string) => [id, 1])));

describe('the throttling profile', () => {
  // AC2. These three numbers ARE the ticket (§3.1). The site scores 68 under Lighthouse's default
  // mobile profile and 100 under this one, with not one byte different — so reverting them does
  // not "restore the defaults", it silently converts a metric gate back into a byte gate. That is
  // a one-line change that reads like a cleanup, which is why it fails the build instead.
  it('is the realistic 4G profile, by value', () => {
    expect(profile.throughputKbps).toBe(10000);
    expect(profile.rttMs).toBe(40);
    expect(profile.cpuSlowdownMultiplier).toBe(4);
  });

  // AC3.
  it('is not Lighthouse’s default mobile profile', () => {
    const lighthouseDefaultMobile = { throughputKbps: 1638.4, rttMs: 150 };
    expect(profile.throughputKbps).not.toBe(lighthouseDefaultMobile.throughputKbps);
    expect(profile.rttMs).not.toBe(lighthouseDefaultMobile.rttMs);
  });

  // AC1. Network numbers live in profile.json and nowhere else; run.mjs must reach them through it.
  it('appears nowhere but profile.json', () => {
    expect(runSource).not.toMatch(/\b10000\b/);
    expect(runSource).not.toMatch(/rttMs:\s*\d/);
    expect(runSource).toMatch(/profile\.throughputKbps/);
    expect(runSource).toMatch(/profile\.rttMs/);
    expect(runSource).toMatch(/profile\.cpuSlowdownMultiplier/);
  });

  // CPU throttling is deliberately NOT relaxed alongside the network: the AC says "a mid-range
  // phone", and a fast link does not make a slow phone fast.
  it('keeps Lighthouse’s CPU slowdown', () => {
    expect(profile.cpuSlowdownMultiplier).toBe(4);
  });
});

describe('the floors', () => {
  // AC4.
  it('are per-audit scores, in one file', () => {
    expect(Object.keys(budget.floors).length).toBeGreaterThan(0);
    for (const [id, floor] of Object.entries(budget.floors)) {
      expect(typeof floor, `${id} floor`).toBe('number');
      expect(floor as number).toBeGreaterThan(0);
      expect(floor as number).toBeLessThanOrEqual(100);
    }
  });

  // AC5 — the completeness assertion. A hand-written subject list has failed three times in this
  // repo, each time by covering less than it claimed. So coverage is DERIVED: the only way to add
  // or remove an audit is to add or remove a floor, and this asserts there is no second list.
  it('are the single source of what the harness covers', () => {
    expect(gatedAudits(budget)).toEqual(Object.keys(budget.floors).sort());

    const { rows } = evaluate([{ label: 'home', scores: scoresOf(perfect(), gatedAudits(budget)) }], budget);
    expect((rows as Row[]).map((r) => r.audit).sort()).toEqual(Object.keys(budget.floors).sort());
  });

  // AC6. A weighted category score lets a real LCP regression hide behind a perfect TBT and CLS —
  // which, with TBT at 0 ms and CLS at 0 today, is precisely the masking available here.
  it('never assert the blended category score', () => {
    expect(runSource).not.toMatch(/categories\.performance\.score/);
    expect(budget.floors).not.toHaveProperty('performance');
  });

  // AC7.
  it('omit INP, and say why', () => {
    expect(budget.floors).not.toHaveProperty('inp');
    expect(budget.floors).not.toHaveProperty('interaction-to-next-paint');
    expect(budget._whyNoInp).toMatch(/total-blocking-time/);
    expect(budget.floors).toHaveProperty('total-blocking-time');
  });

  // AC16 / AC17 — the two things this ticket must not smuggle back in. The byte budget was deleted
  // by operator decision, not relaxed; and gating Lighthouse's SEO category would reinstate work
  // that ADR-011 Amendment 1 deferred.
  it('are expressed in scores, never in bytes', () => {
    expect(JSON.stringify(budget.floors)).not.toMatch(/byte|kb|kib|size/i);
    expect(runSource).not.toMatch(/\b170\b/);
    expect(budget._whyNoBytes).toMatch(/operator/i);
  });

  it('request no Lighthouse category but performance', () => {
    expect(runSource).toMatch(/onlyCategories:\s*\['performance'\]/);
    expect(runSource).not.toMatch(/'seo'|'accessibility'|'best-practices'/);
  });
});

describe('the routes', () => {
  // AC11.
  it('are the home and results pages, results carrying its query state', () => {
    const paths = budget.routes.map((r: { path: string }) => r.path);
    expect(paths).toContain('/es/');
    expect(paths.some((p: string) => p.startsWith('/es/search?'))).toBe(true);
  });

  // The standing rule: the language prefix stays, every segment after it is English.
  it('never translate a URL segment', () => {
    for (const { path } of budget.routes) {
      expect(path).not.toMatch(/\/buscar|\/anuncio|\/servicios/);
    }
  });
});

describe('the decision', () => {
  it('passes when every median is at or above its floor', () => {
    const scores = scoresOf(perfect(), gatedAudits(budget));
    const { shortfalls } = evaluate([{ label: 'home', scores }], budget);
    expect(shortfalls).toEqual([]);
  });

  // The other direction, which is the one that matters: a gate only ever seen passing is unproven.
  it('reports a shortfall when a median falls below its floor', () => {
    const audits = gatedAudits(budget);
    const scores = scoresOf(perfect(), audits);
    scores['largest-contentful-paint'] = budget.floors['largest-contentful-paint'] - 1;

    const { shortfalls } = evaluate([{ label: 'home', scores }], budget);
    expect(shortfalls).toHaveLength(1);
    expect((shortfalls as Row[])[0]?.audit).toBe('largest-contentful-paint');
  });

  it('treats exactly the floor as passing', () => {
    const audits = gatedAudits(budget);
    const scores = scoresOf(perfect(), audits);
    scores['first-contentful-paint'] = budget.floors['first-contentful-paint'];
    expect(evaluate([{ label: 'home', scores }], budget).shortfalls).toEqual([]);
  });

  // AC15 — the output names what regressed, what it measured and what it owed.
  it('names the audit, the score and the floor', () => {
    const line = formatShortfall({ route: 'home', audit: 'largest-contentful-paint', score: 40, floor: 85 });
    expect(line).toContain('home');
    expect(line).toContain('largest-contentful-paint');
    expect(line).toContain('40');
    expect(line).toContain('85');
  });
});

describe('summarising runs', () => {
  // AC10 — median, not mean. One Lighthouse run on a shared runner is a sample, and a mean drags
  // an outlier into the verdict.
  it('takes the median, so one bad run cannot decide', () => {
    expect(median([100, 100, 10])).toBe(100);
    expect(median([10, 100, 100])).toBe(100);
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  it('medians each audit independently across runs', () => {
    const audits = ['first-contentful-paint'];
    const runs = [lhr({ 'first-contentful-paint': 1 }), lhr({ 'first-contentful-paint': 0.2 }), lhr({ 'first-contentful-paint': 1 })];
    expect(medianScores(runs, audits)).toEqual({ 'first-contentful-paint': 100 });
  });

  it('is configured to run more than once', () => {
    expect(budget.numberOfRuns).toBeGreaterThanOrEqual(3);
  });

  // Fail closed. "Lighthouse did not report this audit" must never read as "this audit is fine" —
  // that is the precise shape of a gate that fails open, and deriving the list from the floors
  // buys nothing if the lookup then shrugs.
  it('throws rather than passing when an audit is missing', () => {
    expect(() => scoresFromRun(lhr({}), ['largest-contentful-paint'])).toThrow(/no audit/);
    expect(() => scoresFromRun({ audits: { x: { score: null } } }, ['x'])).toThrow(/numeric/);
  });
});

describe('what the harness does in the MVP phase', () => {
  // §3.3 — it reports. Performance is not a merge gate while there are no users; the decision
  // logic already knows what a shortfall is, so this becomes a gate by changing an exit code.
  it('does not fail the process on a shortfall', () => {
    // The shortfall branch only. `main().catch` below it exits 1 deliberately — a crashed run is
    // not a slow page, and swallowing that would make a broken harness look like a passing one.
    const branch = runSource.slice(
      runSource.indexOf('if (shortfalls.length > 0)'),
      runSource.indexOf('main().catch'),
    );
    expect(branch).not.toMatch(/process\.exit/);
    expect(branch).toMatch(/not blocking/i);

    // And the crash path does still exit non-zero.
    expect(runSource.slice(runSource.indexOf('main().catch'))).toMatch(/process\.exit\(1\)/);
  });

  // AC9 — the first request to a cold server pays for something the change did not cause.
  it('discards a warm-up navigation before measuring', () => {
    expect(runSource).toMatch(/warm-up/i);
    expect(runSource.indexOf('warm-up')).toBeLessThan(runSource.indexOf('lhrs.push'));
  });
});
