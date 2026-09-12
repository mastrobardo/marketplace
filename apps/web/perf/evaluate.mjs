/**
 * The decision half of the performance harness — `W12-T15` §3.2.
 *
 * Pure on purpose: no browser, no network, no clock. Everything here is a function from a
 * Lighthouse result to a verdict, so both directions can be tested without running Lighthouse.
 * `W12-T16`'s Finding 1 is the standing argument for that split — every assertion about that
 * gate's *configuration* passed while the gate itself was incapable of failing, and the only thing
 * that found it was exercising the decision against a deliberate regression.
 */

/**
 * The audits this harness covers, derived from the floors rather than listed beside them.
 *
 * One list, not two. A hand-written subject list has now failed three times in this repo (the
 * suite list, the contrast colour pairs, the `.css`-only walk), each time by silently covering
 * less than it claimed. Adding a floor is the only way to add coverage, and removing one is the
 * only way to remove it — there is no second place to forget.
 */
export function gatedAudits(budget) {
  return Object.keys(budget.floors).sort();
}

/** Median, not mean: one Lighthouse run on a shared runner is a sample, and a mean carries its outliers. */
export function median(numbers) {
  if (numbers.length === 0) throw new Error('median of nothing');
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Pull one run's scores for the gated audits, as 0–100.
 *
 * A missing audit throws rather than defaulting. A gate that treats "Lighthouse did not report
 * this" as "this is fine" is a gate that fails open, and the whole point of deriving the list from
 * the floors is lost if the lookup then shrugs.
 */
export function scoresFromRun(lhr, audits) {
  const scores = {};
  for (const id of audits) {
    const audit = lhr?.audits?.[id];
    if (audit === undefined) throw new Error(`Lighthouse reported no audit "${id}"`);
    if (typeof audit.score !== 'number') {
      throw new Error(`audit "${id}" has no numeric score (got ${JSON.stringify(audit.score)})`);
    }
    scores[id] = Math.round(audit.score * 100);
  }
  return scores;
}

/** Per-audit median across the runs for one route. */
export function medianScores(lhrs, audits) {
  if (lhrs.length === 0) throw new Error('no runs to summarise');
  const perRun = lhrs.map((lhr) => scoresFromRun(lhr, audits));
  const scores = {};
  for (const id of audits) scores[id] = median(perRun.map((run) => run[id]));
  return scores;
}

/**
 * Compare every route's median scores against the floors.
 *
 * Returns rather than throws: the caller decides whether a shortfall is fatal. In the MVP phase it
 * is not — this reports (§3.3) — and the same function becomes a blocking gate later by changing
 * the exit code, not the decision.
 */
export function evaluate(routeResults, budget) {
  const audits = gatedAudits(budget);
  const rows = [];
  const shortfalls = [];

  for (const route of routeResults) {
    for (const id of audits) {
      const score = route.scores[id];
      const floor = budget.floors[id];
      const row = { route: route.label, audit: id, score, floor, ok: score >= floor };
      rows.push(row);
      if (!row.ok) shortfalls.push(row);
    }
  }

  return { rows, shortfalls, audits };
}

/** One line per shortfall, naming the audit, what it measured and what it owed — never just a red X. */
export function formatShortfall({ route, audit, score, floor }) {
  return `${route}: ${audit} scored ${score}, floor is ${floor} (short by ${floor - score})`;
}

/**
 * Shorten an audit id for a table heading: `largest-contentful-paint` → `LCP`.
 *
 * Derived from the id rather than looked up in a map, deliberately. A map would be a second
 * hand-written list keyed by audit — the exact shape that has silently lost coverage three times in
 * this repo — and adding a floor for a metric nobody had abbreviated would render a blank column
 * header rather than fail.
 */
export function abbreviate(auditId) {
  return auditId
    .split('-')
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * The run recap — `W12-T15` §3.6.
 *
 * A pivot of routes against audits, because that is the shape a reader scans: one row per page,
 * one column per metric. Columns come from `gatedAudits`, so the table cannot describe fewer
 * metrics than the harness measured.
 */
export function browserVersion(lhr) {
  const agent = lhr?.environment?.hostUserAgent ?? '';
  return /Chrome\/([\d.]+)/.exec(agent)?.[1] ?? 'unknown';
}

export function formatMarkdown({
  rows,
  audits,
  profile,
  numberOfRuns,
  floors,
  browser,
  screenshotCount = 0,
}) {
  const routes = [];
  for (const row of rows) if (!routes.includes(row.route)) routes.push(row.route);

  const cell = (route, audit) => {
    const row = rows.find((r) => r.route === route && r.audit === audit);
    if (row === undefined) return '—';
    return row.ok ? `${row.score}` : `**${row.score}** ⚠`;
  };

  const floorValues = [...new Set(audits.map((id) => floors[id]))];
  const floorNote =
    floorValues.length === 1
      ? `Floor is ${floorValues[0]} for every metric.`
      : audits.map((id) => `${abbreviate(id)} ≥ ${floors[id]}`).join(' · ');

  const shortfalls = rows.filter((row) => !row.ok);

  return [
    '## Performance',
    '',
    `\`${profile.throughputKbps} Kbps\` down · \`${profile.rttMs} ms\` RTT · ` +
      `\`${profile.cpuSlowdownMultiplier}×\` CPU — median of ${numberOfRuns} runs, scores out of 100.`,
    '',
    // The browser is part of the measurement, and a Chrome update moving every number at once is
    // otherwise indistinguishable from a regression. `W12-T16` learned this as `fingerprint.json`.
    `Chrome \`${browser}\`.`,
    '',
    `| route | ${audits.map(abbreviate).join(' | ')} |`,
    `|---|${audits.map(() => '---').join('|')}|`,
    ...routes.map((route) => `| ${route} | ${audits.map((id) => cell(route, id)).join(' | ')} |`),
    '',
    floorNote,
    '',
    shortfalls.length === 0
      ? 'Everything at or above its floor.'
      : [
          `${shortfalls.length} below floor — **reported, not blocking**: performance is not a merge gate in the MVP phase.`,
          '',
          ...shortfalls.map((row) => `- ${formatShortfall(row)}`),
          ...(screenshotCount > 0
            ? [
                '',
                `📷 ${screenshotCount} images attached as the **perf-screenshots** artifact on this run — ` +
                  'a filmstrip per failing route, frames named by the millisecond they painted, plus the final frame.',
              ]
            : []),
        ].join('\n'),
    '',
    `<sub>${audits.map((id) => `${abbreviate(id)} — ${id}`).join(' · ')}</sub>`,
    '',
  ].join('\n');
}

/**
 * The images a shortfall should carry — `W12-T15` §3.7.
 *
 * A number that says a page got slower does not say *what* the user saw, and "open the log" is the
 * instruction nobody follows. Lighthouse already captures these during the run being measured, so
 * this costs no extra browser work: it is decoding what is already in the result.
 *
 * Both kinds, deliberately:
 *   - the **filmstrip**, which is the diagnostic one for a performance regression — eight frames
 *     with their timings, so "blank until 3.4s" is visible rather than inferred;
 *   - the **final screenshot**, which answers the other question a red run raises: whether the page
 *     rendered at all, or whether the harness measured an error state very quickly.
 *
 * Pure: takes a Lighthouse result, returns buffers. No filesystem, so it is tested without one.
 */
export function screenshotsFrom(lhr, label) {
  const shots = [];

  const decode = (dataUri) => {
    const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/s.exec(dataUri ?? '');
    if (match === null) return null;
    return {
      extension: match[1] === 'jpeg' ? 'jpg' : match[1],
      buffer: Buffer.from(match[2], 'base64'),
    };
  };

  const final = decode(lhr?.audits?.['final-screenshot']?.details?.data);
  if (final !== null)
    shots.push({ name: `${label}-final.${final.extension}`, buffer: final.buffer });

  const frames = lhr?.audits?.['screenshot-thumbnails']?.details?.items ?? [];
  frames.forEach((frame, index) => {
    const decoded = decode(frame?.data);
    if (decoded === null) return;
    // The timing is in the filename because the order of eight files is not the story — *when each
    // one painted* is. Padded so a directory listing sorts the way the page actually loaded.
    const ms = String(Math.round(frame.timing ?? 0)).padStart(5, '0');
    shots.push({
      name: `${label}-filmstrip-${String(index).padStart(2, '0')}-${ms}ms.${decoded.extension}`,
      buffer: decoded.buffer,
    });
  });

  return shots;
}
