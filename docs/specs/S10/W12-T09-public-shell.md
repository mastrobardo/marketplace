# W12-T09 — The public shell

Task: `W12-T09` · Slice: S10 · Owner: `agent-ui` · Issue: #209
Branch: `W12-T09-public-shell` · Run record: `W12-T09-public-shell.run.md`
Design: [ADR-011](../../adr/ADR-011-web-application-architecture.md) §1, §2, §4 **and Amendment 1** ·
Builds on [`W12-T07`](W12-T07-search-schema.md), [`W12-T08`](W12-T08-search-contract.md)

---

## 1. Purpose

Four W12 tasks are about to build pages — the home hero (`W12-T10`), the results page (`W12-T11`),
the public profile (`W12-T12`), the landings (`W12-T13`). Every one of them needs the same five
things: a URL that says which language it is in, a header with the compact search, a footer, a 404,
and a 500. Whichever lands first will invent all five, and the other three will copy whatever it
invented.

This task builds those five once. It is the same argument `W12-T07` made about the search bar, one
level up: the shell is the thing four tasks share, so it is the thing that drifts if nobody owns it.

The second half is the language. Today `apps/web` has an i18next singleton and a `<select>` that
switches it — so the address bar says `/` whether you are reading Spanish or English, a reload
silently reverts the choice, and a shared link opens in the recipient's default rather than the
sender's. `W12-T09` puts the language in the URL, which is what makes any of that work.

Who suffers without it: every storefront task from `W12-T10` on, and any visitor who sends someone a
link.

## 2. User stories

- **As a visitor**, I want to search from any page, so that changing my mind does not mean going back
  to the home page first.
- **As a visitor who shares a link**, I want the recipient to see the page in the language I was
  reading, so that the link is worth sending.
- **As a visitor reading English**, I want switching to Spanish to keep me on the page I was on, so
  that changing language is not a punishment.
- **As a keyboard or screen-reader user**, I want one skip link and named landmarks on every page,
  so that the header is not something I have to walk through on every navigation.
- **As a storefront task**, I want the shell, the route table and the data seam to already exist, so
  that I add a route rather than an architecture.
- **As a visitor who mistypes a URL**, I want a 404 that keeps the header and a way out, not a blank
  page.

## 3. State machine

The shell has no domain state. The one lifecycle worth a table is the route's, because it is what
decides between the three terminal pages:

| From | Event | To | Guard / side effect |
|---|---|---|---|
| request `/` | — | redirect `/es` | ES is the default and the fallback (`TODO.md` §1) |
| request `/:lang/*` | loader resolves | page inside the shell | `:lang` is a known locale |
| request `/:lang/*` | loader throws 404 | root `ErrorBoundary` → 404 | `:lang` is **not** a locale; the shell itself failed |
| request `/:lang/unknown` | no child matches | catch-all → 404 **inside the shell** | the shell loaded fine |
| request `/:lang/legal/unknown` | legal loader throws 404 | legal `ErrorBoundary` → 404 **inside the shell** | same reason |
| any | loader rejects | root `ErrorBoundary` → 500 + retry | distinguishable from the 404 |

The distinction in the last four rows is the whole design: **a boundary belongs at the level that
actually failed.** A 404 handled at the root costs the visitor the header, the search box and the
footer for a typo.

## 4. API surface

### 4.1 Routing

```
/                     → redirect to /es
/:lang                → shell (loader: categories)
  index               → home
  legal/:doc          → terms | privacy | cookies
  *                   → 404, inside the shell
```

**The language is a path segment; nothing after it is translated.** `/es/search`, never
`/es/buscar`. Operator decision, 2026-09-11, recorded as [ADR-011 Amendment 1] — it reverses §2's
page inventory, which spelled every route in Spanish. A localised segment buys some Spanish keyword
relevance and costs every route two spellings, a lookup table and a redirect layer; with SEO
deferred (Amendment 1.2) it buys nothing at all.

There is deliberately **no trailing `path: '*'`** beside `/:lang`. `/:lang` already matches any first
segment, so a catch-all there would be unreachable — and an unreachable route reads as handled,
which is worse than absent. An unknown language is instead a 404 thrown by the shell's own loader.

### 4.2 The data seam

`src/shared/api.ts` is the one module the storefront gets data from (ADR-011 §4). `W1-T03` (zod →
OpenAPI → typed client) has not run, so this is its stand-in: **one** module, hand-written URLs
confined to it, axios underneath, and every response parsed by the contract's own zod schema on the
way in. A hand-written client that *trusts* the wire is a second definition of the API; one that
*parses* is a consumer of the single definition and fails loudly when the endpoint drifts.

