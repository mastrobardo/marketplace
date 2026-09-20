/**
 * How strong each secret has to be, and where it goes.
 *
 * Split from `generate.ts` so the rules can be asserted without importing anything that can emit a
 * value: this module is pure data and pure functions, and `tests/secrets-generate.test.ts` imports
 * *this*, never the generator.
 *
 * `W0-T31`.
 */
import { REQUIRED, type DeployTarget } from '../deploy/config.js';

/** How a value is rendered once random bytes exist. */
export type Alphabet = 'base64' | 'hex';

/**
 * Does a human ever need to read this value?
 *
 * The distinction `W0-T31` shipped without, and the reason its first real use was useless. Two
 * secrets this tool generates have **opposite** requirements:
 *
 * - `nobody` — `*_BETTER_AUTH_SECRET` signs sessions. Nobody should ever know it, and a tool that
 *   showed it would be handing out the thing it exists to protect.
 * - `humans` — `*_SEED_DEMO_PASSWORD` is the password QA signs in with. **A value nobody knows is
 *   worthless**, and hiding it does not make the environment safer, only unusable.
 *
 * Printing a `humans` secret is safe by the same argument that makes `--write` safe: the tool
 * refuses unless stdout is a TTY, and a TTY *is* a human looking at a terminal. The guard was never
 * "never show a secret" — it was "never show one to something that records it".
 */
export type Audience = 'nobody' | 'humans';

export interface Recipe {
  /** Bytes of entropy drawn from `randomBytes`, before encoding. */
  readonly bytes: number;
  readonly alphabet: Alphabet;
  /** Why this strength, in one line — printed with the value so the reason travels with it. */
  readonly because: string;
  /** Whether a person has to end up knowing this value. See `Audience`. */
  readonly audience: Audience;
  /**
   * Does changing this secret actually change anything, on its own?
   *
   * `W0-T30` made this worth stating: a seeded password is written **once per database** and the
   * ledger skips the seeder for ever after, so a new value has no effect on an environment that is
   * already seeded. Rotating it is a two-step operation, and a tool that implies otherwise is
   * worse than no tool.
   */
  readonly rotation: 'immediate' | 'needs-reseed';
}

/**
 * Matched by **suffix**, because every one of these names is `<ENVIRONMENT>_<ROLE>` and it is the
 * role that decides the strength. A new environment therefore needs no change here.
 */
const RECIPES: ReadonlyArray<readonly [suffix: string, recipe: Recipe]> = [
  [
    'BETTER_AUTH_SECRET',
    {
      bytes: 32,
      alphabet: 'base64',
      because:
        "better-auth's own floor is 32 characters; this is 32 *bytes* of entropy (W2-T01 §4.8)",
      // Nobody signs in with this. It is a signing key, and the only correct number of people who
      // know it is zero.
      audience: 'nobody',
      // It signs session tokens and verification links, so a new value invalidates every session
      // in that environment the moment the app restarts. That is the correct blast radius for a
      // key you suspect is compromised.
      rotation: 'immediate',
    },
  ],
  [
    'SEED_DEMO_PASSWORD',
    {
      bytes: 24,
      alphabet: 'base64',
      because: 'EnvSchema demands at least 12 characters; 24 bytes is well past it (W0-T30 §3.3)',
      // The whole point is that QA signs in as the demo accounts. A value nobody knows does not
      // secure staging; it just means nobody can use it.
      audience: 'humans',
      rotation: 'needs-reseed',
    },
  ],
];

/** Every secret name the deploy guard knows about, in one flat sorted list. */
export function knownSecrets(): string[] {
  const names = new Set<string>();
  for (const list of Object.values(REQUIRED)) for (const name of list) names.add(name);
  return [...names].sort();
}

/** Which environments' `REQUIRED` lists name this secret. A secret may be shared by several. */
export function environmentsFor(name: string): DeployTarget[] {
  return (Object.keys(REQUIRED) as DeployTarget[]).filter((target) =>
    REQUIRED[target].includes(name),
  );
}

/**
 * The recipe for a secret, or `undefined` when nothing here knows how to make one.
 *
 * Undefined is the **right** answer for a vendor credential: `FLY_API_TOKEN` is issued by Fly and
 * cannot be invented locally. Generating 32 random bytes and calling it an API token would produce
 * a value that is syntactically fine and simply does not work.
 */
export function recipeFor(name: string): Recipe | undefined {
  return RECIPES.find(([suffix]) => name.endsWith(suffix))?.[1];
}

/**
 * Credentials that exist because a vendor issued them, and cannot be invented here.
 *
 * Listed **explicitly** rather than inferred as "everything without a recipe", so that a secret
 * added to `REQUIRED` fails `tests/secrets-generate.test.ts` until somebody states which kind it
 * is. Inferring it would classify every new secret as vendor-issued by silence, which is the
 * answer that needs no thought and is wrong half the time.
 */
export const ISSUED_ELSEWHERE: readonly string[] = [
  'FLY_API_TOKEN',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_ACCOUNT_ID',
  'NEON_API_KEY',
  'NEON_PROJECT_ID',
  // Neon hands this back at deploy time for a preview; for staging and production it is the
  // connection string of a database somebody provisioned. Either way, not random bytes.
  'STAGING_DATABASE_URL',
  'PRODUCTION_DATABASE_URL',
];

/** Names this tool can generate — the rest are issued by somebody else. */
export function generatableSecrets(): string[] {
  return knownSecrets().filter((name) => recipeFor(name) !== undefined);
}
