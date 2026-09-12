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
