# ADR-013: The engagement — three sources of truth, and what makes leaving the platform cost something

## Status
Proposed — 2026-09-20 · implemented across `W4-T05`, `W4-T09`, `W5-T02`, `W5-T04`, `W5-T05`,
`W5-T11`. Answers [`BD-01`](../../TODO.md) (the escrow keystone) and the detection half of
[`BD-08`](../../TODO.md). Companion: `W13`'s ADR, not yet written, which owns the *access* half —
who may contact whom, and what a subscription unlocks.

**Not a legal opinion.** §4 describes a money flow chosen to avoid the platform ever holding client
funds. `R1` legal review before `M8` is where that is confirmed by somebody qualified.

---

## Summary — six decisions

1. **A job and its booking each keep their own lifecycle. Neither derives from the other.** They are
   reconciled asynchronously, and **divergence is evidence, not a bug to prevent**.
2. **A third source of truth outranks both: the handshake.** When work starts, the client scans a
   code on the professional's device. It takes two people in one place, so neither can produce it
   alone — which is what makes `IN_PROGRESS` *attested* rather than claimed.
3. **Money makes leaving expensive; detection is the backstop.** Awarding costs a fee upfront, and
   cancelling forfeits it. The reconciler exists to catch what the price does not deter.
4. **The platform never holds client funds.** Stripe does. The platform directs money and keeps none
   of it in transit, which is how this stays a marketplace rather than a financial institution.
5. **A professional who takes money and never appears gets flagged on a pattern, not on one
   incident** — and the flag is appealable and expires. One disputed claim must not publicly mark
   somebody's livelihood.
6. **The consequence ladder ends in a human.** A finding is a warning today. Freezing accounts is
   named as a future rung with an evidence bar attached, not shipped on a heuristic.

---

## Context

`W4-T02` declared `CANCELLED` and deliberately stopped, because `AWARDED`, `IN_PROGRESS` and
`COMPLETED` had nothing that could produce them. Deciding what produces them turned out to require
answering a question the backlog had already filed as the keystone — `BD-01`, *"do we hold client
funds until job completion?"* — and a second one nobody had connected to it.

**The second question is the one that matters commercially.** Operator, 2026-09-20:

> people could start a work, cancel it, continue the work offline without informing the platform. I
> need a mechanism to make this hard ( not completely unavoidable because real life is not 100%
> enforceable )

That is `R4` — disintermediation — and until now the only answer filed against it was contact
masking (`W4-T08`, superseded) and *"measure the leak rate"* with no method. `W13`'s brief assumed
the method would be reading messages, *"given messages are the place people paste a phone number
anyway"*.

**Reading messages is the wrong instrument.** It is evadable by anyone who writes *llámame al seis
tres cuatro…*, and it inspects private conversations to solve a revenue problem. What cannot be
spelled around is the economic footprint: two people were introduced here, money was supposed to
move, and it did not.

## 1. Three sources of truth

| Source | Says | Owned by | Can one party fake it? |
|---|---|---|---|
| `Job.status` | what the client says is happening | `agent-jobs` | yes — the client alone |
| `Booking` + ledger | what money says happened | `agent-money` | no, but it **lags** reality |
| **The handshake** | that both people were in one place | `W4-T09` | no — it takes both |

The first two disagree constantly and innocently: a webhook arrives late, a capture retries, Stripe
has an incident. **That is why they are reconciled rather than coupled** — see §2. The third is
different in kind, and it is the anchor the other two are read against.

## 2. Reconciled, not coupled

A job does **not** need its booking's permission to change state, and a booking does not need the
job's.

The alternative — a job that cannot be completed until the money says captured — sounds safer and is
worse. Money lags reality by seconds on a good day and hours on a bad one, so coupling means a
professional who genuinely finished the work cannot close the job because a webhook is behind. That
is the platform punishing the wrong party for its own plumbing, and the support burden lands on the
people who did nothing wrong.

Instead, a reconciler compares the three sources on a schedule and writes a **finding** when they
disagree. This is not new machinery: `W5-T11` is already *"reconciliation job + alert on any
mismatch"*. It gains a second dimension — lifecycle against money, not only ledger against Stripe.

**A finding is a claim about the platform's own consistency first, and about people second.** Most
divergence is a defect in this codebase. The reconciler must therefore distinguish the two, or its
output becomes noise and stops being read — the ordinary way reconciliation alerting dies.

## 3. The handshake

When the professional starts work, the client scans a code the professional presents.

