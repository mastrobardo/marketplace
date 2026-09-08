# Credentials agents need to work autonomously

## The principle: agents never hold a secret value

An agent writes a workflow that *references* a secret; CI injects the value at run time. The agent
never sees it, never logs it, never puts it in a file. Locally an agent works against
`docker-compose` and fake values only.

So the question is not "what does the agent know" but **"what can the agent's pipeline do without a
human"** — and the answer must stop hard at production.

| | Preview | Staging | Production |
|---|---|---|---|
| Agent's PR can deploy here | ✅ automatic | ✅ on merge | ❌ never |
| Credentials live in | `preview` environment | `staging` environment | `production` environment, **manual approval required** |

---

## The walking skeleton needs four services

`Fly.io` · `Neon` · `Cloudflare` · `Sentry`. That is the whole M0 credential surface — section A plus
`SENTRY_DSN` and `SENTRY_AUTH_TOKEN`. Everything in section B arrives with the feature that needs it:
Stripe with payouts, Flagsmith with the first flag, Maps with the map, email with signup, SMS with
phone verification. Do not create an account before a ticket needs it.

## A. Ship a preview environment (the minimum for autonomy)

| Variable | Scope to grant | Why the agent needs it |
|---|---|---|
| `FLY_API_TOKEN_NONPROD` | **Deploy token, non-production apps only** (`fly tokens create deploy -a <app>`) — never an org-wide token | Create and destroy the per-PR API app |
| `CLOUDFLARE_API_TOKEN` | Custom token: `Pages:Edit` + `R2:Edit` on the one bucket. **Not** the global API key | Deploy the web preview, manage uploads |
| `CLOUDFLARE_ACCOUNT_ID` | not secret | Addressing |
| `NEON_API_KEY_STAGING` | Key on the **staging project only** — the production project keeps its own key that CI never sees | Create the PR's database branch, delete it on close |
| `NEON_PROJECT_ID` | not secret | Addressing |
| `DATABASE_URL` | injected per run by the branch-create step | Migrations and tests |

## B. Make the preview actually work — *added per feature, not up front*

| Variable | Needed for | Notes |
|---|---|
| `STRIPE_SECRET_KEY_TEST` | `W5-T01` | **Restricted key**, test mode. Grant only the resources we use (PaymentIntents, Accounts, Transfers, Subscriptions) |
| `STRIPE_WEBHOOK_SECRET_TEST` | `W5-T03` | Per endpoint; previews share one staging endpoint |
| `VITE_STRIPE_PUBLISHABLE_KEY` | `W5-T02` | Public by design |
| `FLAGSMITH_ENVIRONMENT_KEY` | `W0-T17` | Server-side SDK key, one per environment |
| `FLAGSMITH_ADMIN_TOKEN` | `W0-T17` | Management API — lets an agent **create the flag it just declared in code** instead of asking you. This is the difference between autonomous and blocked |
| `GOOGLE_MAPS_BROWSER_KEY` | `W3-T06` | Referrer-restricted, quota-capped |
| `GOOGLE_GEOCODING_KEY` | `W3-T05` | Separate server key, IP-restricted. Never reuse the browser key |
| `RESEND_API_KEY` | `W2-T01` | Staging sender domain. Locally, MailHog needs nothing |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | `W2-T06` | Use **Twilio test credentials** in CI — real ones cost money per message and an agent in a retry loop is expensive |
| `TWILIO_MESSAGING_SERVICE_SID` | `W2-T06` | |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `W7-T04` | Web push, generated once per environment |
| `DATA_ENCRYPTION_KEY` | `W0-T18` | **Preview and staging keys may be CI-generated.** The production key is human-only and never leaves the production environment |
| `LOOKUP_HASH_PEPPER` | `W0-T18` | Same rule |
| `SENTRY_DSN` | **M0** | Per environment |

## C. Let the agent check its own work (the part usually forgotten)

Autonomy is not only deploying — it is finding out whether the deploy worked. Without these an agent
ships and then asks a human "did it work?", which defeats the purpose.

| Variable | Scope | Unlocks |
|---|---|---|
| `SENTRY_AUTH_TOKEN` | `event:read`, `project:releases`, `org:read` | Read the errors its own deploy produced; upload source maps so traces are readable |
| `FLY_API_TOKEN_NONPROD` | (same as above) | `fly logs` on the preview it just deployed |
| `PREVIEW_BASE_URL` | injected per run | Point the e2e suite at the right deployment |

## D. Operate the repository

| Variable | Notes |
|---|---|
| `GITHUB_TOKEN` | Provided automatically inside Actions. Sufficient for status checks and comments |
| `GH_PAT_BOARD` | Only if agents must move board cards or create issues from CI. **Fine-grained PAT, this repo only**, Issues + Projects write. Not needed while a human runs `gh` locally |

## E. Run the agents themselves, unattended

| Variable | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | Required only if agents execute **inside CI** rather than from your machine. Until then, skip it — it is a spend surface with no gate on it |

---

## Never given to an agent, in any environment

- Stripe **live** keys, and the live account's dashboard
- The **production** Neon key or database URL
- The **production** Fly deploy token
- The production `DATA_ENCRYPTION_KEY` / `LOOKUP_HASH_PEPPER`
- Domain registrar, DNS, or any billing console
- Anything belonging to the work GitHub account (`docs/board/IDENTITY.md`)

Production deploys are a manual, approved step by design. An agent proposing a release is fine; an
agent performing one is not.

## Hygiene rules that come with these

1. **Least privilege per token.** A deploy token, not an org token. A restricted Stripe key, not the
   secret key. A Pages+R2 token, not the global key.
2. **One token per environment.** A preview must never be able to reach staging or production.
3. **Rotate on a schedule and after any exposure.** Rotation procedure lives with `OPS-17`.
4. **CI logs are public-ish.** Mask everything; never `echo` a variable, even to debug.
5. **`.env.example` carries names only.** An agent that adds a variable adds it there, with a comment
   saying where the value comes from — never the value.

---

## Open items — these three have no decision yet

| Question | Why it matters | Suggested |
|---|---|---|
| **Shared cache / rate-limit store?** Production runs ≥2 Fly machines, so in-memory rate limiting is per-machine and leaky. Also needed for the emergency broadcast fan-out | `REDIS_URL` would be needed | Upstash Redis free tier |
| **Virus scanning for licence uploads** (`W8-T01` requires it) — no provider chosen | `CLAMAV_URL` or a scanning API key | Self-hosted ClamAV sidecar, or skip scanning in preview only |
| **Bot protection on signup** | An open marketplace signup will be abused | Cloudflare Turnstile — free, already on Cloudflare |
