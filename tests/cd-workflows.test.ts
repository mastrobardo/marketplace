import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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
      ['build', 'database', 'lint', 'typecheck', 'unit', 'workflows'].sort(),
    );
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
