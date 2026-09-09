# Compile-failure fixtures

Each directory is a tiny TypeScript project compiled by `tests/i18n.test.ts`. The assertion is
`tsc`'s **exit code**, which is the only way to prove the claim "a missing translation key fails
the build" rather than assert it in prose.

| Fixture | Must | Because |
|---|---|---|
| `valid` | compile | otherwise the other two prove nothing — a check that always fails is not a check |
| `unknown-key` | fail | `t()` with a key no catalogue defines |
| `incomplete-catalogue` | fail | a catalogue omitting a key `es.ts` defines |

They are excluded from `apps/web/tsconfig.json`, so `pnpm typecheck` does not try to compile the
two that are supposed to fail.
