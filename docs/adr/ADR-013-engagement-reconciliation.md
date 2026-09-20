# ADR-013: The engagement — three sources of truth, and what makes leaving the platform cost something

## Status
Proposed — 2026-09-20 · implemented across `W4-T05`, `W4-T09`, `W5-T02`, `W5-T05`, `W5-T11`.
`W5-T04` (completion → capture → transfer) is **superseded**: nothing happens at completion. Answers [`BD-01`](../../TODO.md) (the escrow keystone) and the detection half of
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
3. **Revenue is realised when work starts, not when it finishes.** The client pays at award to bring
   the professional to their door; approving the start releases it. Nothing waits on completion.
4. **The job's own price never touches the platform.** One payment passes through, and it is the
   call-out. What the work costs is settled between the two people, in whatever way they choose —
   §4.1.
5. **Refunding a client and banning a professional are different decisions and get different bars.**
   A no-show claim always refunds. It flags on the first upheld claim and bans on the second, and
   the professional can contest it before either.
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

## 4. The money: one payment, and it is the call-out

| Moment | What happens | Where the money is |
|---|---|---|
| **Award** | the client pays a fee to bring the professional to their door | captured, held by Stripe |
| **Approval** — the handshake | the client confirms the professional arrived and work may start. **The fee releases, and the platform's revenue is realised here** | → platform + professional |
| **Cancel**, any time before approval | forfeited in full, and split the same way (§5) | → platform + professional |
| **No-show** (§6) | refunded to the client, and a finding is raised | → client |
| **Completion** | *nothing happens here.* The platform has already been paid | — |

**Revenue is at the start of work.** Operator, 2026-09-20: *"Platform revenues is on the start of
work."* That single sentence removes escrow, removes the completion transfer, and removes most of
what §8 originally worried about — if the platform is paid when work begins, a pair that goes
off-platform afterwards costs it nothing.

**Amended 2026-09-20 by [ADR-014](ADR-014-who-pays.md):** that sentence is true of *an engagement*
and is not the whole revenue model. The client also pays to **ask** — a quote request or an auction,
*una tantum* or from a subscription allowance — before any of the table above happens, and a contact
unlock may be a third moment (`W13`). Read this section as "the money inside one engagement", not as
"the platform's income".

**The platform never takes possession**, and the scope of that is now much narrower than "we hold
funds in Stripe": the only money that passes through is the call-out fee, which is the platform's
own charge and the professional's own compensation for turning up. `R1` still confirms the shape
before `M8`, but it is a shorter conversation than escrow would have been.

**One technical constraint, to verify in `W5-T02` rather than assume here:** card authorizations
expire after roughly a week, so the fee is **captured** at award rather than held as an
authorization — a job booked three weeks out would otherwise lose its hold before anyone arrives.
Confirm against current Stripe documentation; this ADR states the shape, not the API.

**Why approval is the right moment, and not completion.** It is the last point at which the platform
has evidence of anything. Before it, the handshake proves both people were there; after it, the
platform sees nothing and should not pretend otherwise (§4.1). Charging at completion would mean
charging for an event only one party reports.

### 4.1 What the platform does not see, and will not police

After approval, what the work costs and how it is settled is between the client and the
professional. They may agree on cash. Operator, 2026-09-20:

> after that moment, it is not really enforceable in any way, and should be in that way: maybe both
> parties agrees on a black money kind of agreement. I cannot and i should not enforce a correct
> facturation. This is up to them.

**This is a decision, not an oversight**, and it is recorded so nobody later builds a feature that
assumes the platform knows the job's value. It does not. A quote is a number two people agreed on
here; it is not a receipt, and nothing reconciles against it.

**Separately, and for `R1` / `W5-T09` rather than for this ADR:** not policing the parties' invoices
is one question, and whether the platform has *its own* reporting obligations as a facilitator of
services — the DAC7 regime — is another. How far those reach when the consideration never passes
through the platform is worth asking an accountant now. It is cheap before the first tax year and
expensive after it.

## 5. Cancellation forfeits the fee, in full

**Operator's decision, 2026-09-20: all or nothing.** A client who cancels after awarding loses the
fee, whether they cancel ten minutes later or the night before.

This was argued against once; the argument is recorded in Consequences rather than as a caveat on
the decision, because it is a product call and it has been made.

**What remains open is the split, and it turns out to be one question with two triggers.** The same
two claimants divide the same fee whether it is *released* at approval (§4) or *forfeited* at
cancellation:

