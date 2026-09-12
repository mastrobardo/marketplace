/**
 * `W0-T12` — the four gates `AGENTS.md`, `TODO.md` §5.5 and `IDENTITY.md` already promise.
 *
 * These assert the gates' **decisions**, not that `ci.yml` contains a matching string. A workflow
 * that names a gate and a gate that judges correctly are different claims, and only the second one
 * stops a bad branch. The YAML wiring is asserted separately, at the bottom.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import { parseBranch } from '../scripts/gates/task-id.js';
import { checkSpecPresent } from '../scripts/gates/spec-present.js';
import { checkInterventionLogged } from '../scripts/gates/intervention-logged.js';
import { checkAuthorIdentity, EXPECTED_EMAIL } from '../scripts/gates/author-identity.js';

const root = fileURLToPath(new URL('..', import.meta.url));

/** The spec and run record a branch named `W0-T12-ci-gates` is required to touch. */
const SPEC = 'docs/specs/S0/W0-T12-ci-gates.md';
const RUN = 'docs/specs/S0/W0-T12-ci-gates.run.md';

describe('AC1 — a branch name is parsed into a task ID and a slug', () => {
  it('splits a workstream branch', () => {
    expect(parseBranch('W0-T12-ci-gates')).toEqual({ taskId: 'W0-T12', slug: 'ci-gates' });
  });

  it('accepts the OPS and BD id shapes TODO.md §6 uses', () => {
    expect(parseBranch('OPS-04-environments')?.taskId).toBe('OPS-04');
    expect(parseBranch('BD-07-pricing')?.taskId).toBe('BD-07');
  });

  it('returns null for a branch carrying no task ID', () => {
    expect(parseBranch('main')).toBeNull();
    expect(parseBranch('fix-a-typo')).toBeNull();
  });

  it('does not mistake a task ID appearing mid-branch for a prefix', () => {
    // The gate keys off the *prefix*. A branch called `revert-W0-T12-ci-gates` is not that task.
    expect(parseBranch('revert-W0-T12-ci-gates')).toBeNull();
  });
});