`GET /categories` had no declared shape — `W12-T08` mocked it as a supporting detail of the search
contract. This task declares `CategorySummarySchema` / `CategoryListSchema` in `packages/contracts`
and points the existing mock at them, so the handler is now checkable against a contract rather than
being its only definition. Additive and pre-freeze; nothing else reads it.

### 4.3 React Query, without breaking three route rules

Operator decision, 2026-09-11: the web app uses TanStack React Query over axios. The naive
integration — `useQuery` in a component, fetching on mount — violates **R3** outright and would make
`W12-T14` a rewrite. What ships instead:

| Rule | What it demands | How this satisfies it |
|---|---|---|
| **R3** | data comes from the loader; no fetch on mount | the `loader` calls `ensureQueryData`; the component calls `useQuery` on the same key and reads a warm cache |
| **R5** | no module-scope mutable cache | the `QueryClient` is created in `App` via `useState`, never at module scope |
| **R6** | request-scoped singletons only | it reaches loaders through React Router's `getContext`, which builds a fresh context per navigation |

R5 is not pedantry here. A module-scope `new QueryClient()` is **one cache shared by every request a
Worker serves** — R5 names that class precisely: *"one user's results served to another. This is a
data-leak class, not a bug class."* The `routeContext` token may live at module scope because it is
a key, not a value.

### 4.4 The header, the switcher, the footer

