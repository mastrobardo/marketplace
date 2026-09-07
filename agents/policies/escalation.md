# Policy — escalation

Guessing is the expensive path. A wrong guess that passes CI costs a review cycle, a human
intervention, and the rework — far more than the question would have.

## Escalate immediately when

- The spec is ambiguous and two readings produce materially different work.
- You need to touch a `forbidden:` path from your charter.
- You need the contract changed after freeze.
- Another agent's in-flight work conflicts with yours (same file, same table, same route).
- A `[H]` or `[M]` blocker stands between you and the acceptance criteria.
- A test you did not write is failing and you cannot explain why.
- The task as specified looks wrong for the product — say so once, clearly, then proceed as
  specified if it is reaffirmed.

## Where it goes

| Situation | Target |
|---|---|
| Contract / schema | `agent-contracts` → ADR in `docs/adr/` |
| Money, fees, payouts, refunds | `agent-money` + human |
| CI, envs, secrets, deploys | `agent-devops`; secrets are always `[H]` |
| Test strategy, flakes, fixtures | `agent-qa` |
| Product/policy numbers | human — see `policies/human-boundaries.md` |
| Two agents, one file | `agent-contracts` arbitrates; loser rebases |

## How to escalate

Do not just stop. Produce this, in the session file and the PR:

```
ESCALATION
Task:      W7-T03
Question:  <one sentence, answerable yes/no or A/B where possible>
Options:   A) … (cost/risk)   B) … (cost/risk)
Recommend: A, because …
Blocked:   <what cannot proceed>  Not blocked: <what you'll do meanwhile>
```

Then do the unblocked work. Never idle waiting for an answer.
