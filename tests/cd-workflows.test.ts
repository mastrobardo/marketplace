import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOWS = join(root, '.github', 'workflows');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  id?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  if?: string;
}

interface Job {
  needs?: string | string[];
  'timeout-minutes'?: number;
  environment?: unknown;
  permissions?: Record<string, string>;
  steps?: Step[];
  if?: string;
  outputs?: Record<string, string>;
}

interface Workflow {
  name?: string;
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, Job>;
}

const PREVIEW = 'deploy-preview.yml';
const TEARDOWN = 'deploy-preview-teardown.yml';
const STAGING = 'deploy-staging.yml';
const RELEASE = 'release-production.yml';
const DEPLOY_WORKFLOWS = [PREVIEW, TEARDOWN, STAGING, RELEASE] as const;

function text(file: string): string {
  const path = join(WORKFLOWS, file);
  expect(existsSync(path), `.github/workflows/${file} does not exist`).toBe(true);
  return readFileSync(path, 'utf8');
}

function workflow(file: string): Workflow {
  return parseYaml(text(file)) as Workflow;
}

/**
 * The file with its comments removed.
 *
 * Assertions about what a workflow *does* must read code, not prose: these files explain at length
 * why they do not use `pull_request_target` and why the release has no `docker build`, and a naive
 * grep over the raw text flags those explanations as the very thing they rule out.
 */
function code(file: string): string {
  return text(file)
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, ''))
    .join('\n');
}

function jobs(file: string): Record<string, Job> {
  return workflow(file).jobs ?? {};
}

function steps(job: Job): Step[] {
  return job.steps ?? [];
}

function script(job: Job): string {
  return steps(job)
    .map((step) => [step.uses ?? '', step.run ?? '', JSON.stringify(step.env ?? {})].join('\n'))
    .join('\n');
}

/** Every job that actually touches a provider — the preflight/guard jobs are not deploy jobs. */
function deployJobs(file: string): Array<[string, Job]> {
  return Object.entries(jobs(file)).filter(([name]) => name !== 'preflight');
}

/* ------------------------------------------------------------------------------------------- *
 * Preview lifecycle — AC9..AC12
 * ------------------------------------------------------------------------------------------- */

describe('AC9 — a preview follows the pull request', () => {
  it('runs when a PR is opened, pushed to, or reopened', () => {
    const trigger = workflow(PREVIEW).on?.['pull_request'] as { types?: string[] } | undefined;
    expect(trigger?.types?.sort()).toEqual(['opened', 'reopened', 'synchronize']);
  });
});

describe('AC10 — a preview is destroyed when its PR closes', () => {
  it('runs on closed, which covers merged and abandoned alike', () => {
    const trigger = workflow(TEARDOWN).on?.['pull_request'] as { types?: string[] } | undefined;
    expect(trigger?.types).toEqual(['closed']);
  });
});

