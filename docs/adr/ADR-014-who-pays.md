# ADR-014: Who pays — the demand side, and why the queue is never for sale

## Status
Proposed — 2026-09-20 · implemented across `W4-T03`, `W4-T04`, `W4-T07`, `W5-T07`, `W5-T08`, `W6`,
`W8-T04`, `W13`. Rewrites [`BD-02`](../../TODO.md) and [`BD-03`](../../TODO.md), and answers
`W13`'s *"which side subscribes"*. Companion: [ADR-013](ADR-013-engagement-reconciliation.md),
which covers the money inside a single engagement.

**Pricing is not decided here.** Every figure below is the operator's own illustration. What this
ADR fixes is *who pays*, *for what*, and *what money is not allowed to buy*.

---

## Summary — six decisions

1. **A professional never pays to quote.** Not for the lead, not for priority, not for visibility.
2. **The demand side pays** — *una tantum* for a free account, or included in a subscription.
3. **A client is charged for quotes that arrive**, never for quotes that might.
4. **Nobody is blocked from answering a job.** What the client buys changes *prominence*, not
   permission.
5. **Priority and prominence are earned and cannot be bought.** This is the load-bearing decision:
   selling the queue is the exact mechanism that broke every incumbent here.
6. **Search is never paywalled** — radius, filters and the map stay free for everyone.

---

## Context

### The incumbent model, and the operator's own research

Spanish platforms in this market run the freelancer.com pattern: the professional buys credits and
spends them to apply for a job. The operator tested it from the demand side — posting real requests
and watching what happened — and reports the result plainly:

> nowaday ALL the platforms force the professional to spend credits to apply to a presupuesto. They
> work as freelance.com. This is a scam: all the professional i know spent a lot of money last year
> to get literally 0 job. Just to stay on the platform. […] i did some research, post a couple of
> job requests, and professionals SPENT MONEY JUST TO APPLY.

**The failure is structural, not a matter of price**, and the operator names the mechanism:

> credits system doesnt work, also because almost all platforms here in spain are pushed by big
> companies that can cover all the jobs

That is the whole diagnosis. Credits do not fail because they are expensive. They fail because
**they let capital buy the queue.** A firm with a budget and staff watching a mailbox takes every
lead; the autónomo cannot outspend them, gets nothing, and leaves. The platform's revenue is
maximised by *applications*, so its incentives point at more bidding and worse odds — which is why
the thing being sold gets worse the more of it there is.

### What follows from taking that seriously

If the disease is "money buys the queue", then **no paid feature may sell position in it** — not
credits, not a priority pipeline, not a head start. A cheaper version of the same mechanism is the
same mechanism. §4 is where this bites, because the obvious provider-revenue line rebuilds it.

## 1. A professional never pays to quote

Quoting is free, unlimited by price, and always will be. `W4-T03` shipped it that way by accident of
sequencing; this ADR makes it a decision.

The cost is real and is accepted: **the platform gives up the easiest revenue line in the market**,
the one every competitor runs on. What it buys is the only differentiator that cannot be copied by a
competitor who is already taking that money — a professional who is not being charged to lose.

## 2. The demand side pays, and only for what arrives

> Auction and presupuestos will be paid: either included in the subscription of clients, or paid una
> tantum for free accounts. […] i can pay 1 euro to get 5 presupuestos, or 10 to open an auction:
> the burden is on who wants the job done.

And the justification, which is also the pitch:

> They will spend those money anyway, in time or telephone bills, if they go for with normal ways.
> Better to spend a small fee, get valid contacts, where valid means vetted by the platform and by
> the users, than just spend time and maybe get people who cannot really do the job.

**The unit of charge is a quote that actually arrived.** An allowance of five is consumed one quote
at a time as quotes come in; a request that attracts two costs two, and a request that attracts none
costs nothing.

This is not generosity, it is the same rule as §1 pointed the other way. *"Spent money and got
literally 0 jobs"* is the thing this product exists to refuse. A client who pays for five and
receives nothing has been sold exactly that, and no amount of it being a smaller sum makes it a
different promise.

