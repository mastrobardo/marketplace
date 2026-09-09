import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const root = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOWS = join(root, '.github', 'workflows');
const CI = join(WORKFLOWS, 'ci.yml');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  if?: string;
  'continue-on-error'?: boolean;
}

interface Job {
  name?: string;
  'runs-on'?: string;
  needs?: string | string[];
  'timeout-minutes'?: number;
  permissions?: Record<string, string>;
  services?: Record<string, { image?: string; options?: string; ports?: string[] }>;
  steps?: Step[];
  if?: string;
  'continue-on-error'?: boolean;
}

interface Workflow {
  name?: string;
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean | string };
  jobs?: Record<string, Job>;
}

function workflow(): Workflow {
  expect(existsSync(CI), '.github/workflows/ci.yml does not exist').toBe(true);
  return parseYaml(readFileSync(CI, 'utf8')) as Workflow;
}

function jobs(): Record<string, Job> {
  return workflow().jobs ?? {};
}

function steps(job: Job): Step[] {
  return job.steps ?? [];
}

function allSteps(): Array<{ job: string; step: Step }> {
  return Object.entries(jobs()).flatMap(([name, job]) =>
    steps(job).map((step) => ({ job: name, step })),
  );
}

/** Spec §4 — these names are the contract W0-T13 requires in branch protection. */
const GATES = ['build', 'typecheck', 'lint', 'unit', 'database', 'workflows'] as const;

const raw = (): string => readFileSync(CI, 'utf8');

/* ------------------------------------------------------------------------------------------- *
 * Triggers and lifecycle — AC1..AC3
 * ------------------------------------------------------------------------------------------- */

describe('AC1 — the workflow runs on every pull request, and on main, and nothing else', () => {
  it('declares exactly the two triggers', () => {
    expect(Object.keys(workflow().on ?? {}).sort()).toEqual(['pull_request', 'push']);
  });

  it('filters the pull-request trigger by nothing — a stacked PR is still a PR', () => {
    const trigger = (workflow().on ?? {})['pull_request'];
    expect(
      trigger,
      'restricting to base: main leaves a PR stacked on another branch with no checks',
    ).toBeNull();
  });

  it('limits push to main, so a branch push is not checked twice', () => {
    expect((workflow().on ?? {})['push']).toMatchObject({ branches: ['main'] });
  });
});

describe('AC2 — a superseded run is cancelled', () => {
  it('groups per workflow and ref', () => {
    const group = workflow().concurrency?.group ?? '';
    expect(group).toContain('github.workflow');
    expect(group).toContain('github.ref');
  });

  it('cancels in progress', () => {
    expect(workflow().concurrency?.['cancel-in-progress']).toBeDefined();
  });
});

describe('AC3 — a run on main is never cancelled', () => {
  it('makes cancel-in-progress conditional on not being main', () => {
    const cancel = String(workflow().concurrency?.['cancel-in-progress'] ?? '');
    expect(
      cancel,
      'cancel-in-progress is unconditional — a cancelled main build leaves main unverified',
    ).not.toBe('true');
    expect(cancel).toMatch(/github\.ref/);
  });
});

/* ------------------------------------------------------------------------------------------- *
 * The gates — AC4..AC9
 * ------------------------------------------------------------------------------------------- */

describe('AC4 — exactly the six named gates exist', () => {
  it('declares one job per check name and no aggregate job', () => {
    expect(Object.keys(jobs()).sort()).toEqual([...GATES].sort());
  });
});

describe('AC5 — CI runs the same commands an agent runs locally', () => {
  const expected: Record<string, RegExp[]> = {
    build: [/pnpm build/],
    typecheck: [/pnpm typecheck/],
    lint: [/pnpm lint/, /pnpm format:check/],
    unit: [/pnpm test/],
  };

  for (const [job, patterns] of Object.entries(expected)) {
    it(`${job} runs its local script`, () => {
      const script = steps(jobs()[job] ?? {})
        .map((step) => step.run ?? '')
        .join('\n');
      for (const pattern of patterns) {
        expect(script, `${job} does not run ${String(pattern)}`).toMatch(pattern);
      }
    });
  }
});

