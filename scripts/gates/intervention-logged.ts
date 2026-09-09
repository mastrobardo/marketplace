/**
 * Gate `intervention-logged` — a PR that admits a human touched it must carry the ledger entry.
 *
 * `TODO.md` §5.6: "if a PR carries any `intervention:*` label, it cannot merge without a matching
 * file in `docs/interventions/`."
 *
 * The ledger is the dataset that says which agents and which prompts are weak. A label with no
 * entry is the one outcome that destroys it: it records that something happened and nothing about
 * what, which is worse than no label at all.
 */
import { fail, pass, skip, type GateResult } from './types.js';
import { parseBranch } from './task-id.js';

export interface InterventionFacts {
  readonly branch: string;
  readonly labels: readonly string[];
  readonly changedFiles: readonly string[];
}

export const LABEL_PREFIX = 'intervention:';

/** `docs/interventions/YYYY-MM-DD-<TASK-ID>-<n>.md` (TODO.md §5.6). */
function ledgerPattern(taskId: string | null): RegExp {
  const id = taskId ?? '[A-Z]+\\d*-?T?\\d+';
  return new RegExp(`^docs/interventions/\\d{4}-\\d{2}-\\d{2}-${id}-\\d+\\.md$`);
}

export function checkInterventionLogged(facts: InterventionFacts): GateResult {
  const claimed = facts.labels.filter((label) => label.startsWith(LABEL_PREFIX));
  if (claimed.length === 0) {
    return skip('no intervention:* label — nothing claimed, nothing to log.');
  }

  const branch = parseBranch(facts.branch);
  const pattern = ledgerPattern(branch?.taskId ?? null);
  const entries = facts.changedFiles.filter((path) => pattern.test(path));

  if (entries.length > 0) {
    return pass(`${claimed.join(', ')} logged in ${entries.join(', ')}.`);
  }

  const want =
    branch === null
      ? 'docs/interventions/YYYY-MM-DD-<TASK-ID>-<n>.md'
      : `docs/interventions/YYYY-MM-DD-${branch.taskId}-<n>.md`;

  return fail(
    'INTERVENTION_UNLOGGED',
    `this PR is labelled ${claimed.join(', ')} but adds no ledger entry.\n` +
      `  expected a file matching:\n    ${want}\n` +
      `  Use docs/interventions/_TEMPLATE.md. The template and ROLLUP.md do not count —\n` +
      `  neither records anything that happened.\n` +
      `  A rejection is the most informative signal we get (TODO.md §5.6); losing it costs more\n` +
      `  than the five minutes the entry takes.`,
  );
}