The header carries `SearchBar rendering="header"` over the concrete `what · where · when · mode`
declaration, which lives in `src/features/search/` — `W12-T07` put it there explicitly (*"the
discovery feature, a folder this agent may not touch"*). Categories are **data** from the loader, so
adding a trade is a seed change rather than a front-end deploy.

The language switcher becomes **links, not a `<select>`**, because the language is now navigation.
It replaces only the first path segment, so `/es/legal/terms?x=1` becomes `/en/legal/terms?x=1` —
sending a reader to the home page for changing language is a small cruelty that is easy to ship and
invisible when tested from the home page. Both locales stay listed, with `aria-current` on the
active one.

The footer links the three legal slots in the current language.

### 4.5 The legal slots

Terms, privacy and cookies exist as routes with headings, URLs and a visible "not published yet".
The prose is `W10-T07`, marked `[H]`: it is lawyer-drafted, and an agent writing a privacy policy is
a compliance incident with good intentions. Shipping the slots empty-but-honest beats omitting them
— footer links that 404 are a gap nobody notices until launch.

## 5. Permissions matrix

| Role | Shell | Home | Legal | 404 / 500 |
|---|---|---|---|---|
| anonymous | allow | allow | allow | allow |
| CLIENT / PROVIDER / ADMIN | allow | allow | allow | allow |

All of M11 is public (ADR-011 §2). There is no session in the storefront yet.

## 6. Error cases

| Case | Behaviour |
|---|---|
| `/` with no language | 302-equivalent client redirect to `/es` |
| `/nope` — unknown language | 404 from the shell's own boundary (the shell is what failed) |
| `/es/anything-unknown` | 404 **inside** the shell — header, search and footer retained |
| `/es/legal/nonsense` | 404 inside the shell, from the legal route's own boundary |
| `GET /categories` fails | 500 page with a **working retry** (`useRevalidator`), distinguishable from the 404 |
| Unknown locale passed to `changeLanguage` | ignored; the UI stays in the last good language |

A 404 and a 500 give different advice — *"this will never exist"* versus *"try again"* — so they are
different renderings, and the retry button appears only on the 500. Telling a visitor to retry a URL
that cannot work is worse than saying nothing.

## 7. Acceptance criteria

| # | Given / When / Then | Test |
|---|---|---|
| AC1 | Given `/`, when rendered, then the Spanish home page appears | `routing.test.tsx` |
| AC2 | Given `/nope`, when rendered, then a 404 appears, not the Spanish home page at someone else's URL | `routing.test.tsx` |
| AC3 | Given either language, when the shell renders, then the search landmark is present and named | `routing.test.tsx` |
| AC4 | Given any page, when the switcher renders, then every locale is a link and the current one carries `aria-current` | `routing.test.tsx` |
| AC5 | Given `/es/legal/terms?from=footer`, when switching to English, then the href is `/en/legal/terms?from=footer` and the page stays put | `routing.test.tsx` |
| AC6 | Given each of terms/privacy/cookies, when rendered, then the heading is in the reading language and the pending notice is shown | `routing.test.tsx` |
| AC7 | Given `/es/legal/nonsense`, when rendered, then a 404 appears **with the banner and contentinfo still present** | `routing.test.tsx` |
| AC8 | Given a failing categories request, when the shell loads, then the 500 page renders, marked `500`, distinct from the 404 | `routing.test.tsx` |
| AC9 | Given the header search, when submitted with a `where`, then the app navigates to `/:lang/search?…` | `routing.test.tsx` |
| AC10 | Given any route, when rendered, then there is exactly one `h1` | `shell.test.tsx` |
| AC11 | Given any route, when rendered, then banner/navigation/main/contentinfo all exist and **every duplicated landmark is uniquely named** | `shell.test.tsx` |
| AC12 | Given `/en`, when rendered, then `document.documentElement.lang` is `en` and the nav is English | `shell.test.tsx` |
| AC13 | Given a category summary, when parsed, then `name` is resolved and the unresolved `nameEs`/`nameEn` pair is rejected | `search.test.ts` |
| AC14 | Given a category with no `requiresLicence`, when parsed, then it fails rather than defaulting to false | `search.test.ts` |
| AC15 | Given every route module, when imported in a DOM-free node environment, then it succeeds and exports only the route contract | `route-modules.test.ts` (existing) |

## 8. Data

No migration, no Prisma change. One additive contract module (`catalogue.ts`) for a shape that was
previously implied by a mock.

## 9. Out of scope

- **The home page.** `W12-T10` replaces the placeholder with the hero search, category cards and the
  rest. This task only proves the shell renders a route.
- **The search results page.** `W12-T11`. The header search navigates to `/:lang/search`, which 404s
  until then — see §10 Q1.
- **Legal prose.** `W10-T07`, `[H]`.
- **All SEO.** No `hreflang`, no `meta`, no canonical, no JSON-LD — ADR-011 Amendment 1.2.
- **A real HTTP 404 status.** See Q2.
- **An axe pass over the shell.** Agreed with the operator on 2026-09-11 and moved to `W12-T16`,
  which is the ticket that already stands up Playwright. `W12-T04`'s gate runs axe over *stories*,
  and the shell is not a story — it is an application composition, so it cannot become one without
  mounting the router inside Storybook. Until then `shell.test.tsx` AC11 checks landmark presence
  and name-uniqueness by hand, which catches the two failures this task could plausibly introduce
  and nothing else.
- **Auth, sessions, and any authenticated shell.** There is no session in M11.

## 10. Open questions

### Q1 — the header search links to a page that does not exist

Deliberate. The alternative is a disabled control, which hides whether the schema, the query string,
the router and the locale segment actually agree until `W12-T11` — three tasks away. A 404 is a
visible, correct intermediate state; a disabled button is an invisible unknown. AC9 asserts the
navigation happens and lands on the 404.

### ESCALATION — Q2: every path returns HTTP 200, including the 404

```
ESCALATION
Task:      W12-T09
Question:  Does the soft 404 need fixing before the storefront is public, or does it wait for W12-T14?
Options:   A) Wait for W12-T14. The SSR switch is where a route can set a status code at all; a
              client-rendered SPA cannot. Zero work now.
           B) Add a Cloudflare Pages rule or a Worker that returns 404 for unmatched paths. Duplicates
              the route table outside React, which is exactly the drift W12-T07/T09 exist to prevent.
Recommend: A. It is invisible to users, matters to crawlers and uptime checks, and W12-T14 already
           owns the machinery. Noted in TODO.md against that ticket.
Blocked:   Nothing.
Not blocked: Everything.
```

Measured, not assumed: `curl` against the dev server returns `200` for `/`, `/es`, `/en/legal/terms`
**and `/nope`**. That is correct behaviour for an SPA — the server serves `index.html` for every path
and the router decides what renders — but it means the 404 is a rendering, not a status. With SEO
deferred this matters less than it did when the ADR was written, though uptime and error monitoring
still read status codes.

### Q3 — the i18n singleton is still a singleton

Unchanged and still owned by `W12-T14`. What this task adds is that the URL is now the source of
truth for language and i18next *follows* it, in an effect. So the singleton is now a cache of a
value the route already knows, which is a strictly smaller problem than it was: the conversion in
`W12-T14` has one writer to replace rather than a control to redesign.
