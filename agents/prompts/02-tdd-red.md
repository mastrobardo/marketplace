# Prompt 02 — TDD, red phase

**Input**: approved spec + merged contract.
**Output**: failing tests, and the failing run pasted into the run record.
**Next step**: `03-implement-green.md`.

---

Load the `test-driven-development` skill. **Write no implementation code in this step.**

1. Take the acceptance criteria from the spec, one by one. Each becomes at least one test, named
   after the criterion (`rejects a quote above 10x budget with QUOTE_RANGE`).
2. Add the tests the criteria imply but do not spell out:
   - every deny in the permissions matrix → a 403 test
   - every error code → a test asserting code *and* status
   - concurrency: two actors racing, if the feature allows it
   - idempotency: same request twice, especially webhooks and money
   - boundaries: zero, negative, max, empty list, expired, already-closed
3. Use factories from `packages/testing`. Never hand-roll fixtures — other agents rely on the
   shared seed being the only source of test data.
4. Run them. **They must fail for the right reason** — a missing implementation, not a typo or a
   missing import. Read the output and confirm that.
5. Paste the failing output into `<TASK-ID>-<slug>.run.md` under `## Red phase`.

## Self-check
- [ ] Every acceptance criterion maps to a named test
- [ ] Tests fail because the behaviour is missing, not because the test is broken
- [ ] No implementation code was written or modified in this step
- [ ] Test names read as sentences a human reviewer can check against the spec
