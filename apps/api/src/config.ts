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

  // ── W2-T01 §4.8 — authentication ──────────────────────────────────────────────────────────

  /**
   * Signs session tokens and verification links.
   *
   * **No default, deliberately.** Every other variable here degrades gracefully when unset; this
   * one does not. A defaulted auth secret that reaches production is the whole security model
   * gone, and it fails silently — everything works, and every token is forgeable by anyone who
   * has read the repository. 32 characters is better-auth's own floor.
   */
  BETTER_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters'),

  /**
   * The origin better-auth builds links against — the URL in a verification or reset email.
   *
   * ADR-005 rule 5 says the browser sees one origin, so in every deployed environment this is the
   * *web* origin, not the API's own host: the link a user clicks has to land on the storefront.
   */
  BETTER_AUTH_URL: z.url(),

  /**
   * Mark a new account's address as verified at sign-up, without anybody checking it.
   *
   * **Temporary, and off by default — `W2-T10` §2.2.** Verification is required to sign in
   * (`ADR-005`, `W2-T01` §4.6) and no deployed environment can send mail until `OPS-14`, so every
   * sign-up there strands its account: sign-in refuses, re-registering returns the anti-enumeration
   * `200`, and a resend is a `500`. This makes an account usable in the meantime. Operator,
   * 2026-09-14: *"once the user signup, we should set it as 'verified' for the time being."*
   *
   * The cost is real and is not hidden: an address is no longer proven to belong to the person who
   * typed it. `false` here is what keeps that cost visible — an environment that takes it on says
   * so in a diff, and `buildApp` warns at boot outside development.
   *
   * **Not** `requireEmailVerification: false`, which is the shortcut that looks equivalent and is
   * not: better-auth derives its synthetic duplicate-sign-up response from that option, so turning
   * it off would delete the enumeration defence as a side effect. See `auth.ts`.
   */
  AUTH_TRUST_EMAIL_ON_SIGNUP: z.stringbool().default(false),

  // ── W0-T30 §3.3 — seeding a deployed database ─────────────────────────────────────────────

  /**
   * The password `auth.demo-users` gives its two accounts.
   *
   * **Optional here and conditionally required by the seeder**, which is the only place both facts
   * are known at once: the schema cannot see whether `DATABASE_URL` points at a laptop. Unset
   * against a local host means the committed convenience password; unset against anything else is
   * a refusal, because that literal is public and these accounts are reachable from the internet.
   *
   * Nothing but the seed pipeline reads it, and the API never needs it at boot — which is why it
   * has no default rather than a bad one.
   */
  SEED_DEMO_PASSWORD: z.string().min(12).optional(),

  /** Mailpit locally (docker-compose, SMTP 1025); OPS-14 replaces the values, not the code. */
  MAIL_SMTP_HOST: z.string().min(1).default('127.0.0.1'),
  MAIL_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  MAIL_FROM: z.email().default('no-reply@marketplace.local'),
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