- the platform's revenue, and
- the professional's reserved time — a real loss, and one that grows the closer to the date it is
  taken away.

Operator: *"How to divide them ( platform costs vs reservation of time of professional ) is still up
for a serious plan i still didnt have time to model"*. `W5-T05` owns it, and modelling it once
answers both moments.

Any share reaching the professional is **a payout for work not done** — a cancellation fee with its
own IVA treatment and its own line on a payout statement, which belongs on `W5-T09`'s list for the
accountant rather than being discovered at invoicing.

## 6. The no-show, and why refunding is not banning

The case: the client pays, the professional never appears. There is no handshake, because there was
nobody to scan.

**The evidence is the absence.** A booking whose scheduled start has passed with no approval is the
condition under which a client may claim a no-show.

**The client is refunded, always, and immediately.** It is a call-out fee, the money has gone
nowhere else, and making somebody argue for it is a bad experience at the worst moment. The bar for
this is deliberately low.

**Banning the professional is a different decision and gets a different bar**, because the costs are
not comparable. Refunding a false claim costs the platform a call-out fee — the price of doing
business. Removing a tradesperson costs them their income here, cannot be undone by an apology, and
is the decision that gets contested. Same trigger, same evidence, different consequence:

| Upheld claim | Consequence |
|---|---|
| 1st | **public flag** — it stays visible, and clients decide for themselves |
| 2nd | **ban** |

That matches the operator's bar — *"a professional not showing 1 or 2 time will be banned. Dont need
unreliable or scammy people here. Quality / Precision / On time approach is what we want to push"* —
and their earlier preference for visibility over quiet removal: *"or better, HE WILL STAYS FLAGGED
on the platform so other clients will be aware."*

Note the professional is already penalised at the first incident without any of this: they lose the
call-out fee. The economic consequence exists before the account is touched.

**A low threshold is survivable only if verification is cheap.** The professional gets a window to
contest, and needs something to contest *with*:

- an **arrival attestation** from their side — *"I'm here"*, location-stamped, before the window
  closes — so a claim against somebody demonstrably outside the door is contradicted by evidence
  rather than by their word;
- their in-app messages (*"I'm outside, no answer"*), which are timestamped already.

Without that, a two-strike ban rests on unverified claims, and §"Consequences" explains why that is
the exposure rather than the quality bar.

### 6.1 The claim runs both ways

The fraud vector inverts once approval is what releases the money: **the client now has a reason to
refuse it.** Let the professional arrive, decline to approve, claim a no-show, take the refund, and
offer cash for the work.

The professional's defence is structural — *no approval, no work* — and it holds because it is their
own fee at stake, not a norm the platform has to teach.

**But the detector cannot be symmetric, and the reason is base rates.** Operator, 2026-09-20:

> there will be probably less than 1% of clients trying to scam the platform, cause less than 1% of
> users will need to remode their bathrooms 4 times per year

A client transacts rarely, so a malicious one never accumulates enough events for any pattern to
notice. **Pattern detection does not work on clients — with one exception, which the operator named
in the same breath:** owners of multiple properties, who transact often *and* are the segment most
likely to try it. A repeat-claim counter catches precisely the clients who are able to scam
repeatedly, and costs the other 99% nothing. That, and the evidence requirement above, is the whole
client-side defence. It is deliberately thinner than the professional-side one.

## 7. The ladder, and where it stops today

| Rung | Trigger | Status |
|---|---|---|
| Recorded | any finding | **built with `W5-T11`** |
| Refund | a no-show claim | **unconditional, §6** |
| Warning | a leakage finding against a party | **today's ceiling for leakage** |
| Public flag | 1st upheld no-show (professional) | `W4-T09` / `W8` |
| Ban | 2nd upheld no-show (professional) | `W4-T09` / `W8` |
| Repeat-claim review | a client claiming no-show repeatedly (§6.1) | `W9` |
| Freeze both accounts | — | **named, not built** |

Operator, 2026-09-20, on the last rung: *"both account will probably be frozen. For now, just a
warning, not sure about the marketing / business strategy still."*

**It is recorded as unset rather than implied.** Freezing an account freezes payouts, so a freeze on
a heuristic takes money from somebody whose only provable act was cancelling a job — and the
heuristic cannot tell "went offline" from "changed their mind". The no-show ladder above is
different in kind: it rests on a specific claim about a specific appointment, contestable with
evidence, not on an inference about intent.