Wallapop's release-on-confirmation is the reference the operator gave, and the mechanism is the same
idea moved from delivery to arrival: a moment both parties must be present for, which the platform
can trust because neither can manufacture it alone.

**It is both a payment step and an attestation.** The scan captures the balance (§4) and moves the
engagement to `IN_PROGRESS`. A job that reaches completion with no scan behind it is, by
construction, a job whose start nobody can vouch for.

**Security requirements, which this fails quietly without:**

- **Single-use**, so a code cannot be replayed for a second booking.
- **Short-lived** — minutes, not days. A code valid for a week is a code that can be sent by
  WhatsApp from somewhere else entirely.
- **Bound to one booking**, and refused against any other.
- **Redeemed by the counterparty's authenticated session.** The client scanning proves the *client*
  was there. A code that is merely a URL is one the professional can scan themselves, which removes
  the only property that made the handshake worth building.

## 4. The money, and why the platform is not a financial entity

| Moment | What happens | Who holds the money |
|---|---|---|
| **Award** | the client pays a small fee upfront. Captured, not held | Stripe |
| **Cancel, any time after award** | the fee is forfeited in full (§5) | Stripe → split, `W5-T05` |
| **Handshake** | the balance is captured | Stripe |
| **Completion** | the balance transfers to the professional, less the platform fee | → professional |
| **No-show** (§6) | the fee is refunded to the client, and a finding is raised | → client |

**The platform never takes possession.** Funds sit with Stripe between capture and transfer, and the
platform directs where they go rather than keeping them and paying out from its own balance. That
distinction is the whole reason this shape was chosen over an escrow account, and it is what `R1`
must confirm before `M8`.

**One technical constraint, to verify in `W5-T02` rather than assume here:** card authorizations
expire after roughly a week. A hold therefore **cannot** cover work scheduled three weeks out, which
rules out "authorize everything at award and capture later" — the model `W5-T02` currently implies
with *"PaymentIntent (manual capture)"*. Capturing the upfront fee for real, and handling the
balance as a separate charge and transfer, avoids the expiry entirely. Confirm against current
Stripe documentation before building; this ADR states the shape, not the API.

**Consequences for tickets already written**, spelled out because they are easy to miss:

- `W4-T05` (award) **cannot ship before `W5-T02`.** Awarding now moves money, so the job lifecycle's
  next state depends on Stripe existing. It was previously only a hand-off.
- `W5-T04` becomes *completion → **transfer***. The capture moved to the handshake.
- `W5-T02`'s manual-capture assumption is superseded by the table above.

## 5. Cancellation forfeits the fee, in full

**Operator's decision, 2026-09-20: all or nothing.** A client who cancels after awarding loses the
upfront fee, whether they cancel ten minutes later or the night before.

This was argued against once, and the argument is recorded in Consequences rather than as a caveat
on the decision, because it is a product call and it has been made.

**What remains open is the split**, and it is genuinely unmodelled — operator: *"How to divide them
( platform costs vs reservation of time of professional ) is still up for a serious plan i still
didnt have time to model"*. Two claimants on one forfeited amount:

- the platform's own cost of the transaction, and
- the professional's reserved time, which is a real loss and grows the closer to the date it happens.

`W5-T05` owns it. Note that any share reaching the professional is **a payout for work not done** —
a cancellation fee with its own IVA treatment and its own line on a payout statement, which belongs
on `W5-T09`'s list for the accountant rather than being discovered at invoicing.

## 6. The no-show, and the flag

The case: the client pays, the professional never appears. There is no handshake, because there was
nobody to scan.

**The evidence is the absence.** A booking whose scheduled start has passed with no handshake is the
condition under which a client may claim a no-show, and the claim is cheap to honour because the
money has not moved beyond the fee.

- The fee is **refunded** to the client.
- A **finding** is recorded against the professional.
- The professional is **flagged publicly on a pattern — N findings within a window — not on the
  first.** `N` and the window are unset; the operator sets them.

**Why not the first incident.** Operator: *"HE WILL STAYS FLAGGED on the platform so other clients
will be aware"* — the flag is public, and that is the point of it. But the obvious attack on this
design is a client who falsely claims a no-show: they get their money back and damage somebody who
was standing outside a locked door. On a pattern rule a malicious client gets one shot; on a
first-incident rule they get a public mark on a stranger's livelihood.

