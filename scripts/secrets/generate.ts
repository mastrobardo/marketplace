/**
 * Generate a deploy secret, and optionally write it straight into a GitHub Environment.
 *
 * ```bash
 * tsx scripts/secrets/generate.ts PREVIEW_SEED_DEMO_PASSWORD           # print it, to paste
 * tsx scripts/secrets/generate.ts PREVIEW_SEED_DEMO_PASSWORD --write   # set it via gh, never shown
 * tsx scripts/secrets/generate.ts --list                               # what this can make
 * ```
 *
 * ## Why this exists at all
 *
 * `agents/policies/human-boundaries.md` forbids an agent to *create, read, guess, echo, log or
 * commit* a secret. Writing a tool that a **human** runs is not that — but only if the tool cannot
 * become a way around the rule. Three things could turn it into one, and each is closed by
 * construction rather than by convention:
 *
 * 1. **A value in `argv`** is visible in `ps`, in shell history and in any process listing. So the
 *    value is handed to `gh secret set` on **stdin**; it never appears in a command line, not even
 *    the one this script builds.
 * 2. **A value on stdout** is captured by whatever is reading stdout — which, in an agent session,
 *    is the agent. So `--write` **prints no value at all**, and both modes **refuse to run unless
 *    stdout is a TTY**. A piped, redirected or captured stdout aborts before `randomBytes` is
 *    called. An agent that tries to run this gets a refusal, which is the point: the guarantee is
 *    structural, not a promise.
 * 3. **A value on disk** survives the process. Nothing is ever written to a file; the value exists
 *    as one string, in one variable, and is handed to a pipe.
 *
 * `CI=true` is refused for the same reason: a workflow log is a transcript like any other.
 *
 * `W0-T31`.
 */
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { type DeployTarget } from '../deploy/config.js';
import {
  environmentsFor,
  generatableSecrets,
  knownSecrets,
  recipeFor,
  type Recipe,
} from './strength.js';

export class SecretToolError extends Error {
  override readonly name = 'SecretToolError';
}

export interface Options {
  readonly name?: string;
  readonly write: boolean;
  readonly list: boolean;
  /** Which environment to write to, when a secret belongs to more than one. */
  readonly env?: string;
  /**
   * `--seeded` / `--not-seeded`: has the target already run the seeder?
   *
   * Only affects the rotation note. Undefined is "nobody checked", which is hedged rather than
   * guessed — the wrappers pass it because they know which environment they are talking about.
   */
  readonly seeded?: boolean;
}

/** Parse argv. Deliberately tiny — a flag parser is not worth a dependency in a secrets path. */
export function parseArgs(argv: readonly string[]): Options {
  const positional = argv.filter((arg) => !arg.startsWith('-'));
  const envFlag = argv.findIndex((arg) => arg === '--env' || arg.startsWith('--env='));
  const env =
    envFlag === -1
      ? undefined
      : argv[envFlag]?.startsWith('--env=') === true
        ? argv[envFlag]?.slice('--env='.length)
        : argv[envFlag + 1];

  const seeded = argv.includes('--seeded')
    ? true
    : argv.includes('--not-seeded')
      ? false
      : undefined;

  return {
    ...(positional[0] === undefined ? {} : { name: positional[0] }),
    write: argv.includes('--write'),
    list: argv.includes('--list'),
    ...(env === undefined ? {} : { env }),
    ...(seeded === undefined ? {} : { seeded }),
  };
}

/**
 * Is this session safe to show a secret in?
 *
 * The check is `isTTY` on **stdout**, because that is precisely the thing that differs between a
 * human at a terminal and anything that captures output — a pipe, a redirect, a CI runner, an
 * agent. It is not a heuristic about *who* is running; it is a fact about where the bytes go.
 */
export function outputIsCaptured(
  stream: { isTTY?: boolean } = process.stdout,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env['CI'] !== undefined && env['CI'] !== '' && env['CI'] !== 'false') return true;
  return stream.isTTY !== true;
}

