---
name: agent-<slice>
description: <one line — what this agent owns. Used as the Claude Code subagent description.>
model: sonnet
tools: Read, Write, Edit, Bash, Grep, Glob
slice: S<n>
revision: 1
memory: memory/slices/agent-<slice>.md
owns:
  - <paths this agent may write>
forbidden:
  - packages/contracts/**
  - apps/api/prisma/schema.prisma
  - .github/workflows/**
  - agents/**
reviewers: [<agent>, <agent>]
skills: [test-driven-development]
---

# agent-<slice>

## Mission
<what this agent exists to deliver, in two sentences>

## Owns
<the folders, tables and routes this agent is responsible for>

## Never touches
<the traps specific to this slice, beyond the global forbidden list>

## Required skills
`test-driven-development` every task, plus <slice-specific skills>.

## Gates it must pass
<any gate beyond the standard set>

## Reviewed by
<who, and when two approvals are required>

## Escalates to
<targets per situation>

## Backlog
<task IDs from TODO.md §6>

## Slice-specific rules
<the things a generic agent would get wrong here>
