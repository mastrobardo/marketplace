/**
 * Gate `agents-drift` — `.claude/agents/` still matches `agents/roles/`.
 *
 * `.claude/agents/` is build output: `scripts/generate-claude-agents.ts` renders it from the
 * charters in `agents/roles/`. Hand-edit one and Claude Code reads a charter the repo does not
 * describe — which is how a subagent ends up with boundaries nobody reviewed.
 *
 * The pure half here judges the generator's verdict rather than re-deriving it. The generator
 * stays the single source of truth for what a generated charter looks like; a second
 * implementation of the comparison is a second thing to keep in step, and the first divergence
 * between them would be invisible.
 */
import { fail, pass, type GateResult } from './types.js';

export interface DriftFacts {
  /** The generator's exit code in `--check` mode: 0 when in sync. */
  readonly exitCode: number;
  /** Everything it printed — stdout and stderr together; it names the drifted file on stderr. */
  readonly output: string;
}

export function checkAgentsDrift(facts: DriftFacts): GateResult {
  const said = facts.output.trim();

  if (facts.exitCode === 0) {
    return pass(said === '' ? '.claude/agents is in sync with agents/roles.' : said);
  }

  // A generator that cannot run at all is not a repository in sync — it is a gate that saw
  // nothing, and those report failure here rather than success.
  const detail =
    said === '' ? `the generator exited ${String(facts.exitCode)} without saying why.` : said;

  return fail(
    'AGENTS_DRIFT',
    `${detail}\n` +
      `  .claude/agents/ is generated from agents/roles/ and is never hand-edited.\n` +
      `  Regenerate it and commit the result:\n` +
      `    pnpm tsx scripts/generate-claude-agents.ts`,
  );
}
