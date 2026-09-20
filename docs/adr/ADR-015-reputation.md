# ADR-015: Reputation — two numbers that are allowed to disagree, and the tags that decide between them

## Status
Proposed — 2026-09-20 · implemented across `W8-T05`, `W8-T06`, `W3-T05`, `W4-T03`, `W4-T07`.
Supplies the per-trade standing [ADR-014](ADR-014-who-pays.md) §4.1 requires. Widens
[`BD-10`](../../TODO.md) — *"minimum reviews before an average is shown"* is now a threshold **per
trade**, and there is more than one average.

**No thresholds or vocabulary are fixed here.** `N`, and the tag list itself, are the operator's.
What this ADR fixes is the *shape*: what is measured, what is allowed to disagree with what, and
what is never published.

---

## Summary — five decisions

1. **Two scores, measuring different things.** *Satisfaction* with the person, and *competence* per
   trade. They may disagree, and when they do, neither is wrong.
2. **Competence is per trade, scored in its own row.** No catch-all average is derived by blurring
   them together.
3. **A trade with no reviews is absent from every average** — never a zero, never a midpoint.
4. **Attributes are tags, they are optional, and they are positive only.** "Tidy", "quiet", "on
   time". There is no button that publishes an accusation.
5. **The platform does not weight them.** It shows what it has; which attribute matters is the
   client's situation, not the platform's opinion.

---

## Context

`ADR-014` §4 made position depend on merit rather than money, and §4.1 narrowed "merit" to *the
rating in this job's trades*. That left a question it could not answer: **what is a rating here?**

The existing answer is one `Decimal` column, `ProviderProfile.ratingAvg`, fed by nothing — `W8-T05`
has not shipped, so no review exists. The definition is still free, which is the good luck this ADR
spends.

### The operator's three arguments, in order

They arrived as three refusals of designs that were on the table, each sharper than the last.

**One number per provider hides the trade that matters:**

> i can be a 5 stars plumbers, with 5 stars jobs. But i get 3 on electricity: if a client have to
> change electical installation at home, it is worth to contact me?

**One rating spread across a job's trades is the same fault, one level down.** The proposal was to
attribute a single review to every category the job named, to spare the client extra taps:

> better different rows and different scoring. A score that catch all might be easier to read, but
> hide real bottlenecks

**And absence is not mediocrity:**

> I'm a plumber with 5 on plumbing and absolutely no review on climatization installation […] The
> average is not 2.5, and should not be

Then the reframe that produced this document rather than a formula:

> Let's build something different then, why copy. An overall 'satisfaction' rate, which we can show
> as is, and different rating for categories. Probably the 'satisfaction' is most important: i could
> be the best electrician in the world, doing things in half the time, but leaving a mess behind me.
> How would the next user know?

## 1. Satisfaction and competence are different measurements

| | Measures | Scope |
|---|---|---|
| **Satisfaction** | what it was like to have this person do work in your home | the provider |
| **Competence** | whether the work in this trade was good | the provider **per category** |

**They are allowed to disagree, and the disagreement is the most useful thing the system knows.**
The operator's electrician — twice as fast, technically excellent, leaves a mess — is a 5 on
competence and a low satisfaction, and both numbers are honest. A model that reconciles them into
one figure destroys exactly the information the next client needs.

Neither is derived from the other. Satisfaction is **asked directly and shown as given**, never
computed by averaging category scores.

## 2. Competence is scored per trade, in its own row

A review of a job that named three trades carries **up to three competence scores**, each in its own
row, **each optional**.

Optional is what keeps §1's honesty affordable. A client who noticed the tiling and has no opinion
about the wiring rates the tiling, and the wiring stays unrated — which is a true statement. Forcing
three scores to get one is the policing `W4-T01` §1.1 ruled out, and it would manufacture opinions
that do not exist, which is worse than missing data because it looks like data.

**Attribution follows the job's categories, not the provider's.** `W4-T03` lets a provider quote a
trade they do not list, so a provider who keeps doing electrical work badly accrues a low
`electricidad` score whether or not they ever claimed the trade. That is deliberate and it is what
makes the score hard to game by editing a profile.

## 3. Absence is absence

A trade with no scores is **excluded from every aggregate**. Not zero, not 2.5, not "average".

This is the rule `W3-T05` already applies to search — *a provider with no rating sorts as unrated,
never as `0.00`, because a zero would rank a brand new provider below a bad one* — applied one level
up, to the composition rather than the column.

**Where an aggregate is shown at all, it is the mean of the per-trade means**, not the mean of all
reviews. The difference decides whether a rare weakness is visible: 5.0 across 50 plumbing jobs and
3.0 across 2 electrical ones is **4.0** the first way and **4.92** the second. The second buries the
bottleneck, which is the thing §2 exists to prevent.

