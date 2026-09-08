import { z } from 'zod';

/**
 * The environment this service needs, validated once at boot.
 *
 * Every variable is declared here or it does not exist. A module that reaches for
 * `process.env.SOMETHING` directly is a review failure: the whole point is that a misconfigured
 * deployment fails at the deploy, with a message naming what is wrong, rather than at 03:00 in
 * front of a user.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Set by the deploy pipeline (`W0-T07`) to the released tag or commit; surfaced by /health. */
  APP_VERSION: z.string().min(1).default('0.0.0-dev'),
  /** Required from the first commit, so that the day a module needs a database is not also the
   *  day the deployment discovers it has no connection string. Nothing connects to it yet. */
  DATABASE_URL: z.url(),
});

export type Config = Readonly<z.infer<typeof EnvSchema>>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * Parse an environment into a `Config`. Pure: it neither reads nor writes anything ambient, which
 * is what makes it testable without `vi.stubEnv`.
 *
 * Reports **every** problem at once. One boot, one message: fixing five variables should take one
 * deploy, not five.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (result.success) return Object.freeze(result.data);

  const problems = result.error.issues
    .map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new ConfigError(`Invalid environment:\n${problems}`);
}

let cached: Config | undefined;

/**
 * The process-wide configuration, read from the real environment exactly once.
 *
 * Call this at the composition root and pass the value down. Calling it deep inside a module works
 * but hides a dependency, which is how a service ends up impossible to test.
 */
export function getConfig(): Config {
  cached ??= loadConfig();
  return cached;
}