/** A value of the strength this secret's role calls for. Never logged, never returned twice. */
export function generate(recipe: Recipe): string {
  const raw = randomBytes(recipe.bytes);
  return recipe.alphabet === 'hex'
    ? raw.toString('hex')
    : // URL-safe, and stripped of `=` padding: these values are pasted into web forms, copied
      // through shells and occasionally embedded in URLs by somebody in a hurry.
      raw.toString('base64url');
}

/** Which environment a write targets, and why it is unambiguous. */
export function resolveEnvironment(name: string, requested: string | undefined): DeployTarget {
  const candidates = environmentsFor(name);

  if (candidates.length === 0) {
    throw new SecretToolError(
      `"${name}" is not in REQUIRED for any environment, so there is nowhere to put it. ` +
        `Add it to scripts/deploy/config.ts first — a secret no guard checks for is a secret ` +
        `that can go missing without failing a deploy.`,
    );
  }

  if (requested !== undefined) {
    if (!candidates.includes(requested as DeployTarget)) {
      throw new SecretToolError(
        `"${name}" does not belong to the "${requested}" environment. ` +
          `REQUIRED names it in: ${candidates.join(', ')}.`,
      );
    }
    return requested as DeployTarget;
  }

  if (candidates.length > 1) {
    throw new SecretToolError(
      `"${name}" is required by ${String(candidates.length)} environments ` +
        `(${candidates.join(', ')}), so --env must say which. ` +
        `Writing the same value to all of them is not a default this tool will pick for you: ` +
        `one secret shared across environments makes the weakest of them a way into the others.`,
    );
  }

  return candidates[0] as DeployTarget;
}

/**
 * Hand the value to `gh secret set` on stdin.
 *
 * `input` is the whole mechanism: `spawnSync` writes it to the child's stdin, so the value crosses
 * a pipe and never a command line. `stdio` for stdout/stderr is `inherit` so gh's own confirmation
 * reaches the terminal — gh prints the secret's *name*, never its value.
 */
export type Spawn = (
  command: string,
  args: readonly string[],
  options: { input: string },
) => { status: number | null; error?: Error };

export function writeSecret(
  name: string,
  environment: DeployTarget,
  value: string,
  // Injected by the test that proves the value never reaches `args`. Production passes nothing.
  spawn: Spawn = (command, args, options) =>
    spawnSync(command, [...args], {
      input: options.input,
      stdio: ['pipe', 'inherit', 'inherit'],
      encoding: 'utf8',
    }),
): void {
  const result = spawn('gh', ['secret', 'set', name, '--env', environment], { input: value });

  if (result.error !== undefined) {
    throw new SecretToolError(
      `could not run gh: ${result.error.message}. Install the GitHub CLI and run 'gh auth login'.`,
    );
  }
  if (result.status !== 0) {
    throw new SecretToolError(
      `gh secret set exited ${String(result.status ?? 'null')}. The value was not written. ` +
        `Nothing was printed, so nothing leaked — run again once gh is working.`,
    );
  }
}

/**
 * The rotation note, which is the part people get wrong — this tool included, at first.
 *
 * `seeded` says whether the target has **already run the seeder**, and it matters because the
 * warning below is irrelevant and actively alarming on an environment that never has: there, a new
 * value is simply *the* value, and the next deploy uses it. The first version printed the warning
 * unconditionally and told an operator their brand-new secret would not take effect, which was
 * false and read as "this tool just wasted your time".
 *
 * `undefined` means nobody checked, and gets a hedged note rather than a confident claim either way.
 */
export function rotationNote(name: string, recipe: Recipe, seeded?: boolean): string {
  if (recipe.rotation === 'immediate') {
    return (
      `Rotation is immediate: this signs sessions, so every signed-in user in that environment\n` +
      `is signed out as soon as the app restarts. That is correct for a key you suspect is leaked.`
    );
  }

  if (seeded === false) {
    return (
      `This environment has not been seeded yet, so this value is simply the one it will use:\n` +
      `the next deploy runs the seeder and creates the accounts with it. Nothing to rotate.`
    );
  }

  return (
    `\u26a0 If this environment has already been seeded, a new value does NOT change existing accounts.\n` +
    `${name} is written by a seeder, and a seeder runs once per database — the ledger (_seed_run)\n` +
    `skips it for ever after, so the next deploy reads the new value and skips the seeder.\n` +
    `To actually rotate: delete that seeder's ledger row and re-seed, or branch a fresh database.`
  );
}