The cost is real and accepted: **two bad reviews in a trade somebody rarely does will visibly move
their headline number.** That is what making rare weakness legible costs, and it falls on the
provider.

**Below the display threshold, a trade is excluded from the aggregate too** — not data yet. The
threshold is `W8-T06`'s and the operator's.

## 4. Attributes are positive tags, optional, and they aggregate

Numbers cannot answer the question the operator actually posed:

> If i have a cleaner, the mess might not be a problem. If i live in a building where people
> complains about noise, the best between 2 4 stars is the one that is stated as the more silent

**No ranking can serve that**, because the weighting lives in the client's circumstances. So the
platform carries attributes and declines to weight them.

- **Tags, not sliders.** The reviewer taps what they noticed. Nothing is required.
- **Positive only.** There is a "tidy" tag and no "left a mess" tag. A provider with forty reviews
  and two `tidy` tags has told the reader what they need to know, without the platform publishing a
  negative claim about a named tradesperson's work — the same exposure ADR-013 §6 constrains for
  no-shows, avoided here entirely rather than mitigated.
- **They aggregate into counts**, so a profile reads *tidy (14) · quiet (9) · on time (18)* and two
  four-star providers can be told apart in a second rather than by reading forty reviews.
- **Free text still matters** and is not replaced. Operator: *"users will spend some times reading
  reviews […] If i need a 5k job at home, i probably will want to read who is the best for my
  particular situation."* Tags narrow the field to two; the text decides between them.

### 4.1 The vocabulary is effectively permanent

**A tag added in year two has no history behind it.** Old reviews cannot be retro-tagged, so the new
tag shows near-zero counts on every established provider and reads as a weakness they do not have.

Start with a small, deliberate set and expect to live with it. Adding is cheap only in code;
removing loses data that cannot be recovered. The list itself is the operator's, and it is worth
more thought than its size suggests.

## 5. The platform shows, and does not decide

Satisfaction, per-trade competence and tag counts are presented; the client weighs them.

This is the same rule `MEM-2026-09-20-20` records across four earlier decisions — publish the fact,
decline to enforce a conclusion. Here it has a sharper justification than usual: **the platform
cannot know whether mess matters in this house.** A weighting would not be a helpful default, it
would be a guess presented as an answer.

The one place the platform *must* choose a weighting is ADR-014 §4's ordering, because a list has an
order. There it uses competence in the job's trades and satisfaction — and the client can re-sort,
per `W4-T03`'s slice rule: **never hide the cheapest.**

---

## Consequences

**Good**

- The electrician who leaves a mess is legible, which one number could not make him.
- Per-trade competence gives ADR-014 §4.1 a real input rather than a placeholder.
- Tags give the storefront something to compare on that is neither a price nor a star, which is
  where every competitor's profile page looks identical.
- Nothing has to migrate. `ProviderProfile.ratingAvg` is fed by nothing today, so the definition is
  free.

**Bad, and accepted**

- **Optional everything means sparse everything.** Per-trade scores, per-tag counts and satisfaction
  are each thinner than one blended number would have been, and the thinnest data is on the rarest
  trades — which are the ones a client most needs help judging.
- **Positive-only tags are quieter.** A provider who leaves a mess is identified by an *absence* of
  `tidy` tags, which takes more reviews to read than a negative would, and reads as neutral to
  somebody who does not know the convention.
- **Mean-of-means is volatile for rare trades** (§3), and providers will notice and complain. They
  will be right that it is harsh; it is still the version that does not hide the bottleneck.
- **Two scores need two explanations in the UI**, and a client who does not read them will assume
  the bigger number is the important one. `W12` inherits that problem.
- **The tag vocabulary cannot be undone** (§4.1).
- **Cold start, again** (ADR-014 §7): none of this exists at launch.

**Open — each with an owner, none blocking `W4-T04`**

1. The tag vocabulary, and how many (§4.1) — operator. Worth deliberate time.
2. The display threshold `N`, per trade (§3) — operator, with `W8-T06`.
3. Whether satisfaction is one score or a small fixed set (punctuality, communication, cleanliness)
   — operator. This ADR assumes one, on friction grounds.
4. Whether tags are universal or per-trade — *noise* matters for a builder and not a locksmith.
   Universal to start, because per-trade multiplies the vocabulary problem in §4.1.
5. The `SearchResultSchema` change, so a card found by searching one trade stops showing a global
   average (ADR-014 §4.1) — `agent-discovery` and `agent-contracts`, with `W8-T06`.