## 8. What leakage actually looks like now

Revenue at the start of work (§4) collapses this section. **The pair that goes off-platform after
approval has already paid** — it is no longer a revenue event, only a gap in the data.

One signature is left that costs the platform money:

| Signature | Reading | Noise level |
|---|---|---|
| Fee paid, **never approved**, and the work happened anyway | the introduction was used and the start was never declared | invisible on its own — see below |

It is the hardest one to see, because from the platform's side it is indistinguishable from a job
that was simply called off. What makes it visible is repetition: the same client and professional
awarding and never approving more than once, or a professional whose bookings are approved far less
often than the platform median.

The rest demote from revenue protection to **data quality**, and they matter for the reconciler
rather than for the ladder:

- approved, then neither completed nor cancelled — an engagement nobody closed;
- completed with no approval behind it — a state set that no handshake supports, which is a defect
  in this codebase before it is a claim about anyone.

**The unit of suspicion is the pair and the rate, never the single event.** One cancellation is
weather.

## 9. The lever nobody labelled

`W8-T05` already says reviews come **only after a completed paid booking**. Filed as a trust
feature, it does more than trust work: a professional's reputation is the asset they are building
here, and an engagement that never reached approval grows it by exactly zero.

With revenue taken at the start of work (§4), this stops being a revenue control and becomes
something arguably more important — **the reason to declare the start at all**. The professional
wants the approval because it releases their fee; they want the *completion* because it is the only
path to a review.

**It is recorded here so that it is not relaxed by accident.** "Let clients review any job, we need
more reviews" is a reasonable-sounding growth proposal that would quietly remove a revenue control.

---

## Consequences

**Good**

- `BD-01` is answered and the answer is smaller than either option in that row: the job's money
  never enters the platform, so there is nothing to hold and nothing to be regulated for.
- Revenue no longer depends on an engagement completing, which removes the platform's exposure to
  the leak the operator was worried about. It becomes a data problem, not a money one.
- **The handshake is self-enforcing.** Approval releases the professional's fee, so insisting on it
  is them protecting their own money rather than a rule the platform has to police. That was the
  weakest point in this design's first draft.
- `IN_PROGRESS` is attestable, which is what made "both, and cross-verified" buildable.
- Detection reuses `W5-T11` rather than adding machinery.

**Bad, and accepted**

- **All-or-nothing forfeiture is the shape most likely to be challenged.** A fee kept in full
  whether the client cancels ten minutes or three weeks before is the pattern Spanish consumer law
  treats as an abusive clause, and time-tiered forfeiture — which `W5-T05` originally assumed — is
  the defensible version. The operator has decided; `R1` should look here specifically, and the size
  of the fee is what makes it survivable or not.
- **A two-strike ban rests on claims the platform cannot verify by itself.** §6's arrival
  attestation is what turns word-against-word into evidence, and it is a *requirement* of the low
  threshold rather than an enhancement of it. Built without it, a professional's income here can be
  ended by two clients who never had to prove anything.
- **The client side is deliberately under-defended.** Base rates make pattern detection useless
  against someone who transacts once (§6.1), so a first false claim is absorbed by design: the
  refund is paid and the professional is flagged rather than removed. That asymmetry is the price of
  the quality bar, and it is chosen rather than overlooked.
- **A public flag is defamation-adjacent.** Contestable, appealable via `W8-T07`, and time-bounded
  reduce the exposure; they do not remove it.
- **The platform cannot report on what it cannot see** (§4.1). That is the operator's decision about
  the parties' own invoicing, and it is separate from the platform's own obligations, which `R1`
  and `W5-T09` still owe an answer on.
- `W4-T05` is blocked on `W5-T02`, which lengthens the path to a working funnel.

**Open — each with an owner, none blocking `W4-T03`**

1. The split of the fee between platform and professional, at both triggers (§5) — `W5-T05`, needs
   the business model.
2. The contest window, and what evidence upholds or overturns a no-show claim (§6) — `W4-T09`.
3. The repeat-claim threshold for clients (§6.1) — operator, and only meaningful once there is
   enough traffic to measure a median.
4. Authorization expiry and the exact Stripe flow (§4) — `W5-T02`, verify against current docs.
5. The platform's own facilitator reporting obligations (§4.1) — `R1` / `W5-T09`.
6. Whether a subscription changes any of this — `W13`, which owns the access half.
