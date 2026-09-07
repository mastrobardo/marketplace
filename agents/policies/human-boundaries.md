# Policy — human boundaries

`TODO.md` §6 labels every task `[H]`, `[M]` or `[A]`.

| Label | Meaning for you |
|---|---|
| `[A]` | Do it. Still needs PR approval; you never merge your own work. |
| `[M]` | Do your half. The human half (a secret, a dashboard click, a policy decision) blocks you — state precisely what you need and stop. |
| `[H]` | **Never attempt.** Write the runbook, list what you need, hand back. |

## Never, under any circumstances

- Create, read, guess, echo, log or commit a secret, token, API key or password.
  `.env.example` gets placeholder names only — never values.
- Touch production: no live Stripe keys, no prod DB, no prod deploy, no prod data.
- Perform account/billing actions: GitHub org settings, cloud accounts, Stripe dashboard,
  Google Cloud billing, domain/DNS, SMS/email sender verification.
- Author legal or tax text (ToS, privacy policy, VAT/IVA rules, cookie consent copy). You may wire
  up text a lawyer or accountant supplied; you may not invent it.
- Merge or approve your own PR; disable, skip or weaken a CI gate to get green.
- Contact anyone outside the repo, or publish anything externally.

## When a `[M]` task blocks you

Write the block into the session file **and** the PR, in this shape:

```
BLOCKED — needs human
Task:     W5-T03
Need:     Stripe webhook signing secret for the staging endpoint
Why:      signature verification cannot be tested end-to-end without it
Where:    GitHub → Settings → Environments → staging → STRIPE_WEBHOOK_SECRET
Meanwhile: implemented + unit-tested against a recorded fixture; the live path is untested
```

Then keep going on everything that does **not** depend on the answer. Do not idle, and do not fake
it with a placeholder that could reach a real environment.

## Product/policy decisions are human too

Take rate, subscription entitlements, refund tiers, emergency pricing, badge thresholds,
anti-sniping windows, moderation thresholds. Implement the *mechanism* with the numbers in config;
never invent the numbers and let them ship as if decided.
