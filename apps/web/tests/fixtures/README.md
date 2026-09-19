# Test fixtures

Two unrelated things share this directory, and the `tsconfig.json` exclude is what keeps them
apart.

## The mock world — `catalogue.ts`, `search.ts`, `provider.ts`

The five Madrid providers the storefront was built against, built from the `packages/testing`
factories. They used to live in `apps/web/mocks/` and feed an MSW handler; `W3-T01` deleted MSW
whole, and these three moved here because `tests/app-harness.tsx` stubs `ApiClient` from them for
every component test. `W12-T11` split `search.ts` and `provider.ts` out of `catalogue.ts` so the
stub and the handler could not disagree about which providers match, in what order, with what facet
counts — and with the handler gone, they are simply the one definition.

**They are typechecked**, unlike the three directories below, and `tests/mocks.test.ts` asserts that
the exclude names those directories rather than this one.

## Compile-failure fixtures

Each directory is a tiny TypeScript project compiled by `tests/i18n.test.ts`. The assertion is
`tsc`'s **exit code**, which is the only way to prove the claim "a missing translation key fails
the build" rather than assert it in prose.

| Fixture | Must | Because |
|---|---|---|
| `valid` | compile | otherwise the other two prove nothing — a check that always fails is not a check |
| `unknown-key` | fail | `t()` with a key no catalogue defines |
| `incomplete-catalogue` | fail | a catalogue omitting a key `es.ts` defines |

Each of the three directories is named individually in `apps/web/tsconfig.json`'s `exclude`, so
`pnpm typecheck` does not try to compile the two that are supposed to fail. The exclude used to name
this whole directory — `W3-T01` narrowed it when the mock world moved in, because a directory whose
name means *not typechecked* is the wrong place to put code the component harness imports.
