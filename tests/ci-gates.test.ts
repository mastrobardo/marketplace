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
import { checkAgentsDrift } from '../scripts/gates/agents-drift.js';

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

  // W0-T29 AC9. MEM-2026-09-17-16: the gate has fired exactly once in this repo's history, on
  // `03e8651` — the squash-merge commit GitHub wrote when #256 was merged through the web UI. A
  // commit whose *committer* is `noreply@github.com` was committed by the platform, never by a
  // person, so that trailer is not evidence about identity and its remedy (amend, reset-author)
  // cannot be applied to it. The author is still the trailer the rule is about.
  it('does not judge the committer of a commit GitHub itself committed', () => {
    const result = checkAuthorIdentity([
      { sha: '03e8651', authorEmail: EXPECTED_EMAIL, committerEmail: 'noreply@github.com' },
    ]);
    expect(result.ok, 'a GitHub squash-merge in the range reddens a branch nobody mis-signed').toBe(
      true,
    );
  });

  it('still judges the author of a commit GitHub committed', () => {
    const result = checkAuthorIdentity([
      {
        sha: '03e8651',
        authorEmail: 'davide.arcinotti@iagl.com',
        committerEmail: 'noreply@github.com',
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('author');
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

describe('AC6 — ci.yml runs every gate, in one job (W0-T29)', () => {
  interface Job {
    name?: string;
    steps?: { uses?: string; run?: string; with?: Record<string, unknown> }[];
  }
  const ci = parseYaml(readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')) as {
    jobs?: Record<string, Job>;
  };
  const jobs = ci.jobs ?? {};
  const gates = Object.values(jobs).find((job) => job.name === 'gates');

  it('has a job named gates', () => {
    expect(gates, 'no job named "gates"').toBeDefined();
  });

  // W0-T29. Four jobs ran the same script with a different argument, each paying ~30s of checkout,
  // setup-node and install to run ~2s of gate — and each billing a whole minute, because GitHub
  // rounds every job up. The names are gone from branch protection deliberately (spec §4); what
  // kept a red PR legible is now an annotation per failing gate, not a job name.
  for (const retired of [
    'spec-present',
    'intervention-logged',
    'author-identity',
    'agents-drift',
  ]) {
    it(`no longer has a job named ${retired}`, () => {
      const names = Object.values(jobs).map((job) => job.name);
      expect(
        names,
        `${retired} is still its own job — four setup taxes for four seconds of work`,
      ).not.toContain(retired);
    });
  }

  it('is the only job that runs the gate runner', () => {
    const runners = Object.entries(jobs)
      .filter(([, job]) =>
        (job.steps ?? []).some((step) => /gates\/run\.ts|pnpm gates/.test(step.run ?? '')),
      )
      .map(([key]) => key);
    expect(runners).toEqual(['gates']);
  });

  it('runs the same command an agent runs locally', () => {
    const runs = (gates?.steps ?? []).map((step) => step.run ?? '').join('\n');
    expect(runs, 'the gates job runs a CI-only variant command').toContain('pnpm gates');

    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(manifest.scripts?.['gates'] ?? '', 'no root `gates` script to run locally').toContain(
      'scripts/gates/run.ts',
    );
  });

  it('checks out full history, not a shallow clone', () => {
    // With the default `fetch-depth: 1` there is no base commit to diff against and no commit
    // range to walk, so the gates would pass by seeing nothing at all.
    const checkout = (gates?.steps ?? []).find((step) =>
      (step.uses ?? '').startsWith('actions/checkout'),
    );
    expect(checkout?.with?.['fetch-depth'], 'the gates must not run on a shallow clone').toBe(0);
  });

  it('still passes the PR labels in as JSON', () => {
    // A label may legally contain commas and spaces, and interpolating one into a `run:` string is
    // how a label becomes a command.
    const raw = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
    expect(raw).toMatch(/PR_LABELS:\s*\$\{\{\s*toJSON\(github\.event\.pull_request\.labels/);
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

/* ------------------------------------------------------------------------------------------- *
 * W0-T29 — one invocation, every gate, one round trip
 * ------------------------------------------------------------------------------------------- */

describe('AC8 — agents-drift is a gate verdict like any other', () => {
  it('passes when the generator finds nothing out of date', () => {
    const result = checkAgentsDrift({
      exitCode: 0,
      output: '.claude/agents is in sync with agents/roles\n',
    });
    expect(result.ok).toBe(true);
  });

  it('fails carrying the generator’s own message, and the command that fixes it', () => {
    const result = checkAgentsDrift({
      exitCode: 1,
      output: 'drift: .claude/agents/agent-ui.md is out of date with agents/roles/agent-ui.md\n',
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('AGENTS_DRIFT');
    expect(result.message, 'the verdict drops which file drifted').toContain('agent-ui.md');
    expect(result.message, 'the verdict does not say how to fix it').toContain(
      'generate-claude-agents.ts',
    );
  });

  it('never reports a crash as a pass', () => {
    // A generator that cannot run at all is not a repository in sync.
    const result = checkAgentsDrift({ exitCode: 2, output: 'Error: ENOENT agents/roles' });
    expect(result.ok).toBe(false);
  });
});

describe('AC3–AC6 — the runner judges every gate in one invocation', () => {
  const cli = join(root, 'scripts', 'gates', 'run.ts');

  /**
   * The GitHub variables are cleared before each run rather than inherited: this suite itself runs
   * in CI, where `GITHUB_BASE_REF` is set to whatever pull request is being checked, and a test
   * that reads the host's pull request proves nothing about the gate.
   */
  function runAll(cwd: string, env: Record<string, string>): { status: number; output: string } {
    // The repo's own `tsx`, not `pnpm tsx`: pnpm refuses to run in a directory with no
    // package.json, and two of these runs stand in a scratch git repository on purpose.
    const result = spawnSync(join(root, 'node_modules', '.bin', 'tsx'), [cli, '--all'], {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_BASE_REF: '',
        GITHUB_HEAD_REF: '',
        GITHUB_STEP_SUMMARY: '',
        GITHUB_ACTIONS: '',
        PR_LABELS: '',
        ...env,
      },
    });
    return { status: result.status ?? -1, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  }

  /** A branch that fails two gates at once: no spec, and a commit signed with a work address. */
  function scratchRepo(): string {
    const scratch = mkdtempSync(join(tmpdir(), 'gates-all-'));
    const git = (...args: string[]) =>
      spawnSync('git', args, { cwd: scratch, encoding: 'utf8', env: { ...process.env } });

    git('init', '-q', '-b', 'main');
    git('config', 'user.email', EXPECTED_EMAIL);
    git('config', 'user.name', 'mastrobardo');
    writeFileSync(join(scratch, 'a.txt'), 'one\n');
    git('add', '-A');
    git('commit', '-qm', 'base');

    git('checkout', '-qb', 'W9-T99-no-spec');
    writeFileSync(join(scratch, 'b.txt'), 'two\n');
    git('add', '-A');
    git('-c', 'user.email=davide.arcinotti@iagl.com', 'commit', '-qm', 'work identity, no spec');
    git('update-ref', 'refs/remotes/origin/main', 'main');
    return scratch;
  }

  it('reports both failures from one run, and every gate’s verdict', () => {
    const scratch = scratchRepo();
    const summary = join(scratch, 'summary.md');
    try {
      const { status, output } = runAll(scratch, {
        GITHUB_BASE_REF: 'main',
        GITHUB_HEAD_REF: 'W9-T99-no-spec',
        GITHUB_STEP_SUMMARY: summary,
        GITHUB_ACTIONS: 'true',
      });

      // AC6 — one failing gate is a failing job.
      expect(status, 'a failing gate did not fail the job').toBe(1);

      // AC3 — the second failure is not hidden behind the first. Four jobs used to buy this;
      // stopping at the first gate would cost a whole CI round trip to find the next one.
      expect(output).toContain('SPEC_MISSING');
      expect(output).toContain('AUTHOR_IDENTITY');

      // AC5 — a red check names its gate on the Checks tab, without opening a log.
      expect(output).toContain('::error title=gate: spec-present::');
      expect(output, 'a multi-line remedy must be %0A-encoded or GitHub drops it').toContain('%0A');

      // AC4 — every verdict in the run summary, and the failing gate's full text under it.
      const written = readFileSync(summary, 'utf8');
      for (const gate of [
        'spec-present',
        'intervention-logged',
        'author-identity',
        'agents-drift',
      ]) {
        expect(written, `${gate} is missing from the run summary`).toContain(gate);
      }
      expect(written, 'the summary names the failure but not the remedy').toContain(
        'No spec, no merge.',
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('judges .claude/agents against this repo, wherever it is run from', () => {
    // `agents-drift` is about the repository the gate lives in, not the working directory git
    // happens to be pointed at — otherwise running the suite from a scratch clone reports drift
    // that does not exist.
    const scratch = scratchRepo();
    try {
      const { output } = runAll(scratch, {
        GITHUB_BASE_REF: 'main',
        GITHUB_HEAD_REF: 'W9-T99-no-spec',
      });
      expect(output).toMatch(/agents-drift: ok/);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('on a push to main, the PR gates say so and agents-drift still runs', () => {
    // AC8. No base ref and no labels: three of the four have nothing to compare. They report that
    // rather than disappearing — a skipped job is reported to branch protection as a satisfied one.
    const { status, output } = runAll(root, {});
    expect(status, 'a push to main must not fail the gates job').toBe(0);
    expect(output).toContain('not a pull request');
    expect(output, 'agents-drift needs no PR and must still run on main').toMatch(
      /agents-drift: ok/,
    );
  });
}, 120_000);
