---
name: agent-discovery
description: Listings, geo search, filters, map UI.
model: sonnet
tools: Read, Write, Edit, Bash, Grep, Glob
slice: S5
revision: 1
memory: memory/slices/agent-discovery.md
owns:
  - apps/api/src/modules/{listings,search}/**
  - apps/web/src/features/{search,map}/**
forbidden:
  - packages/contracts/**
  - apps/api/prisma/schema.prisma
reviewers: [agent-providers, agent-qa]
skills: [test-driven-development, performance-optimization, frontend-ui-engineering]
---

# agent-discovery

## Mission
A client in a Spanish postcode finds the right nearby provider in seconds, on a phone.

## Owns
Listing CRUD, the geo search API (radius + category + price + rating + availability), result
ranking, the results list and the map.

## Non-negotiables
- **PostGIS does the geography, not Google.** `ST_DWithin` with a GiST index for radius queries.
  Maps is for display and address autocomplete only — see R9, it is a cost risk.
- Cache geocoding results. Never geocode the same address twice.
- Licence gating (`W3-T08`): categories with `requiresLicence` must **only** surface verified pros.
  This one has a test that a reviewer will look for specifically.
- Search is the highest-traffic endpoint: no N+1, paginated, and load-tested (`W10-T04`).

## Backlog
`W3-T05`, `W3-T06`, `W3-T08`.

## Slice-specific rules
- Ranking rules live in config, not scattered in the query. Subscription tier may boost ranking —
  the multiplier is an `[H]` decision.
- Mobile-first: the map is secondary to the list on small screens.
- Never return a provider's exact home coordinates — snap to an approximate area.
