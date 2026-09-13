/**
 * Which credentials each deploy target needs, and whether they are present.
 *
 * This is TypeScript rather than a shell condition in a workflow for one reason: the `secrets`
 * context is **not available** in a job-level `if:`, so the guard has to be a preflight job that
 * reads secrets into an output — and a preflight job written in YAML is the one piece of this
 * pipeline that cannot be tested until the day the secrets exist, which is precisely the day it
 * must already work.
 */

export type DeployTarget = 'preview' | 'staging' | 'production';

/**
 * Secret **names**, never values. An agent may not create, read, echo or commit a value
 * (`agents/policies/human-boundaries.md`); every one of these is `[H]` and lives in a GitHub
 * Environment.
 *
 * `production` is deliberately the shortest list. It has no Cloudflare or Neon API key because it
 * must not be able to create or delete a database branch or a Pages project — a release should be
 * able to do one thing, and blast radius is a function of what the token can reach.
 */
export const REQUIRED: Record<DeployTarget, readonly string[]> = {
  preview: [
    'FLY_API_TOKEN',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'NEON_API_KEY',
    'NEON_PROJECT_ID',
    // W2-T01 §4.8. The API exits 78 without it, so a preview whose secret is unset deploys a
    // container that never boots — the half-built state this guard exists to prevent, and the
    // exact shape the PREVIEW_DATABASE_URL note below describes.
    'PREVIEW_BETTER_AUTH_SECRET',
    // No PREVIEW_DATABASE_URL. It was briefly here, and it was the wrong shape twice over: the
    // guard was never handed it (so every preview and every teardown skipped, permanently), and a
    // single static URL points every open pull request at one shared database — which makes the
    // per-PR Neon branch pointless and lets two PRs' migrations corrupt each other. The preview's
    // connection URL now comes back from `neonctl` at deploy time, so it is not a secret a human
    // sets and there is nothing here to check.
  ],
  staging: [
    'FLY_API_TOKEN',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
    'STAGING_DATABASE_URL',
    'STAGING_BETTER_AUTH_SECRET',
  ],
  production: ['FLY_API_TOKEN', 'PRODUCTION_DATABASE_URL', 'PRODUCTION_BETTER_AUTH_SECRET'],
};

export interface DeployConfigResult {
  readonly target: DeployTarget;
  readonly configured: boolean;
  /** Every missing name, in declaration order — not just the first. */
  readonly missing: readonly string[];
}

/**
 * An unset GitHub secret interpolates to the **empty string**, not to nothing: a step that does
 * `env: TOKEN: ${{ secrets.NOPE }}` sees `TOKEN=""`. Treating that as "present" is how a deploy
 * gets as far as authenticating before it discovers it has no credential.
 */
function isSet(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

export function checkDeployConfig(
  env: Record<string, string | undefined>,
  target: DeployTarget,
): DeployConfigResult {
  const missing = REQUIRED[target].filter((name) => !isSet(env[name]));
  return { target, configured: missing.length === 0, missing };
}

/**
 * The message an operator reads in a skipped job's log.
 *
 * Shaped after the `BLOCKED — needs human` block in `agents/policies/human-boundaries.md`: what is
 * missing, and the exact path to set it. It renders **names only** — printing a value, even a
 * partial one, into a log that survives the job is how a token leaks.
 */
export function renderMissing(result: DeployConfigResult, target: DeployTarget): string {
  if (result.configured) {
    return `deploy: every credential for "${target}" is present.`;
  }

  const path = `Settings → Environments → ${target} → Add secret`;
  const lines = [
    `BLOCKED — needs human`,
    `Target:   ${target}`,
    `Need:     ${String(result.missing.length)} secret(s) that no agent may create`,
    `Where:    ${path}`,
    '',
    ...result.missing.map((name) => `  - ${name}`),
    '',
    `Meanwhile: this deploy is skipped, not failed. Nothing was created and nothing was changed.`,
    `See W0-T24 for the activation checklist, and docs/adr/ADR-006 for what each one is for.`,
  ];
  return lines.join('\n');
}
