# Compile-failure fixtures

Each directory is a tiny TypeScript project compiled by `tests/i18n.test.ts`. The assertion is
`tsc`'s **exit code**, which is the only way to prove the claim "a missing translation key fails
the build" rather than assert it in prose.

| Fixture | Must | Because |
|---|---|---|
| `valid` | compile | otherwise the other three prove nothing — a check that always fails is not a check |
| `unknown-key` | fail | `t()` with a key no catalogue defines |
| `incomplete-catalogue` | fail | a catalogue omitting a key `es/` defines |
| `excess-key` | fail | a namespace translating a key Spanish never defined — the direction that lets the catalogues drift without either being *missing* anything |

They are excluded from `apps/web/tsconfig.json`, so `pnpm typecheck` does not try to compile the
three that are supposed to fail.
