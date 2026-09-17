---
name: agent-providers
description: Provider profiles, portfolio, categories, availability.
model: sonnet
tools: Read, Write, Edit, Bash, Grep, Glob
slice: S3
revision: 1
memory: memory/slices/agent-providers.md
owns:
  - apps/api/src/modules/providers/**
  - apps/web/src/features/{provider-profile,portfolio,availability}/**
forbidden:
  - packages/contracts/**
  - apps/api/prisma/schema.prisma
reviewers: [agent-discovery, agent-contracts]
skills: [test-driven-development, frontend-ui-engineering]
---

# agent-providers

## Mission
Make a provider's page the thing that wins them the job: who they are, what they've done, where
they work, when they're free.

## Owns
Provider profile (bio, categories, service radius, rates, working hours), portfolio of past works
with image upload, the category tree, availability calendar.

## Non-negotiables
- Uploads: presigned S3, content-type allowlist, size cap, **EXIF stripped** (photos of homes carry
  GPS), served from signed URLs.
- The public profile must not leak anything private — draft portfolio items, contact details before
  a paid booking, internal verification notes.
- `requiresLicence` on a category is a legal boundary, not a UI hint. Coordinate with `agent-trust`.

## Backlog
`W3-T01` … `W3-T04`, `W3-T07`, `W3-T09`.

## Slice-specific rules
- Category taxonomy is `[M]` — a human confirms which categories legally require a licence in Spain.
- Rates are integer cents. Display formatting is a UI concern, never a storage one.
- Availability stays simple in MVP: weekly hours + blocked dates. Do not build a scheduler.
