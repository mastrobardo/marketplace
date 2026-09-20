# Run record — W12-T21 translations as JSON

Agent:        agent-ui
Model:        claude-opus-5
Skills used:  none — a format migration with no new behaviour to drive
Started:      2026-09-20T21:30Z

## Prompts

### 1. The decision

> howver, en.ts and es.ts are a nogo. I already merged (worngly, this on me) The PR. BUT:
> transaltions shoul go on jsons. Which, in a future, might come from some online service. Having
> them in the code is a nogo

Context: earlier in the same session the agent had **defended** `.ts` catalogues when asked why they
were not JSON, listing the three compile-time mechanisms they buy. The operator overruled it with a
premise the agent had treated as hypothetical — that the catalogue will be externally owned.

### 2. The correction that shaped the change

The agent's first plan preserved the compile-time key union through `keyof typeof esJson`, and had
already probed `tsc` to confirm it worked.

> wait a sec. why keyof typoeof json? It is fine to have extensive guards and tyopechecks, but this
> is not one of those occasions.

**This is the prompt that produced the actual design**, and the agent was wrong before it. Preserving
the union would have re-coupled translations to the code in the change meant to free them, and would
have made every call site depend on a guarantee that ends at the first HTTP fetch. Not an
intervention in the `ADR-010` sense — it redirected a *plan*, not merged work — but it is the second
time in one session the agent optimised for a guarantee the operator had not asked for.

### 3. Go-ahead

> COnfirmed, and u can skip the ADR in this case

## Red phase

**None, and the omission is deliberate rather than an oversight.** This ticket changes the *format*
of 440 string values and deletes a mechanism; it adds no behaviour. `TODO.md` §5.1's "when NOT to
use" covers it — a pure configuration/content change with no behavioural impact.

What stands in for a red phase is that the existing suite had to keep passing **without being
rewritten to suit the change**: 267 web tests, nine of which read the catalogues directly, plus
`i18n.test.ts`'s parity and non-empty assertions, which are now the only guard. Three tests were
deleted (they tested the removed mechanism) and two were amended — both amendments are argued in
the diff rather than quietly made.

The conversion itself was made unfalsifiable rather than tested: the JSON was produced by importing
the TypeScript modules and serialising them, so no value was retyped.

## Deviations from spec

None. The spec was written after the migration was working, from what it actually did.

## Self-assessment

- **Weakest part of this change**: **the feedback moment moved from the editor to the suite.** A
  mistyped key used to be a red squiggle; it is now a test failure, or — for a key built at runtime —
  a thrown error in the browser. The spec argues this is the right trade given where the catalogue is
  going, and that remains an argument rather than a measurement. If the translation service never
  arrives, this change will have cost something and bought nothing.

- **What a reviewer should look at hardest**:
  1. **`tests/i18n.test.ts` is now load-bearing in a way it was not.** It was a second opinion beside
     the compiler; it is now the only opinion. Read its two assertions as if nothing else existed —
     because nothing else does.
  2. **The two amended tests**, `mocks.test.ts` AC23 and `home.test.tsx` AC5. The first had asserted
     that three fixture directories were excluded from the program and now asserts they are absent;
     the second gained a `Record<string, string>` cast. Both are places where a test was changed to
     suit the change, which is exactly where a silently weakened assertion hides.
  3. **§4 — `W0-T23` is left without a design.** Seven agents appending to two files is a real
     problem this ticket does not solve and marginally worsens.