describe('AC6 — the database gate actually runs the live suite', () => {
  it('applies the migrations and opts into STACK_LIVE', () => {
    const script = steps(jobs()['database'] ?? {})
      .map((step) => [step.run ?? '', JSON.stringify(step.env ?? {})].join('\n'))
      .join('\n');
    expect(script).toMatch(/db:migrate:deploy/);
    expect(script).toMatch(/STACK_LIVE/);
  });
});

describe('AC7 — CI and the local stack run the same Postgres', () => {
  it('brings up the project compose stack rather than a bespoke service container', () => {
    const job = jobs()['database'] ?? {};
    const script = steps(job)
      .map((step) => step.run ?? '')
      .join('\n');

    expect(script, 'the database job does not start the project stack').toMatch(/stack:up/);
    expect(
      job.services,
      'a service container would be a second Postgres definition to keep in step',
    ).toBeUndefined();
  });
});

describe('AC8 — no gate can silently pass', () => {
  it('never sets continue-on-error', () => {
    expect(raw()).not.toMatch(/continue-on-error/);
  });

  it('puts no condition on a gate job', () => {
    for (const [name, job] of Object.entries(jobs())) {
      expect(job.if, `${name} is conditional — it could skip and report success`).toBeUndefined();
    }
  });
});

describe('AC9 — CI lints itself', () => {
  it('runs actionlint over every workflow file', () => {
    const job = jobs()['workflows'] ?? {};
    const text = steps(job)
      .map((step) => `${step.uses ?? ''} ${step.run ?? ''}`)
      .join('\n');
    expect(text).toMatch(/actionlint/i);
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Reproducibility — AC10..AC13
 * ------------------------------------------------------------------------------------------- */

describe('AC10 — one Node version, and .nvmrc is where it lives', () => {
  it('reads it from the file rather than restating it', () => {
    const nvmrc = readFileSync(join(root, '.nvmrc'), 'utf8').trim();
    const setups = allSteps().filter(({ step }) => (step.uses ?? '').includes('setup-node'));

    expect(setups.length, 'no job sets up Node').toBeGreaterThan(0);
    for (const { job, step } of setups) {
      const file = step.with?.['node-version-file'];
      const literal = step.with?.['node-version'];

      if (typeof file === 'string') {
        expect(file, `${job} reads a Node version from ${file}`).toBe('.nvmrc');
      } else {
        // A literal is allowed but must agree with .nvmrc — it is the form that can drift.
        expect(literal, `${job} pins no Node version at all`).toBeDefined();
        expect(literal, `${job} pins ${String(literal)}, .nvmrc says ${nvmrc}`).toBe(nvmrc);
      }
    }
  });
});

describe('AC11 — the pnpm CI uses is the pnpm the repo declares', () => {
  it('satisfies packageManager', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      packageManager?: string;
    };
    const declared = (manifest.packageManager ?? '').split('@')[1] ?? '';
    expect(declared).not.toBe('');

    const pinned = allSteps()
      .filter(({ step }) => (step.uses ?? '').includes('pnpm/action-setup'))
      .map(({ step }) => step.with?.['version'])
      .filter((version): version is string => version !== undefined);

    // Either every setup pins the same major as packageManager, or none pins at all — in which
    // case pnpm/action-setup reads packageManager itself, which is the stronger guarantee.
    for (const version of pinned) {
      expect(String(version).split('.')[0]).toBe(declared.split('.')[0]);
    }
  });
});

describe('AC12 — the lockfile is authoritative', () => {
  it('installs with --frozen-lockfile everywhere', () => {
    const installs = allSteps()
      .map(({ step }) => step.run ?? '')
      .filter((run) => /pnpm\s+install/.test(run));

    expect(installs.length, 'no job installs dependencies').toBeGreaterThan(0);
    for (const install of installs) {
      expect(install, 'an install would silently update the lockfile').toMatch(/--frozen-lockfile/);
    }
  });
});

describe('AC13 — every action is pinned', () => {
  it('never uses a moving ref', () => {
    const uses = allSteps()
      .map(({ step }) => step.uses)
      .filter((value): value is string => typeof value === 'string');

    expect(uses.length).toBeGreaterThan(0);
    for (const reference of uses) {
      // Two legal shapes: `owner/repo@ref` for a repository action, `docker://image:tag` for a
      // container one. Both must name a fixed version; neither may float.
      const ref = reference.startsWith('docker://')
        ? (reference.split(':').pop() ?? '')
        : (reference.split('@')[1] ?? '');
      expect(ref, `${reference} names no version`).not.toBe('');
      expect(ref, `${reference} floats on a moving ref`).not.toMatch(/^(main|master|latest)$/);
    }
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Budget — AC14..AC16
 * ------------------------------------------------------------------------------------------- */

describe('AC14 — no job can hang', () => {
  it('sets a timeout of at most 15 minutes on every job', () => {
    for (const [name, job] of Object.entries(jobs())) {
      const timeout = job['timeout-minutes'];
      expect(timeout, `${name} has no timeout-minutes`).toBeDefined();
      expect(timeout, `${name} may run for ${String(timeout)} minutes`).toBeLessThanOrEqual(15);
    }
  });
});

describe('AC15 — the gates run in parallel', () => {
  it('keeps the longest needs-chain to two jobs', () => {
    const graph = jobs();

    function depth(name: string, seen: Set<string> = new Set()): number {
      expect(seen.has(name), `needs cycle through ${name}`).toBe(false);
      const needs = graph[name]?.needs;
      const parents = needs === undefined ? [] : Array.isArray(needs) ? needs : [needs];
      if (parents.length === 0) return 1;
      return 1 + Math.max(...parents.map((parent) => depth(parent, new Set([...seen, name]))));
    }

    for (const name of Object.keys(graph)) {
      expect(depth(name), `${name} sits at the end of a long chain`).toBeLessThanOrEqual(2);
    }
  });
});

describe('AC16 — dependencies come from a cache when the lockfile is unchanged', () => {
  it('caches the pnpm store, keyed by the lockfile', () => {
    const text = raw();
    expect(text).toMatch(/cache/);
    expect(text, 'the cache key ignores the lockfile, so it would go stale silently').toMatch(
      /pnpm-lock\.yaml/,
    );
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Security — AC17, AC18
 * ------------------------------------------------------------------------------------------- */

describe('AC17 — the token is read-only', () => {
  it('declares permissions at the top level', () => {
    expect(workflow().permissions).toBeDefined();
  });

  it('grants contents: read and nothing else', () => {
    expect(workflow().permissions).toEqual({ contents: 'read' });
  });

  it('never escalates in a job', () => {
    for (const [name, job] of Object.entries(jobs())) {
      for (const [scope, level] of Object.entries(job.permissions ?? {})) {
        expect(level, `${name} asks for ${scope}: ${level}`).not.toBe('write');
      }
    }
  });
});

describe('AC18 — nothing here reads a secret', () => {
  it('references no secrets context', () => {
    expect(raw(), 'a workflow that reads a secret cannot safely run on a fork PR').not.toMatch(
      /secrets\./,
    );
  });
});

/* ------------------------------------------------------------------------------------------- *
 * Documentation — AC19
 * ------------------------------------------------------------------------------------------- */

describe('AC19 — the required check names are written down for W0-T13', () => {
  it('lists every gate in the README', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    for (const gate of GATES) {
      expect(readme, `README does not name the "${gate}" check`).toMatch(new RegExp(`\`${gate}\``));
    }
  });
});

describe('the workflows directory holds only what this task put there', () => {
  it('parses every workflow file', () => {
    expect(existsSync(WORKFLOWS), '.github/workflows does not exist').toBe(true);
    const files = readdirSync(WORKFLOWS).filter((file) => /\.ya?ml$/.test(file));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(() => parseYaml(readFileSync(join(WORKFLOWS, file), 'utf8'))).not.toThrow();
    }
  });
});