function listAndExit(): void {
  const generatable = generatableSecrets();
  const issued = knownSecrets().filter((name) => !generatable.includes(name));

  console.log('Secrets this tool can generate:\n');
  for (const name of generatable) {
    const recipe = recipeFor(name) as Recipe;
    console.log(`  ${name.padEnd(30)} ${environmentsFor(name).join(', ')}`);
    console.log(`  ${' '.repeat(30)} ${recipe.because}`);
  }
  console.log('\nIssued elsewhere — this tool cannot invent them:\n');
  for (const name of issued)
    console.log(`  ${name.padEnd(30)} ${environmentsFor(name).join(', ')}`);
  console.log('');
}

export function main(argv: readonly string[]): void {
  const options = parseArgs(argv);

  if (options.list) {
    listAndExit();
    return;
  }

  if (options.name === undefined) {
    throw new SecretToolError(
      'name a secret, or pass --list to see what this can make.\n' +
        '  tsx scripts/secrets/generate.ts PREVIEW_SEED_DEMO_PASSWORD [--write]',
    );
  }

  const { name } = options;
  const recipe = recipeFor(name);

  if (recipe === undefined) {
    const known = generatableSecrets();
    throw new SecretToolError(
      knownSecrets().includes(name)
        ? `"${name}" is issued by a vendor, not invented locally — generating random bytes for it ` +
            `would produce a value that is the right shape and simply does not work.\n` +
            `Generatable: ${known.join(', ')}.`
        : `unknown secret "${name}".\nGeneratable: ${known.join(', ')}.`,
    );
  }

  // Resolved *before* any entropy is drawn, so a mistyped environment cannot leave a value
  // generated-but-unwritten, which is the state that tempts somebody to paste it somewhere.
  const environment = resolveEnvironment(name, options.env);

  if (outputIsCaptured()) {
    throw new SecretToolError(
      'refusing to run: stdout is not a terminal.\n\n' +
        'This tool produces a credential, and anything that captures stdout — a pipe, a redirect,\n' +
        'a CI job, an agent session — would capture it too. Run it directly in your own terminal.\n' +
        'No value was generated.',
    );
  }

  const value = generate(recipe);

  if (options.write) {
    writeSecret(name, environment, value);
    console.log(`\n${name} → ${environment}: set.\n`);

    if (recipe.audience === 'humans') {
      // Printed **because** somebody has to use it. A demo-account password nobody knows does not
      // make staging safer; it makes it unusable, which is what the first version of this tool
      // shipped. Showing it is safe for the same reason writing it was: stdout is a TTY, and a TTY
      // is a person looking at a terminal.
      console.log(`  ${value}\n`);
      console.log(`Write this down now — GitHub will not show it to you again, and neither will`);
      console.log(`this tool. It is the password for the demo accounts on ${environment}.\n`);
    } else {
      // Not shown, and correctly so: nobody signs in with a signing key.
      console.log(`Not shown, and nobody needs it: this is a signing key, not a password.`);
      console.log(`It went to gh over a pipe and was never in a command line.\n`);
    }

    console.log(rotationNote(name, recipe, options.seeded));
    console.log('');
    return;
  }

  console.log(`\n${name}  (${environment})\n`);
  console.log(`  ${value}\n`);
  console.log(`  ${recipe.because}`);
  console.log(`\nWhere: Settings → Environments → ${environment} → Add secret`);
  console.log(
    `Or:    tsx scripts/secrets/generate.ts ${name} --write   (sets it without showing it)`,
  );
  console.log(`\n${rotationNote(name, recipe, options.seeded)}`);
  console.log(
    `\nThis value is now in your terminal scrollback. Clear it when you are done: \`clear && printf '\\033[3J'\`\n`,
  );
}

// Run only when invoked as the entrypoint. Importing this module — which the test suite does, to
// assert the refusals — must never generate anything.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2));
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