describe('AC2 — spec-present fails a task branch with no spec', () => {
  it('passes when both the spec and the run record are touched', () => {
    const result = checkSpecPresent({ branch: 'W0-T12-ci-gates', changedFiles: [SPEC, RUN] });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
  });

  it('fails when neither is touched', () => {
    const result = checkSpecPresent({
      branch: 'W0-T12-ci-gates',
      changedFiles: ['.github/workflows/ci.yml'],
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('SPEC_MISSING');
  });

  it('fails when the spec is there but the run record is not', () => {
    // The run record is the half that carries the failing-test paste (§5.3). Losing it is the
    // common case, because it is the one written last.
    const result = checkSpecPresent({ branch: 'W0-T12-ci-gates', changedFiles: [SPEC] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('SPEC_UNPAIRED');
    expect(result.message).toContain('run record');
  });

  it('fails when the run record is there but the spec is not', () => {
    const result = checkSpecPresent({ branch: 'W0-T12-ci-gates', changedFiles: [RUN] });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('SPEC_UNPAIRED');
  });

  it("ignores another task's spec", () => {
    const result = checkSpecPresent({
      branch: 'W0-T12-ci-gates',
      changedFiles: ['docs/specs/S0/W0-T24-activate-deploy-pipeline.md', RUN],
    });
    expect(result.ok).toBe(false);
  });

  it('accepts any slice directory, so W1 does not have to change the gate', () => {
    const result = checkSpecPresent({
      branch: 'W1-T01-error-envelope',
      changedFiles: [
        'docs/specs/S1/W1-T01-error-envelope.md',
        'docs/specs/S1/W1-T01-error-envelope.run.md',
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('skips a branch with no task ID rather than inventing a requirement', () => {
    const result = checkSpecPresent({ branch: 'fix-a-typo', changedFiles: ['README.md'] });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('names the files it wanted, so the message is actionable', () => {
    const result = checkSpecPresent({ branch: 'W0-T12-ci-gates', changedFiles: [] });
    expect(result.message).toContain('W0-T12-ci-gates.md');
    expect(result.message).toContain('W0-T12-ci-gates.run.md');
  });
});

describe('AC3 — intervention-logged requires a ledger entry when a label claims one', () => {
  it('skips a PR with no intervention label', () => {
    const result = checkInterventionLogged({
      branch: 'W0-T12-ci-gates',
      labels: ['type:chore', 'slice:S0'],
      changedFiles: [SPEC],
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('fails when a label claims an intervention and no ledger file was added', () => {
    const result = checkInterventionLogged({
      branch: 'W0-T12-ci-gates',
      labels: ['intervention:manual-fix'],
      changedFiles: [SPEC, RUN],
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INTERVENTION_UNLOGGED');
  });

  it('passes when the matching ledger entry is added', () => {
    const result = checkInterventionLogged({
      branch: 'W0-T12-ci-gates',
      labels: ['intervention:manual-fix'],
      changedFiles: [SPEC, 'docs/interventions/2026-09-09-W0-T12-1.md'],
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
  });

  it("rejects a ledger entry filed under a different task's ID", () => {
    const result = checkInterventionLogged({
      branch: 'W0-T12-ci-gates',
      labels: ['intervention:override'],
      changedFiles: ['docs/interventions/2026-09-09-W0-T24-1.md'],
    });
    expect(result.ok).toBe(false);
  });

  it('reports every intervention label, not just the first', () => {
    const result = checkInterventionLogged({
      branch: 'W0-T12-ci-gates',
      labels: ['intervention:rejected', 'intervention:scope-change'],
      changedFiles: [],
    });
    expect(result.message).toContain('intervention:rejected');
    expect(result.message).toContain('intervention:scope-change');
  });

  it('does not count the template or the rollup as a ledger entry', () => {
    // Both live in `docs/interventions/`. Neither records anything that happened.
    const result = checkInterventionLogged({
      branch: 'W0-T12-ci-gates',
      labels: ['intervention:manual-fix'],
      changedFiles: ['docs/interventions/_TEMPLATE.md', 'docs/interventions/ROLLUP.md'],
    });
    expect(result.ok).toBe(false);
  });
});

describe('AC4 — author-identity rejects any commit that is not the personal identity', () => {
  const good = { sha: 'a1b2c3d', authorEmail: EXPECTED_EMAIL, committerEmail: EXPECTED_EMAIL };

  it('passes when every commit is the personal identity', () => {
    expect(checkAuthorIdentity([good, { ...good, sha: 'e4f5a6b' }]).ok).toBe(true);
  });

  it('fails on a work author email', () => {
    const result = checkAuthorIdentity([
      good,
      { sha: 'bad1234', authorEmail: 'davide.arcinotti@iagl.com', committerEmail: EXPECTED_EMAIL },
    ]);
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AUTHOR_IDENTITY');
  });

  it('fails on a work committer email even when the author is correct', () => {
    // `git commit --author=...` sets the author only. The committer is whoever ran the command,
    // which on this machine defaults to the work account (IDENTITY.md, "Known trap").
    const result = checkAuthorIdentity([
      { sha: 'bad5678', authorEmail: EXPECTED_EMAIL, committerEmail: 'davide.arcinotti@iagl.com' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('names the offending sha and email', () => {
    const result = checkAuthorIdentity([
      { sha: 'bad1234', authorEmail: 'work@parserdigital.com', committerEmail: EXPECTED_EMAIL },
    ]);
    expect(result.message).toContain('bad1234');
    expect(result.message).toContain('work@parserdigital.com');
  });

  it('reports every offending commit, not just the first', () => {
    const result = checkAuthorIdentity([
      { sha: 'bad1111', authorEmail: 'work@iagl.com', committerEmail: EXPECTED_EMAIL },
      { sha: 'bad2222', authorEmail: 'other@iagl.com', committerEmail: EXPECTED_EMAIL },
    ]);
    expect(result.message).toContain('bad1111');
    expect(result.message).toContain('bad2222');
  });

  it('passes an empty range rather than failing it', () => {
    // A PR whose commits are all already on the base is odd, not dishonest.
    expect(checkAuthorIdentity([]).ok).toBe(true);
  });

  it('is case-insensitive about the address', () => {
    expect(checkAuthorIdentity([{ ...good, authorEmail: 'Mastrobardo@Gmail.com' }]).ok).toBe(true);
  });
});

describe('AC5 — the ledger and the PR template exist for the gate to point at', () => {
  it('docs/interventions/ has a template matching TODO.md §5.6', () => {
    const template = join(root, 'docs', 'interventions', '_TEMPLATE.md');
    expect(existsSync(template)).toBe(true);
    const body = readFileSync(template, 'utf8');
    for (const field of ['task:', 'pr:', 'agent:', 'verdict:', 'intervened_by:', 'at:']) {
      expect(body).toContain(field);
    }
    expect(body).toContain('## Root cause');
  });

  it('the PR template asks whether a human changed anything', () => {
    const pr = join(root, '.github', 'pull_request_template.md');
    expect(existsSync(pr)).toBe(true);
    expect(readFileSync(pr, 'utf8').toLowerCase()).toContain('did a human change anything');
  });
});

describe('AC6 — ci.yml actually runs the four gates', () => {
  interface Job {
    name?: string;
    steps?: { uses?: string; run?: string; with?: Record<string, unknown> }[];
  }
  const ci = parseYaml(readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')) as {
    jobs?: Record<string, Job>;
  };
  const jobs = ci.jobs ?? {};

  for (const gate of ['spec-present', 'intervention-logged', 'agents-drift', 'author-identity']) {
    it(`has a job named ${gate}`, () => {
      const names = Object.values(jobs).map((job) => job.name);
      expect(names).toContain(gate);
    });
  }

  it('agents-drift runs the generator in --check mode', () => {
    const drift = Object.values(jobs).find((job) => job.name === 'agents-drift');
    const runs = (drift?.steps ?? []).map((step) => step.run ?? '').join('\n');
    expect(runs).toContain('generate-claude-agents.ts');
    expect(runs).toContain('--check');
  });

  it('the history-reading gates check out full history, not a shallow clone', () => {
    // With the default `fetch-depth: 1` there is no base commit to diff against and no commit
    // range to walk, so both gates would pass by seeing nothing at all.
    for (const gate of ['spec-present', 'author-identity']) {
      const job = Object.values(jobs).find((j) => j.name === gate);
      const checkout = (job?.steps ?? []).find((s) =>
        (s.uses ?? '').startsWith('actions/checkout'),
      );
      expect(checkout?.with?.['fetch-depth'], `${gate} must not use a shallow clone`).toBe(0);
    }
  });
});

describe('AC7 — a gate that cannot see its inputs refuses, rather than passing', () => {
  // End-to-end through the real CLI: the pure functions above cannot catch this, because the bug
  // lives entirely in how facts are gathered. A shallow clone makes `git diff` fail; an earlier
  // draft that swallowed the error reported every branch green.
  const cli = join(root, 'scripts', 'gates', 'run.ts');

  function runGate(gate: string, env: Record<string, string>): { status: number; output: string } {
    const result = spawnSync('pnpm', ['tsx', cli, gate], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    });
    return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  it('exits 2 and names fetch-depth when the base ref is absent', () => {
    const { status, output } = runGate('spec-present', {
      GITHUB_BASE_REF: 'a-branch-that-does-not-exist',
      GITHUB_HEAD_REF: 'W0-T12-ci-gates',
    });
    expect(status).toBe(2);
    expect(output).toContain('GATE_NO_BASE');
    expect(output).toContain('fetch-depth: 0');
  });

  // A regression test with a real repository, because the bug lived entirely in the range and the
  // pure function above could never have seen it. `W12-T15` was green at 09:26 and red at 09:30 on
  // the identical commit; what changed in between was that `#242` was merged into `main`.
  it('walks only the branch\u2019s own commits, not what landed on the base meanwhile', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'gate-range-'));
    const run = (...args: string[]) =>
      spawnSync('git', args, { cwd: scratch, encoding: 'utf8', env: { ...process.env } });

    try {
      run('init', '-q', '-b', 'main');
      run('config', 'user.email', 'mastrobardo@gmail.com');
      run('config', 'user.name', 'mastrobardo');
      writeFileSync(join(scratch, 'a.txt'), 'one\n');
      run('add', '-A');
      run('commit', '-qm', 'base');

      run('checkout', '-qb', 'feature');
      writeFileSync(join(scratch, 'b.txt'), 'two\n');
      run('add', '-A');
      run('commit', '-qm', 'the branch\u2019s own work');

      // Meanwhile, on main: exactly what a GitHub squash-merge leaves behind — a normal commit
      // whose committer is GitHub, not a person.
      run('checkout', '-q', 'main');
      writeFileSync(join(scratch, 'c.txt'), 'three\n');
      run('add', '-A');
      run(
        '-c',
        'user.email=noreply@github.com',
        '-c',
        'user.name=GitHub',
        'commit',
        '-qm',
        'merged pull request (#242)',
      );

      // `origin/main` is what the gate resolves, so give the scratch repo one pointing at itself.
      run('update-ref', 'refs/remotes/origin/main', 'main');
      run('checkout', '-q', 'feature');

      const threeDot = spawnSync(
        'git',
        ['log', '--no-merges', '--format=%ce', 'origin/main...HEAD'],
        { cwd: scratch, encoding: 'utf8' },
      )
        .stdout.trim()
        .split('\n');
      const twoDot = spawnSync('git', ['log', '--no-merges', '--format=%ce', 'origin/main..HEAD'], {
        cwd: scratch,
        encoding: 'utf8',
      })
        .stdout.trim()
        .split('\n');

      // The bug, demonstrated: three dots drags GitHub's committer into the branch's history.
      expect(threeDot).toContain('noreply@github.com');
      // The fix: two dots sees only what the branch actually committed.
      expect(twoDot).not.toContain('noreply@github.com');
      expect(twoDot).toEqual(['mastrobardo@gmail.com']);

      // And the gate is wired to the second one.
      const source = readFileSync(join(root, 'scripts', 'gates', 'run.ts'), 'utf8');
      expect(source).toMatch(/range\('log'\)/);
      expect(source).toMatch(/kind === 'diff' \? '\.\.\.' : '\.\.'/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('rejects an unknown gate name rather than passing silently', () => {
    const { status } = runGate('no-such-gate', { GITHUB_BASE_REF: 'main' });
    expect(status).toBe(2);
  });
}, 60_000);