**The flag is the highest-liability element in this ADR.** It is personal data, published, about a
named professional's reliability. It must therefore be derived from a verified event rather than a
score, **appealable** through the trail `W8-T07` already plans, and **time-bounded** — a permanent
public mark from one disputed period is the version that ends up in front of a lawyer.

## 7. The ladder, and where it stops today

| Rung | Trigger | Status |
|---|---|---|
| Recorded | any finding | **built with `W5-T11`** |
| Warning | a finding against a party | **today's ceiling** |
| Public flag | N no-show findings in a window (§6) | `W4-T09` / `W8` |
| Ranking or feature effect | repeated leakage signatures | unspecified |
| Freeze both accounts | — | **named, not built** |

Operator, 2026-09-20, on the last rung: *"both account will probably be frozen. For now, just a
warning, not sure about the marketing / business strategy still."*

**It is recorded as unset rather than implied.** Freezing an account freezes payouts, so a freeze on
a heuristic takes money from somebody whose only provable act was cancelling a job — and the
heuristic cannot tell "went offline" from "changed their mind". Before that rung is built it needs a
named evidence bar, a human deciding it, and the appeal path. Writing the bar down now costs
nothing; reconstructing it after the first wrongly frozen tradesperson does not.

## 8. What leakage actually looks like now

The upfront fee changes the signatures. "Awarded but nothing was paid" is no longer suspicious — it
is impossible, because award *is* a payment.

| Signature | Reading | Noise level |
|---|---|---|
| `COMPLETED`, no balance captured | **our** pipeline broke, or a state was set that money never backed | rare — alarm |
| Fee paid, **no handshake**, cancelled | either a no-show (§6) or an introduction that went offline before starting | high — pattern only |
| Fee paid, **handshake**, then cancelled without completion | work began and the engagement left the platform | medium — the strongest leak signal |
| Fee paid, handshake, then **silence** — no completion, no cancel | the same, with nobody bothering to close it | slowest, likely commonest |

**The unit of suspicion is the pair and the rate, never the single event.** One cancellation is
weather. The same client and professional awarding-then-cancelling twice is not, and a professional
whose awarded jobs cancel at several times the platform median is not.

## 9. The lever nobody labelled

`W8-T05` already says reviews come **only after a completed paid booking**. Filed as a trust
feature, it is also the strongest anti-leakage control in the backlog: a professional's reputation
is the asset they are building here, and off-platform work grows it by exactly zero. It turns
leaking from free money into a cost the professional pays themselves.

**It is recorded here so that it is not relaxed by accident.** "Let clients review any job, we need
more reviews" is a reasonable-sounding growth proposal that would quietly remove a revenue control.

---

## Consequences

**Good**

- `BD-01` is answered without the platform holding funds, and without the simplistic
  pay-on-completion option that leaves the client unprotected.
- `IN_PROGRESS` becomes attestable, which is what made "both, and cross-verified" buildable at all.
- Detection reuses `W5-T11` rather than adding machinery.
- The three-source model degrades honestly: if the handshake is skipped, the engagement still works
  and simply carries less evidence.

**Bad, and accepted**

- **All-or-nothing forfeiture is the shape most likely to be challenged.** A fee kept in full
  regardless of when the client cancels is the pattern Spanish consumer law treats as an abusive
  clause, and time-tiered forfeiture — which `W5-T05` already assumes — is the defensible version.
  The operator has decided; `R1` should look at this specifically, and the size of the fee is what
  makes it survivable or not.
- **Capturing the balance at the handshake gives the client a reason not to scan.** The professional
  wants the scan; the client is paying at that moment. The mitigation is that nothing works without
  it — no completion, so no review, no payment protection, no dispute standing — and the norm the
  platform must teach professionals is *no scan, no work*. The residual risk is real and stays.
- **A public flag is defamation-adjacent.** §6's safeguards reduce it; they do not remove it.
- **The reconciler will be wrong about people sometimes.** It measures money and attestation, and
  infers intent. That inference is why the ladder ends in a human.
- `W4-T05` is now blocked on `W5-T02`, which lengthens the path to a working funnel.

**Open — each with an owner, none blocking `W4-T03`**

1. `N` and the window for the flag (§6) — operator.
2. The forfeiture split (§5) — `W5-T05`, needs the business model.
3. Authorization expiry and the exact Stripe flow (§4) — `W5-T02`, verify against current docs.
4. What happens when the client simply refuses to scan — `W4-T09`.
5. Whether a subscription changes any of this — `W13`, which owns the access half.
