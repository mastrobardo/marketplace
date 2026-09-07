# Prompt 03 — implement, green phase

**Input**: failing tests from `02`.
**Output**: the minimum implementation that passes them.
**Next step**: `04-refactor.md`.

---

Make the failing tests pass. Nothing more.

Rules:
- Only files inside your charter's `owns:` paths. If you need something outside, escalate.
- API before frontend. Business logic in services, never in route handlers. No Prisma in React.
- Use the generated client on the frontend. Never hand-write a request type.
- Errors go through the shared envelope with a machine-readable code.
- Every state transition goes through the state-machine helper (`W1-T07`) so it emits an audit log.
- Anything money- or state-related gets a structured log line and a metric.
- ES + EN i18n keys for all user-visible copy.
- **No scope creep.** Found an unrelated bug? File a task; do not fix it here.
- Append to your session memory as you go — decisions, dead ends, anything your successor needs.

## Self-check
- [ ] All tests from the red phase are green
- [ ] No test was modified to make it pass
- [ ] No `any`, no `@ts-expect-error` without a linked issue
- [ ] No new file outside your `owns:` paths
- [ ] No secret, key or credential anywhere in the diff