## 3. Nobody is blocked — prominence is what differs

The first draft of this model capped answers at whatever the client had paid for. The operator
rejected it while writing it down:

> i paid for 5 qualified quotes, but is it really ok to block other to apply? Better to frame a bit
> different […] the first 5 will be evident, while the rest a bit more hidden (ie: 5 cards the
> firsts, a list for the seconds)

**Right, and for a reason worth recording:** a sixth professional turned away has been told the
platform is full, which is the incumbent's scarcity in a new costume. A sixth professional listed
below the fold has been told the truth — this job already has good answers, and yours can still be
read.

So the purchase buys **curation, not exclusivity**: a prominent set the platform stands behind, with
everything else visible underneath it.

## 4. Priority is earned, never bought

The operator's own proposal, offered in the same message as the diagnosis:

> the email thing could be part of a priority pipeline: You know first, you pay the PLUS provider
> fee, u get the email 3 hours before the job post is opened to everyone. I think here we are
> juggling on a bit of a grayzone

**It is not a grey zone, and the diagnosis in Context settles it.** Every firm that can cover all
the jobs buys that fee; almost no autónomo does; three hours on every job in the country is the
queue, sold, with a different name on the invoice. On an `urgente` job it is not a head start, it is
the entire job.

**So the head start exists, and it is earned:**

| Earns position | Why it is not purchasable |
|---|---|
| completion rate | you cannot buy having turned up |
| response time | `W8-T04`'s `FAST_RESPONDER`, already in the backlog |
| no-show record | ADR-013 §6 already computes it |
| verified licence in a gated trade | `W8-T01`/`W8-T02`, and it is the client's protection |
| fit — category match, distance, availability | it is about this job, not about this month's budget |

A reliable electrician gets a head start a national chain cannot buy. **The client gets a better
answer, so quality is what the platform is selling rather than what it is trading away.**

The same ordering decides §3's prominent five. The operator's word was *"5 **qualified** quotes"* —
qualified is not the same as fastest to answer, and first-come ordering rewards whoever has staff
watching a mailbox, which is the big firms again. `W4-T03`'s slice rule already says it for the
comparison screen: **sort by rating then price, the client may re-sort, never hide the cheapest.**

### 4.1 And "rating" means the rating **in this job's trades**

A single average over everything is the wrong input to §4, and the operator's example is the
argument:

> i can be a 5 stars plumbers, with 5 stars jobs. But i get 3 on electricity: if a client have to
> change electical installation at home, it is worth to contact me?

**A 5-star plumber gets no head start on an electrical job.** Priority and prominence read the
provider's standing in the categories *this job names*, never a global figure — which would hide the
weakness exactly when a provider is strong everywhere else, and hide it hardest for the trade the
client is actually asking about.

`W4-T03`'s `coverage` is already the right shape for this: a per-job-category list carrying
`listedByProvider` and `requiresLicence`, to which a per-trade standing is one more field.

**How those ratings are produced is not decided here** — it is a reputation model rather than a
pricing one, and it has its own document. See ADR-015.

One consequence reaches shipped work: `GET /api/search` sorts by **distance**, so no ranking
changes — but every result card shows the provider's *global* `ratingAvg` while the search itself is
filtered to one trade. A client searching `electricidad` therefore sees a plumber's plumbing score.
That is the exact blur this section removes, and fixing it is a change to the frozen
`SearchResultSchema`, so it belongs to `agent-discovery` and `agent-contracts` with `W8-T06`.

## 5. What is never behind a paywall

> radius and other parameters are not and should not be behind a paywall

Search, filters, radius and the map are free, for everyone, permanently. A visitor who cannot find a
plumber has not been upsold, they have been sent to a competitor — and a marketplace that degrades
discovery to sell it back has stopped being a marketplace.

This is a **constraint on future tickets**, recorded because `BD-03` previously listed "radius" as a
tier benefit and somebody will suggest it again.

## 6. The tiers, provisional

The operator's sketch, recorded as a shape rather than a price list:

| Tier | Gets |
|---|---|
| Free | pays *una tantum* per request or auction |
| Regular | 5 quotes or 1 auction included |
| Administrador de fincas | unlimited, plus "payback" |

**`administrador de fincas` is the strongest channel here** — they commission repairs constantly,
for buildings, all year. It is also the one with a compliance shape to get right: a payment to the
person who selects the supplier *on behalf of the comunidad de propietarios* is a commission, and an
undisclosed one is a conflict with duties they already owe. Two safe forms, same revenue:
**disclose it to the comunidad**, or make it a **discount to the comunidad** rather than a payment to
the administrator. Picked deliberately, not discovered at the first complaint. `R1`.

## 7. Merit needs history, and at launch there is none

**The cold start is the obvious hole in §4** and is written down so it is designed rather than
discovered: on day one no provider has a completion rate, a review or a no-show record, so
merit-ordering has nothing to order by and silently degenerates into whatever the tiebreak is.

Until history exists, position comes from the parts of §4's table that do not need it — **fit**
(category match, distance, availability) and **verified licence**, which is earned on day one by
uploading a document. Response time accrues within days and can take over early. `W3-T05` already
faces the same problem for search ranking and answers it the same way: a provider with no rating
sorts as *unrated*, never as zero.

## 8. Where this leaves the other money

Three revenue moments now exist, and ADR-013 §4 described only the second:

| Moment | Who pays | Decided in |
|---|---|---|
| Asking — a quote request or an auction | client | **this ADR** |
| The call-out fee, released when work starts | client | ADR-013 §4 |
| Unlocking a direct contact | client, likely | `W13`, undecided |

ADR-013's *"Platform revenues is on the start of work"* is true of an engagement and is **not** the
whole revenue model; §4 of that ADR is amended to say so.

The **handshake** (ADR-013 §3) is not specific to quotes: it attests the start of work for anything
that produces an engagement — presupuestos, auctions, and a contact unlock if `W13` builds one.

---

## Consequences

**Good**

- The differentiator is structural rather than promotional: a competitor funded by supply-side
  credits cannot copy this without giving up its revenue.
- Platform incentives point at *fewer, better* answers. The incumbent earns more from more bidding;
  this earns more from bidding that works.
- `W8`'s badges stop being decoration. Completion rate, response time and the no-show record become
  the currency of position, which gives `W8-T04` a reason to exist beyond a rosette.

**Bad, and accepted**

- **The easiest revenue line in this market is given up**, and revenue now depends on demand-side
  volume that does not exist yet. This is a bet that the constraint is worth more than the income.
- **Merit ordering is a ranking system, and ranking systems are gamed.** Response time in particular
  rewards whoever can answer instantly, which drifts back toward firms with staff. It needs
  measuring against outcomes, not just speed.
- **§7's cold start means the principle is inactive exactly when first impressions are formed.**
- **No email, no model.** The notification pipeline this depends on needs a mail provider, and
  `OPS-14` is an open human task. It has been promoted from an annoyance to a blocker.
- **Charging per arriving quote is harder to build** than charging upfront: it is metering, not a
  purchase, and it interacts with withdrawal (`W4-T03`'s `WITHDRAWN`) and expiry in ways `W5-T08`
  has to specify. A withdrawn quote almost certainly must not consume an allowance.

**Open — none blocking `W4-T04`**

1. Every price. Operator, and `W5-T07` creates the Stripe products.
2. The `administrador de fincas` payback shape — disclosure or discount (§6). Operator, then `R1`.
3. What "qualified" means precisely for the prominent five — a threshold, or simply the top five of
   the existing sort (§3, §4).
4. Whether a professional ever pays for anything at all. §1 forbids paying for *position*; it does
   not forbid, say, a portfolio feature. The safe test: **would a firm with a budget end up ahead of
   a better small provider?** If yes, it is the queue again.
5. Whether a withdrawn or expired quote refunds the allowance (Consequences, above) — `W5-T08`.
6. The contact-unlock fee — `W13`.