describe('AC11 — teardown is idempotent', () => {
  it('tolerates a resource that is already gone', () => {
    const body = code(TEARDOWN);
    // Destroying something absent must not fail the job, or a re-run leaves resources alive and
    // billing. Either the command is told to tolerate it, or the step swallows a non-zero exit.
    expect(body).toMatch(/\|\|\s*true|continue-on-error|--yes|if\s*\[/);
  });
});

describe('AC12 — the environment name has one source', () => {
  for (const file of [PREVIEW, TEARDOWN]) {
    it(`${file} computes the app name with scripts/deploy, never as a YAML literal`, () => {
      const body = code(file);
      expect(body).toMatch(/scripts\/deploy/);
      expect(body, 'the app name is spelled out in YAML — it will drift from names.ts').not.toMatch(
        /marketplace-api-pr-\$\{\{/,
      );
    });
  }
});

/* ------------------------------------------------------------------------------------------- *
 * Promotion — AC13..AC17
 * ------------------------------------------------------------------------------------------- */

describe('AC13 — staging follows main', () => {
  it('triggers on push to main only', () => {
    const on = workflow(STAGING).on ?? {};
    expect(Object.keys(on)).toEqual(['push']);
    expect(on['push']).toMatchObject({ branches: ['main'] });
  });
});

describe('AC14 — production is a deliberate act', () => {
  it('triggers on a v* tag', () => {
    const on = workflow(RELEASE).on ?? {};
    expect(on['push']).toMatchObject({ tags: ['v*'] });
  });

  it('runs in the production environment, so a reviewer can be required', () => {
    const environments = deployJobs(RELEASE).map(([, job]) => job.environment);
    expect(environments.length).toBeGreaterThan(0);
    for (const environment of environments) {
      expect(JSON.stringify(environment)).toContain('production');
    }
  });
});

describe('AC15 — production runs the bytes staging tested', () => {
  it('deploys an existing image and never builds one', () => {
    const body = code(RELEASE);
    expect(
      body,
      'the release rebuilds from source — ADR-006 says promote the artifact',
    ).not.toMatch(/docker build|flyctl deploy(?![^\n]*--image)/);
    expect(body).toMatch(/--image/);
  });
});

describe('AC16 — migrations are their own step, before the deploy', () => {
  for (const file of [STAGING, RELEASE]) {
    it(`${file} migrates in a separate step that precedes the deploy`, () => {
      const body = code(file);
      const migrate = body.indexOf('db:migrate:deploy');
      const deploy = body.lastIndexOf('deploy --image');
      expect(migrate, `${file} never runs migrations`).toBeGreaterThan(-1);
      if (deploy > -1) {
        expect(migrate, `${file} deploys before migrating`).toBeLessThan(deploy);
      }
    });
  }

  it('never runs migrations from application start-up', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(manifest.scripts?.['start'] ?? '').not.toMatch(/migrate/);
  });
});

describe('AC17 — a release can name exactly one build', () => {
  it('tags the staging image with the commit sha', () => {
    expect(code(STAGING)).toMatch(/github\.sha/);
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Safety — AC18..AC24
 * ------------------------------------------------------------------------------------------- */

describe('AC18 — pull_request_target is never used', () => {
  for (const file of DEPLOY_WORKFLOWS) {
    it(`${file} does not run untrusted code with secrets`, () => {
      expect(code(file)).not.toMatch(/pull_request_target/);
    });
  }
});

describe('AC19 — every deploy job is scoped to an environment', () => {
  for (const file of DEPLOY_WORKFLOWS) {
    it(`${file} declares an environment on every deploy job`, () => {
      const entries = deployJobs(file);
      expect(entries.length, `${file} has no deploy job`).toBeGreaterThan(0);
      for (const [name, job] of entries) {
        expect(job.environment, `${file}:${name} has no environment:`).toBeDefined();
      }
    });
  }
});

describe('AC20 — permissions are explicit and minimal', () => {
  for (const file of DEPLOY_WORKFLOWS) {
    it(`${file} declares top-level permissions with contents: read`, () => {
      const permissions = workflow(file).permissions;
      expect(permissions, `${file} declares no permissions`).toBeDefined();
      expect(permissions?.['contents']).toBe('read');
    });
  }

  it('only the preview workflow may write to pull requests, and only to comment a URL', () => {
    for (const file of [TEARDOWN, STAGING, RELEASE]) {
      expect(workflow(file).permissions?.['pull-requests']).not.toBe('write');
    }
    expect(workflow(PREVIEW).permissions?.['pull-requests']).toBe('write');
  });
});

describe('AC21 — a missing secret is a reported skip, not a crash', () => {
  for (const file of DEPLOY_WORKFLOWS) {
    it(`${file} gates every deploy job on the guard`, () => {
      const graph = jobs(file);
      expect(graph['preflight'], `${file} has no preflight job`).toBeDefined();

      for (const [name, job] of deployJobs(file)) {
        const needs = job.needs;
        const parents = needs === undefined ? [] : Array.isArray(needs) ? needs : [needs];
        expect(parents, `${file}:${name} does not wait for preflight`).toContain('preflight');
        expect(job.if, `${file}:${name} is not gated on the guard's answer`).toMatch(
          /needs\.preflight\.outputs/,
        );
      }
    });

    it(`${file}'s preflight runs the tested guard rather than an inline shell test`, () => {
      expect(script(jobs(file)['preflight'] ?? {})).toMatch(/scripts\/deploy/);
    });
  }
});

describe('AC22 — no secret value is anywhere in the repository', () => {
  it('finds no provider token shape in any tracked file', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);

    // Prefixes the three providers actually use, plus a generic GitHub token.
    const shapes = /(FlyV1 |fo1_|CFPAT-|neon_api_key_[A-Za-z0-9]|gh[pousr]_[A-Za-z0-9]{20})/;

    // This file necessarily contains every prefix it searches for, so it matches itself as soon as
    // it is tracked — which is why this passed locally, while untracked, and failed in CI on the
    // very first run. Excluded by path rather than by obfuscating the patterns: a scanner whose
    // rules are unreadable is worse than one with a named exception.
    const self = 'tests/cd-workflows.test.ts';
    const offenders = tracked.filter((file) => {
      if (file === self) return false;
      try {
        return shapes.test(readFileSync(join(root, file), 'utf8'));
      } catch {
        return false;
      }
    });
    expect(offenders).toEqual([]);
  });
});

describe('AC23 — every action is pinned', () => {
  for (const file of DEPLOY_WORKFLOWS) {
    it(`${file} uses no moving ref`, () => {
      for (const [, job] of Object.entries(jobs(file))) {
        for (const step of steps(job)) {
          if (step.uses === undefined) continue;
          const ref = step.uses.startsWith('docker://')
            ? (step.uses.split(':').pop() ?? '')
            : (step.uses.split('@')[1] ?? '');
          expect(ref, `${file}: ${step.uses} names no version`).not.toBe('');
          expect(ref, `${file}: ${step.uses} floats`).not.toMatch(/^(main|master|latest)$/);
        }
      }
    });
  }
});

describe('AC24 — no deploy job can hang', () => {
  for (const file of DEPLOY_WORKFLOWS) {
    it(`${file} sets timeout-minutes on every job`, () => {
      for (const [name, job] of Object.entries(jobs(file))) {
        expect(job['timeout-minutes'], `${file}:${name} has no timeout`).toBeDefined();
      }
    });
  }
});

/* ------------------------------------------------------------------------------------------- *
 * Documentation and blast radius — AC25, AC26
 * ------------------------------------------------------------------------------------------- */

describe('AC25 — a human can find out what to set and where', () => {
  it('documents every environment and every secret name in the README', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    for (const environment of ['preview', 'staging', 'production']) {
      expect(readme, `README does not describe the ${environment} environment`).toContain(
        environment,
      );
    }
    for (const secret of [
      'FLY_API_TOKEN',
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_ACCOUNT_ID',
      'NEON_API_KEY',
    ]) {
      expect(readme, `README does not name ${secret}`).toContain(secret);
    }
    expect(readme).toMatch(/Settings.*Environments/s);
  });
});

describe('AC27 — the image carries a usable Prisma client', () => {
  const dockerfile = readFileSync(join(root, 'infra/docker/api.Dockerfile'), 'utf8');

  it('regenerates the client after pruning, not only before', () => {
    const prune = dockerfile.indexOf('deploy --legacy');
    const generate = dockerfile.lastIndexOf('prisma generate');
    expect(prune, 'the image never prunes dev dependencies').toBeGreaterThan(-1);
    expect(generate, 'the image never generates a Prisma client').toBeGreaterThan(-1);
    // `pnpm deploy` rebuilds node_modules from the store, and the store holds the *published*
    // @prisma/client — a shell whose real code `prisma generate` writes into the installed
    // package. Generating only before the prune ships a client that throws on first import, and
    // nothing notices until a route runs a query in production.
    expect(generate, 'the Prisma client is generated before the prune discards it').toBeGreaterThan(
      prune,
    );
  });

  it('never migrates from application start-up', () => {
    const cmd = dockerfile.slice(dockerfile.lastIndexOf('CMD'));
    expect(cmd).not.toMatch(/migrate/);
  });

  it('does not run as root', () => {
    expect(dockerfile).toMatch(/^USER\s+(?!root)/m);
  });
});

describe('AC26 — a deploy is never a required check', () => {
  it('leaves the W0-T06 gates untouched', () => {
    const ci = parseYaml(readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8')) as Workflow;
    expect(Object.keys(ci.jobs ?? {}).sort()).toEqual(
      [
        'build',
        'database',
        'lint',
        'typecheck',
        'unit',
        'workflows',
        // W0-T12 added four; none of them is a deploy, which is what this criterion guards.
        'spec-present',
        'intervention-logged',
        'author-identity',
        'agents-drift',
        // W12-T15 added one more, and it is neither a deploy nor a gate: `perf` measures the
        // storefront and writes its scores into the run recap. It must never be a required check
        // — see `ci-workflow.test.ts`, which keeps gates and reporters in separate lists.
        'perf',
      ].sort(),
    );
  });

  // The criterion this describes, asserted directly rather than only through the list above: a
  // list has to be edited whenever a legitimate job is added, and each edit is a chance to wave
  // through the very thing it was guarding against.
  it('has no deploy-shaped job in ci.yml at all', () => {
    const ci = parseYaml(readFileSync(join(WORKFLOWS, 'ci.yml'), 'utf8')) as Workflow;
    for (const [name, job] of Object.entries(ci.jobs ?? {})) {
      expect(name, `"${name}" is named like a deploy`).not.toMatch(/deploy|release|publish/i);
      const runs = (job.steps ?? [])
        .map((step) => `${step.uses ?? ''} ${step.run ?? ''}`)
        .join('\n');
      expect(runs, `"${name}" runs something that deploys`).not.toMatch(
        /wrangler|flyctl|fly deploy|neonctl/i,
      );
      expect(job.environment, `"${name}" targets a deployment environment`).toBeUndefined();
    }
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Activation — AC28, AC29 (W0-T24)
 * ------------------------------------------------------------------------------------------- */

/** The target a workflow's preflight guards, read from the `check.ts` invocation itself. */
function guardTarget(file: string): string | undefined {
  return /scripts\/deploy\/check\.ts\s+(\w+)/.exec(script(jobs(file)['preflight'] ?? {}))?.[1];
}

/** The names in `REQUIRED[target]`, read from the guard's own source. */
function required(target: string): string[] {
  const source = readFileSync(join(root, 'scripts/deploy/config.ts'), 'utf8');
  const block = new RegExp(`${target}:\\s*\\[([\\s\\S]*?)\\]`).exec(source);
  expect(block, `REQUIRED has no ${target} entry`).not.toBeNull();
  return [...(block?.[1] ?? '').matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1] as string);
}

/**
 * The defect this exists for, and it is not hypothetical: `PREVIEW_DATABASE_URL` was added to
 * `REQUIRED` and never added to the preflight step's `env:`. The guard read `undefined`, reported
 * it missing, and every preview deploy and every teardown skipped — permanently, and regardless of
 * what a human set in GitHub.
 *
 * `tests/env-example.test.ts` could not catch it. That suite unions `secrets.*` across the whole
 * workflow directory, so a single read anywhere satisfied it: it proves a secret is consumed
 * somewhere, not that the guard deciding on it is handed it.
 */
describe('AC28 — the guard is handed every secret it checks for', () => {
  for (const file of DEPLOY_WORKFLOWS) {
    it(`${file}'s preflight passes all of REQUIRED into the guard step`, () => {
      const target = guardTarget(file);
      expect(target, `${file}: cannot tell which target its preflight guards`).toBeDefined();

      const guard = steps(jobs(file)['preflight'] ?? {}).find((step) =>
        (step.run ?? '').includes('check.ts'),
      );
      expect(guard, `${file} has no guard step`).toBeDefined();

      const passed = Object.keys(guard?.env ?? {});
      for (const name of required(target as string)) {
        expect(passed, `${file}: the guard checks ${name} but is never given it`).toContain(name);
      }
    });
  }
});

/**
 * A CLI that was never installed fails with `command not found` — and both preview workflows end
 * their `neonctl` calls with `|| echo …` or `|| true`, which turns that into a green step. The
 * deploy would report success having created no database branch; the teardown would report success
 * having deleted nothing, and leak it.
 */
describe('AC29 — every CLI a workflow runs is installed first', () => {
  /** On the runner already, or shipped by a step every job here has. */
  const PROVIDED = new Set(['git', 'echo', 'node', 'npm', 'npx', 'pnpm', 'docker', 'curl', 'jq']);

  /** Shell grammar, not commands. `sha=…` is an assignment; `fi` closes an `if`. */
  const SHELL = new Set([
    'if',
    'then',
    'elif',
    'else',
    'fi',
    'for',
    'while',
    'do',
    'done',
    'case',
    'esac',
    'break',
    'continue',
    'exit',
    'set',
    'cd',
    'export',
    'local',
    'return',
    'read',
    'shift',
    'trap',
    'true',
    'false',
  ]);

  for (const file of DEPLOY_WORKFLOWS) {
    it(`${file} sets up every command it invokes`, () => {
      for (const [name, job] of Object.entries(jobs(file))) {
        const commands = new Set(
          steps(job)
            .flatMap((step) => (step.run ?? '').split('\n'))
            .map((line) => line.replace(/(^|\s)#.*$/, '').trim())
            // `NAME=value cmd` and a bare assignment both start with a word and an `=`.
            .filter((line) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
            .map((line) => /^([a-z][a-z0-9-]*)\b/.exec(line)?.[1])
            .filter((command): command is string => command !== undefined)
            .filter((command) => !PROVIDED.has(command) && !SHELL.has(command)),
        );

        const setup = script(job);
        for (const command of commands) {
          expect(setup, `${file}:${name} runs "${command}" without installing it`).toMatch(
            new RegExp(
              `(setup-${command}|install.*${command}|${command}.*action|add -g.*${command})`,
              'i',
            ),
          );
        }
      }
    });
  }
});

/**
 * `DATABASE_URL` is `z.url()` with no default in `apps/api/src/config.ts`, so the API exits on
 * boot without it. All three deploy workflows set it as a *workflow* variable for the migration
 * command and never on the Fly app itself — the migration would run, the deploy would report
 * success, and the container would crash-loop on a variable nothing had given it.
 */
describe('AC30 — a deployed app is given the variables it requires', () => {
  /** Every variable `EnvSchema` demands and provides no default for. */
  function requiredByTheApi(): string[] {
    const source = readFileSync(join(root, 'apps/api/src/config.ts'), 'utf8');
    const block = /const EnvSchema = z\.object\(\{([\s\S]*?)\n\}\);/.exec(source);
    expect(block, 'EnvSchema is no longer a z.object literal').not.toBeNull();
    return [...(block?.[1] ?? '').matchAll(/^\s{2}([A-Z][A-Z0-9_]*):\s*(.+?),\s*$/gm)]
      .filter((declaration) => !(declaration[2] ?? '').includes('.default('))
      .map((declaration) => declaration[1] as string);
  }

  for (const file of [PREVIEW, STAGING, RELEASE]) {
    it(`${file} sets them on the app, not only on the migration step`, () => {
      const deploy = deployJobs(file)
        .map(([, job]) => job)
        .filter((job) => /flyctl deploy/.test(script(job)));
      expect(deploy.length, `${file} has no job that deploys to Fly`).toBeGreaterThan(0);

      for (const job of deploy) {
        const setSecrets = steps(job)
          .filter((step) => /flyctl secrets set/.test(step.run ?? ''))
          .map((step) => [step.run ?? '', JSON.stringify(step.env ?? {})].join('\n'))
          .join('\n');

        for (const name of requiredByTheApi()) {
          expect(setSecrets, `${file} never sets ${name} on the Fly app`).toMatch(
            new RegExp(`\\b${name}\\b`),
          );
        }
      }
    });
  }
});

/**
 * Three separate failures on this task were the same shape: a real error ending in a blanket
 * fallback, so the step went green having done nothing.
 *
 *   neonctl branches create … || echo "branch already exists"   # command not found
 *   neonctl branches delete … || true                           # leaked the branch
 *   flyctl apps create … || true                                # unauthorized; app never created
 *
 * The last one reported success and the *next* step failed with "app not found", which is worse
 * than a crash: the log names a consequence and hides the cause.
 *
 * Teardown is the documented exception — a destroy that fails because the resource is already gone
 * must not abort the destroys that follow it — and it is exempted by file, in one place, rather
 * than by scattering opt-outs.
 */
describe('AC31 — a deploy step never swallows the error it just caused', () => {
  for (const file of [PREVIEW, STAGING, RELEASE]) {
    it(`${file} tolerates named outcomes, not every outcome`, () => {
      for (const [name, job] of Object.entries(jobs(file))) {
        for (const step of steps(job)) {
          const run = (step.run ?? '')
            .split('\n')
            .map((line) => line.replace(/(^|\s)#.*$/, ''))
            .join('\n');
          expect(
            run,
            `${file}:${name} "${step.name ?? ''}" ends a command in \`|| true\``,
          ).not.toMatch(/\|\|\s*true\b/);
          expect(
            run,
            `${file}:${name} "${step.name ?? ''}" hides a failure behind \`|| echo\``,
          ).not.toMatch(/\|\|\s*echo\b/);
        }
      }
    });
  }

  it('leaves the teardown its deliberate fallbacks, and says why', () => {
    expect(text(TEARDOWN)).toMatch(/\|\|\s*true/);
    expect(text(TEARDOWN), 'the exception is undocumented').toMatch(/deliberate/i);
  });
});

/**
 * A preview branch whose migration fails is poisoned: Prisma records the failure in
 * `_prisma_migrations` and refuses every later run with P3009, while the workflow happily reuses
 * the branch. No re-run can recover, and the PR shows P3009 forever — a tombstone, never the real
 * error.
 *
 * A preview database is disposable and branched from sanitised data, so recreating it is safe in a
 * way it would not be on staging or production. Retrying on a fresh branch also surfaces the
 * *actual* migration failure instead of the P3009 masking it.
 */
describe('AC32 — a failed preview migration is recoverable without a human', () => {
  function migrateStep(): Step {
    const job = jobs(PREVIEW)['deploy'] ?? {};
    const step = steps(job).find((candidate) => /db:migrate:deploy/.test(candidate.run ?? ''));
    expect(step, 'deploy-preview.yml has no migrate step').toBeDefined();
    return step as Step;
  }

  it('recreates the branch and retries when the migration fails', () => {
    const run = migrateStep().run ?? '';
    expect(run, 'the migrate step cannot recover — one command, no retry').toMatch(
      /branches delete|branches create/,
    );
    expect(run, 'nothing re-runs the migration after recreating the branch').toMatch(
      /db:migrate:deploy[\s\S]*db:migrate:deploy/,
    );
  });

  it('gives up after one attempt rather than looping', () => {
    const run = migrateStep().run ?? '';
    const attempts = [...run.matchAll(/db:migrate:deploy/g)].length;
    expect(attempts, 'more than one retry — a broken migration should fail, not spin').toBe(2);
  });

  it('never recreates a database it did not branch itself', () => {
    // The recovery is scoped to the per-PR branch name. Anything that could name the parent, or a
    // branch this workflow did not create, is a data-loss bug rather than a retry.
    const run = migrateStep().run ?? '';
    expect(run, 'the recovery could target the sanitised parent').not.toMatch(
      /branches delete\s+"?\$?\{?PARENT/,
    );
    expect(run).toMatch(/\$DB_BRANCH|\$\{DB_BRANCH\}/);
  });
});

/**
 * The self-heal in AC32 can change the database URL midway through the job. Staging the
 * pre-migration URL onto the Fly app would then point the deployed API at a branch that was just
 * deleted — a container talking to nothing, after a deploy that reported success.
 */
describe('AC33 — the app is pointed at the database the migration actually used', () => {
  it('takes DATABASE_URL from the migrate step, not the branch-creation step', () => {
    const deploy = jobs(PREVIEW)['deploy'] ?? {};
    const secret = steps(deploy).find((step) => /flyctl secrets set/.test(step.run ?? ''));
    expect(secret, 'no step sets DATABASE_URL on the preview app').toBeDefined();
    expect(
      secret?.env?.['DATABASE_URL'],
      'the app is given the pre-migration URL, which the retry may have invalidated',
    ).toMatch(/steps\.migrate\.outputs/);
  });

  it('sets the secret after the migration, so the value cannot be stale', () => {
    const names = steps(jobs(PREVIEW)['deploy'] ?? {}).map((step) => step.run ?? '');
    const migrated = names.findIndex((run) => /db:migrate:deploy/.test(run));
    const staged = names.findIndex((run) => /flyctl secrets set/.test(run));
    expect(migrated, 'no migrate step').toBeGreaterThan(-1);
    expect(staged, 'no secrets step').toBeGreaterThan(-1);
    expect(
      staged,
      'the app is configured before the migration that may replace the branch',
    ).toBeGreaterThan(migrated);
  });
});

/**
 * Two ways to get wrangler into a pnpm monorepo, and both were wrong:
 *
 *   cloudflare/wrangler-action  → bootstraps with `pnpm add wrangler@…` at the workspace root,
 *                                 which pnpm refuses without `-w` (ERR_PNPM_ADDING_TO_ROOT).
 *   a root devDependency        → drags esbuild 0.17 into a workspace whose vite 8 requires
 *                                 ^0.27, and the API image build re-resolves and dies on
 *                                 ERR_PNPM_PEER_DEP_ISSUES. A tool the *web* deploy needs has no
 *                                 business in the API's dependency graph.
 *
 * So wrangler is invoked with an exact version and installed by neither. This asserts the version
 * stays pinned — an unpinned `npx wrangler` silently follows latest, which is the supply-chain
 * property AC23 protects for actions.
 */
describe('AC34 — wrangler is pinned, and is not a dependency of this workspace', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it('is absent from the root manifest, so it cannot reach the API image', () => {
    expect(
      manifest.devDependencies?.['wrangler'],
      'wrangler is a root devDependency again',
    ).toBeUndefined();
    expect(manifest.dependencies?.['wrangler']).toBeUndefined();
  });

  for (const file of [PREVIEW, STAGING]) {
    it(`${file} pins the wrangler it runs`, () => {
      const invocations = Object.values(jobs(file))
        .flatMap((job) => steps(job))
        .filter((step) => /wrangler/.test((step.run ?? '') + (step.uses ?? '')));
      expect(invocations.length, `${file} never deploys to Pages`).toBeGreaterThan(0);

      for (const step of invocations) {
        expect(step.run ?? '', `${file}: wrangler is invoked without an exact version`).toMatch(
          /wrangler@\d+\.\d+\.\d+/,
        );
      }
    });
  }
});

/**
 * The comment step used to build `https://<branch>.marketplace-web.pages.dev` from the project
 * name. `*.pages.dev` subdomains are globally unique, so a project called `marketplace-web` is
 * served from `marketplace-web-ane.pages.dev` when the plain name is taken — and every reviewer
 * got a dead link. A URL a reviewer is asked to click must come from the tool that created it.
 */
describe('AC35 — the preview URL is read back, never constructed', () => {
  const comment = steps(jobs(PREVIEW)['deploy'] ?? {}).find((step) =>
    /createComment/.test(String(step.with?.['script'] ?? '')),
  );

  it('comments a URL that came out of the deploy step', () => {
    expect(comment, 'nothing comments the preview URLs').toBeDefined();
    expect(
      JSON.stringify(comment?.env ?? {}),
      'the web URL is not taken from the Pages deploy step',
    ).toMatch(/steps\.pages\.outputs\.url/);
  });

  it('hardcodes no pages.dev hostname anywhere in the workflow', () => {
    expect(code(PREVIEW), 'a pages.dev hostname is spelled out in the workflow').not.toMatch(
      /[a-z0-9-]+\.pages\.dev/,
    );
  });

  it('fails rather than commenting a guess when wrangler prints no URL', () => {
    const deploy = steps(jobs(PREVIEW)['deploy'] ?? {}).find((step) =>
      /wrangler/.test(step.run ?? ''),
    );
    expect(deploy?.run ?? '', 'an empty URL is commented instead of failing').toMatch(/exit 1/);
  });
});

/**
 * `W1-T01`. The image lists workspace manifests by hand and builds workspace packages by hand.
 * Both lists are easy to forget when a package is added, and the failure is invisible until a
 * container boots: `@marketplace/contracts` shipped without its `dist/` resolves to a package with
 * no entry point, the process exits, and Fly reports only "timeout reached waiting for health
 * checks". That is what happened on PR #164.
 */
describe('the image knows about every workspace package', () => {
  const dockerfile = readFileSync(join(root, 'infra/docker/api.Dockerfile'), 'utf8');

  const members = ['apps', 'packages'].flatMap((group) =>
    readdirSync(join(root, group), { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(root, group, entry.name, 'package.json')),
      )
      .map((entry) => `${group}/${entry.name}`),
  );

  it('copies every member manifest into the install layer', () => {
    expect(members.length).toBeGreaterThan(1);
    const missing = members.filter(
      (member) => !dockerfile.includes(`COPY ${member}/package.json ${member}/`),
    );
    expect(missing, 'these workspace members are not COPYed into the image').toEqual([]);
  });

  it('builds every workspace package the API needs at run time', () => {
    // A *runtime* dependency must have been built before the prune. A devDependency need not:
    // @marketplace/config is build-time only and is dropped by `pnpm deploy --prod`.
    const api = JSON.parse(readFileSync(join(root, 'apps/api/package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const workspaceRuntimeDeps = Object.keys(api.dependencies ?? {}).filter((name) =>
      name.startsWith('@marketplace/'),
    );

    const prune = dockerfile.indexOf('deploy --legacy');
    for (const name of workspaceRuntimeDeps) {
      const built = dockerfile.indexOf(`pnpm --filter ${name} build`);
      expect(built, `${name} is a runtime dependency the image never builds`).toBeGreaterThan(-1);
      expect(
        built,
        `${name} is built after the prune, so its dist never reaches the image`,
      ).toBeLessThan(prune);
    }
  });
});

/**
 * `W12-T06` — the component workbench is deployed like everything else here: same vendor, same
 * credentials, same rule about reading the URL back. ADR-012 §6 calls it "a new Pages *project*,
 * not a fifth service", and these assertions are what keep that sentence true.
 */
describe('AC35 — the workbench is deployed beside the app, not instead of it', () => {
  it('builds the static workbench and deploys it to its own project', () => {
    const preview = code(PREVIEW);
    expect(preview, 'the workbench is never built').toContain(
      'pnpm --filter @marketplace/ui build:storybook',
    );
    expect(preview).toContain('pages deploy packages/ui/storybook-static');
    expect(preview, 'the workbench would overwrite the web app').toContain(
      '--project-name marketplace-ui',
    );
    // Still there: this is an addition, not a replacement.
    expect(preview).toContain('--project-name marketplace-web');
  });

  it('creates the Pages project if it does not exist, without a prompt', () => {
    // `pages deploy` against an unknown project prompts, and CI has no TTY to answer — the first
    // run would hang or fail on a blank error rather than saying what is wrong.
    expect(code(PREVIEW)).toContain('pages project create marketplace-ui');
  });

  it('reads the workbench URL back from wrangler rather than constructing it', () => {
    // The same trap as AC34: `*.pages.dev` subdomains are globally unique, so `marketplace-ui` may
    // be served from `marketplace-ui-x7q.pages.dev`, and a constructed hostname is a dead link.
    const step = steps(jobs(PREVIEW)['deploy'] ?? {}).find((s) => s.id === 'workbench');
    expect(step, 'no workbench deploy step').toBeDefined();
    expect(step?.run ?? '').toContain('pages.dev');
    expect(step?.run ?? '', 'a guessed URL is worse than none').toContain(
      'refusing to comment a guessed one',
    );
  });

  it('puts the URL in the comment the reviewer already gets', () => {
    const comment = steps(jobs(PREVIEW)['deploy'] ?? {}).find((s) =>
      (s.name ?? '').startsWith('Comment'),
    );
    expect(comment?.env?.['WORKBENCH_URL']).toBe('${{ steps.workbench.outputs.url }}');
    expect(String(comment?.with?.['script'] ?? '')).toContain('Components:');
  });

  it('deploys on merge as well as per pull request', () => {
    // Otherwise the workbench a reviewer is sent to is whichever branch deployed it last.
    const staging = code(STAGING);
    expect(staging).toContain('build:storybook');
    expect(staging).toContain('--project-name marketplace-ui');
  });

  it('deletes its preview deployments when the pull request closes', () => {
    const teardown = code(TEARDOWN);
    expect(teardown, 'the teardown never mentions the workbench project').toContain(
      'pages/projects/marketplace-ui/deployments',
    );
    expect(teardown, 'the branch to delete is never passed in').toContain(
      'PAGES_BRANCH: ${{ needs.preflight.outputs.pages-branch }}',
    );
  });

  it('adds no new secret, because it is not a new service', () => {
    // The M0 four-services rule (Fly, Neon, Cloudflare, Sentry). A second Pages project is a
    // project; a new *vendor* secret here would mean somebody had added one.
    //
    // `PREVIEW_BETTER_AUTH_SECRET` is not a vendor credential — it is a signing key for a service
    // we already run, held by us and used by nobody outside the Fly app (`ADR-005`: better-auth is
    // a library, not a fifth service; that is most of why it was chosen). Listed rather than
    // pattern-matched away, so a real fifth vendor still fails here.
    const names = [...code(PREVIEW).matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect([...new Set(names)].sort()).toEqual([
      'CLOUDFLARE_ACCOUNT_ID',
      'CLOUDFLARE_API_TOKEN',
      'FLY_API_TOKEN',
      'NEON_API_KEY',
      'NEON_PROJECT_ID',
      'PREVIEW_BETTER_AUTH_SECRET',
    ]);
  });
});

/**
 * `W12-T16` AC13–AC16 — the nightly visual run and its accept path.
 *
 * These assertions live here, beside the deploy ones, for the reason `W12-T06` §5 gave when it put
 * the workbench deploy in this file: `.github/**` is `agent-devops`' folder, and the next agent
 * editing the pipeline should find every assertion about it in one place rather than discovering
 * that `packages/ui` also has opinions about a workflow.
 *
 * AC16 is the load-bearing one. `ci.yml` is `permissions: contents: read` on purpose — a workflow
 * with a write token cannot safely run on a pull request from a fork — and the easy way to build
 * baseline regeneration would have been a job inside it. That is why regeneration is a separate
 * file, and why this asserts the pull-request workflow's token did not quietly widen.
 */
describe('W12-T16 — nightly visual regression', () => {
  const NIGHTLY = 'nightly-visual.yml';
  const BASELINES = 'visual-baselines.yml';
  const IMAGE = 'mcr.microsoft.com/playwright:v1.63.0-noble';
  const DIGEST = 'sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27';

  it('AC14 — runs on a schedule, and can also be run on demand', () => {
    const on = workflow(NIGHTLY).on as { schedule?: unknown[]; workflow_dispatch?: unknown };

    expect(on.schedule, 'a nightly with no schedule is a workflow nobody runs').toBeDefined();
    expect(
      on.workflow_dispatch,
      'no way to test a change to it without waiting a day',
    ).toBeDefined();
  });

  it('AC14 — renders inside the digest-pinned container, not on the bare runner', () => {
    const job = jobs(NIGHTLY)['visual'] as Job & { container?: { image?: string } };

    // A tag alone can be rebuilt with different fonts, which silently invalidates every committed
    // baseline and reads as a screenful of regressions on an unchanged tree.
    expect(job?.container?.image).toContain(IMAGE);
    expect(job?.container?.image, 'the image is not pinned by digest').toContain(DIGEST);
  });

  it('AC14 — the image the container runs is the image the fingerprint claims', () => {
    // Two places name the digest — this workflow and `visual/fingerprint.json` — and a drift
    // between them is the failure mode the fingerprint exists to catch, so it must not be possible
    // to update one and not the other without a red test.
    const fingerprint = JSON.parse(
      readFileSync(join(root, 'packages', 'ui', 'visual', 'fingerprint.json'), 'utf8'),
    ) as { image: string; imageDigest: string };

    expect(fingerprint.image).toBe(IMAGE);
    expect(fingerprint.imageDigest).toBe(DIGEST);
    expect(code(NIGHTLY)).toContain(`VISUAL_IMAGE_DIGEST: ${DIGEST}`);
    expect(code(BASELINES)).toContain(`VISUAL_IMAGE_DIGEST: ${DIGEST}`);
  });

  it('AC14 — the rendering job gets no write token; only the reporting job does', () => {
    const all = jobs(NIGHTLY);

    expect(all['visual']?.permissions ?? {}).not.toHaveProperty('issues');
    expect(all['report']?.permissions).toMatchObject({ contents: 'read', issues: 'write' });
  });

  it('AC13 — the storefront is a real build behind a preview server, with mocks on', () => {
    const code_ = code(NIGHTLY);

    // A dev server is a different application: no minification, no stripping, and `stripMocks`
    // never runs. The a11y pass has to see what a visitor sees.
    expect(code_).toContain('vite preview');
    expect(code_, 'without mocks every page renders its degraded shape').toContain(
      "VITE_ENABLE_MOCKS: 'true'",
    );
    expect(code_, 'the 500 page has no URL without this').toContain(
      "VITE_ENABLE_FAULT_ROUTES: 'true'",
    );
    expect(code_).toContain('WEB_BASE_URL');
  });

  it('AC13 — workspace packages are built through turbo, not pnpm --filter', () => {
    // MEM-2026-09-11-19: `pnpm --filter <app> build` does not build the packages the app imports,
    // and the failure is invisible until a clean checkout — so it lands in CI, never in review.
    const build = code(NIGHTLY).match(/pnpm [^\n]*build[^\n]*/g) ?? [];
    // `build:storybook` is deliberately exempt and the exemption is narrow: turbo defines no such
    // task, the package it belongs to has already been built by the `turbo run build` above, and
    // `deploy-preview.yml` has invoked it this way since `W12-T06`. The rule is about the `build`
    // task, which is the one with `dependsOn: ["^build"]` behind it.
    const viaFilter = build.filter((line) => /pnpm --filter \S+ build(?![:\w])/.test(line));

    expect(viaFilter, `built without turbo: ${viaFilter.join(', ')}`).toEqual([]);
  });

  it('AC9 — the three images are uploaded when, and only when, something failed', () => {
    const upload = steps(jobs(NIGHTLY)['visual'] as Job).find((step) =>
      step.uses?.startsWith('actions/upload-artifact'),
    );

    expect(upload?.if, 'the diffs are uploaded unconditionally, or not at all').toBe('failure()');
    expect(String(upload?.with?.['path'])).toContain('visual-results');
  });

  it('AC15 — regeneration is on demand only, and opens a pull request', () => {
    const on = workflow(BASELINES).on as { workflow_dispatch?: unknown; schedule?: unknown };

    expect(on.workflow_dispatch).toBeDefined();
    expect(on.schedule, 'baselines must never regenerate on a timer').toBeUndefined();

    const code_ = code(BASELINES);
    expect(code_).toContain('create-pull-request');
    expect(code_, 'a baseline change must be looked at, not pushed').toContain('base: main');
    expect(code_).toContain('--update-snapshots');
  });

  it('AC15 — regeneration touches the baselines and nothing else', () => {
    const paths = String(
      (steps(jobs(BASELINES)['regenerate'] as Job).find((step) =>
        step.uses?.startsWith('peter-evans/create-pull-request'),
      )?.with?.['add-paths'] ?? '') as string,
    );

    // A regeneration run that can commit source is a run that can launder a code change through a
    // "just the baselines" pull request.
    expect(paths).toContain('packages/ui/visual/baselines');
    expect(paths).not.toMatch(/packages\/ui\/src|apps\/web/);
  });

  it('AC16 — ci.yml stays read-only, which is why regeneration is a separate file', () => {
    const ci = workflow('ci.yml') as { permissions?: Record<string, string> };

    expect(ci.permissions).toEqual({ contents: 'read' });
    expect(code('ci.yml'), 'the visual run leaked into the per-PR gate').not.toContain(
      'playwright test',
    );
  });

  it('adds no new secret, because it is not a new service', () => {
    // Same rule as the workbench deploy above: `GITHUB_TOKEN` is issued by Actions, not configured.
    const names = [
      ...code(NIGHTLY).matchAll(/secrets\.([A-Z0-9_]+)/g),
      ...code(BASELINES).matchAll(/secrets\.([A-Z0-9_]+)/g),
    ].map((m) => m[1]);

    expect([...new Set(names)].sort()).toEqual(['GITHUB_TOKEN']);
  });
});

/* ------------------------------------------------------------------------------------------- *
 * One origin — W0-T28 AC8..AC12
 *
 * The browser must reach the API at the *web* origin, or the session cookie is never sent. These
 * assertions are about the three ways that can quietly stop being true: the SPA being pointed at
 * the API's own host again, `BETTER_AUTH_URL` drifting back to a `fly.dev` URL, and the deploy
 * being reordered so the web URL is not known when the API's secrets are set.
 * ------------------------------------------------------------------------------------------- */

/** The two that serve `*.pages.dev` from a `*.fly.dev` API. Production waits for `OPS-16`. */
const ONE_ORIGIN = [PREVIEW, STAGING] as const;

describe('W0-T28 AC8 — the SPA is not pointed at the API host', () => {
  for (const file of ONE_ORIGIN) {
    it(`${file} builds the web app without VITE_API_URL`, () => {
      // `baseUrl()` returns `/` when this is unset, which is the whole point: same-origin requests,
      // no CORS, and a `SameSite=Lax` cookie that is actually sent.
      expect(code(file)).not.toMatch(/VITE_API_URL/);
    });
  }
});

describe('W0-T28 AC9 — better-auth is told the web origin, not its own', () => {
  for (const file of ONE_ORIGIN) {
    it(`${file} takes BETTER_AUTH_URL from the web deploy's output`, () => {
      const assignments = [...code(file).matchAll(/BETTER_AUTH_URL[:=]\s*"?([^"\n]+)"?/g)].map(
        (match) => (match[1] ?? '').trim(),
      );

      expect(assignments.length, `${file} never sets BETTER_AUTH_URL`).toBeGreaterThan(0);
      for (const value of assignments) {
        expect(value, `${file} points BETTER_AUTH_URL at the API`).not.toMatch(/fly\.dev/);
      }
      // It is the URL wrangler printed, not one this workflow built: `W0-T24` learned that a
      // guessed `*.pages.dev` hostname gives every reviewer a dead link, and here it would also
      // give better-auth a trusted-origin list that does not contain the site.
      expect(code(file)).toMatch(/BETTER_AUTH_URL[:=][^\n]*(steps\.pages\.outputs\.url|WEB_URL)/);
    });
  }
});

describe('W0-T28 AC10 — the web URL exists before the API is told about it', () => {
  for (const file of ONE_ORIGIN) {
    it(`${file} deploys the web app, then sets the secrets, then deploys the API`, () => {
      const body = code(file);
      const pages = body.indexOf('pages deploy apps/web/dist');
      const secrets = body.indexOf('flyctl secrets set');
      const api = body.indexOf('flyctl deploy');

      expect(pages, `${file} never deploys the web app`).toBeGreaterThan(-1);
      expect(secrets, `${file} never sets the API's secrets`).toBeGreaterThan(-1);
      expect(api, `${file} never deploys the API`).toBeGreaterThan(-1);

      expect(pages, `${file} sets BETTER_AUTH_URL before it can know it`).toBeLessThan(secrets);
      expect(secrets, `${file} deploys the API before giving it its secrets`).toBeLessThan(api);
    });
  }
});

describe('W0-T28 AC11 — the deploy proves the seam, rather than assuming it', () => {
  for (const file of ONE_ORIGIN) {
    it(`${file} calls the API through the web origin after deploying`, () => {
      // A worker that failed to deploy is silent: `/api/*` falls through to `index.html`, and the
      // first symptom is a JSON parse error in a browser nobody has opened. One request through the
      // edge proves Pages served the worker, the worker resolved the origin, and Fly answered.
      //
      // Asserted per *step* rather than over the file: the command wraps across lines, and a regex
      // that needs them on one line breaks the day somebody reformats it — which is a gate failing
      // for a reason that has nothing to do with what it guards.
      const checks = Object.values(jobs(file))
        .flatMap((job) => steps(job))
        .filter((step) => {
          const run = step.run ?? '';
          return /\bcurl\b/.test(run) && /\/api\/(health|auth\/get-session)/.test(run);
        });

      expect(checks.length, `${file} never calls the API after deploying`).toBeGreaterThan(0);
      for (const check of checks) {
        // Through the *web* origin. Curling the Fly host would prove the API is up and nothing
        // about the seam this ticket exists to build.
        // Through the web origin, at a path the API actually serves. `/health` is at the API's
        // **root** and the edge forwards only `/api/*`, so `/api/health` is a 404 — measured, and
        // the reason the probe is `/api/auth/get-session`, which answers `200` with `null`.
        expect(check.run ?? '', `${file} checks the API's own host, not the web origin`).toMatch(
          /\$\{?WEB_URL\}?\/api\//,
        );
        expect(JSON.stringify(check.env ?? {})).toMatch(/steps\.pages\.outputs\.url/);
      }
    });
  }
});

describe('W0-T28 AC12 — production is deliberately untouched, and here is why', () => {
  it('deploys no web app at all, so there is no origin to unify yet', () => {
    // Checked rather than assumed, and the check corrected the assumption: the release promotes the
    // API image and nothing else. There is no production storefront, no domain (`OPS-16`), and
    // therefore nothing this ticket could verify a change against. When one arrives it inherits
    // either this worker with a different origin, or a Worker route on the real domain.
    expect(code(RELEASE)).not.toMatch(/pages deploy/);
  });

  it('is the only deploy workflow that does not, so the exemption cannot spread silently', () => {
    for (const file of ONE_ORIGIN) {
      expect(code(file), `${file} no longer deploys a web app`).toMatch(/pages deploy/);
    }
  });
});

/**
 * A comment inside a folded scalar is not a comment.
 *
 * `run: >` folds every line into one string, and `#` has no special meaning there — so a note
 * written inside a folded `flyctl secrets set` is handed to `flyctl` as arguments. It looks right
 * in the diff, parses as valid YAML, and breaks the deploy. Caught once, on `W2-T10`, by a rebase
 * rather than by a test; this is the test.
 */
describe('a folded run: block carries no prose', () => {
  for (const file of DEPLOY_WORKFLOWS) {
    it(`${file} never folds a comment into a command`, () => {
      for (const [name, job] of Object.entries(jobs(file))) {
        for (const step of steps(job)) {
          const run = step.run ?? '';
          // A literal block (`run: |`) keeps its newlines, so `#` there really is a shell comment.
          // A folded one arrives as a single line — which is exactly when a `#` is a problem.
          if (run.includes('\n')) continue;
          expect(
            run,
            `${file}:${name} "${step.name ?? ''}" folds a comment into the command`,
          ).not.toMatch(/\s#\s/);
        }
      }
    });
  }
});
