# Spec — W0-T02 local stack

|               |                                                      |
| ------------- | ---------------------------------------------------- |
| **Task**      | `W0-T02` `[A]`                                       |
| **Slice**     | S0 Platform                                          |
| **Owner**     | `agent-devops`                                       |
| **Reviewers** | `agent-contracts`, `agent-qa`                        |
| **Issue**     | https://github.com/mastrobardo/marketplace/issues/34 |
| **Status**    | draft                                                |

---

## 1. Purpose

Thirteen slice agents are about to write code that talks to a database with geography types, sends
transactional mail, and stores uploaded files. `docs/adr/ADR-006` puts all three on paid managed
services — Neon, an SMTP provider, Cloudflare R2 — and gives every PR its own Neon branch. None of
that exists yet, and none of it should be a prerequisite for running a test.

The people who suffer without this are the slice agents: `agent-discovery` cannot write a single
`ST_DWithin` test without PostGIS, `agent-identity` cannot assert that a verification email was
sent, and `agent-trust` cannot test licence-document upload. Today each of them would either stub
the dependency — producing tests that prove nothing — or reach for a shared cloud resource and
collide with every other agent doing the same.

This task gives them one command that produces a database with PostGIS, a mail catcher that
accepts anything and delivers nothing, and an S3-compatible object store, all on localhost, all
free, all offline.

## 2. User stories

- **As a slice agent**, I want `pnpm stack:up` to give me a PostGIS database, so that I can write
  an integration test on the first day of my slice instead of waiting for cloud credentials.
- **As a slice agent**, I want mail captured locally with a UI I can read, so that "an email was
  sent" is an assertion rather than an assumption.
- **As `agent-trust`**, I want S3-compatible storage on localhost, so that upload, EXIF-strip and
  presigned-GET paths are exercised without a Cloudflare account.
- **As the human operator**, I want the local stack to be unreachable from outside this machine,
  so that a laptop on a café network is not running an open Postgres.
- **As a developer**, I want to reset the stack to empty in one command, so that a corrupted local
  database is a 10-second problem, not a debugging session.

## 3. State machine

Not applicable — a compose file describes desired container state, it has no domain state machine.
The only lifecycle is Docker's own (`created → running → healthy`), which §7 asserts through
healthchecks rather than modelling here.

## 4. API surface

No HTTP surface of our own. The stack's public surface is the set of endpoints it binds, which
every later task depends on by number:

| Service   | Bind                | Protocol   | Purpose                                        |
| --------- | ------------------- | ---------- | ---------------------------------------------- |
| `db`      | `127.0.0.1:5432`    | PostgreSQL | Application database, PostGIS enabled          |
| `mail`    | `127.0.0.1:1025`    | SMTP       | Accepts anything, delivers nothing             |
| `mail`    | `127.0.0.1:8025`    | HTTP       | Mail UI + JSON API for test assertions         |
| `objects` | `127.0.0.1:9000`    | S3         | Object storage, R2-compatible API              |
| `objects` | `127.0.0.1:9001`    | HTTP       | Object store web console                       |

Connection strings are composed by consumers; this task does not own `.env.example` (`W0-T09`).
The values are conventional and documented in `README.md`.

## 5. Permissions matrix

Not a runtime feature. The equivalent constraint is charter ownership:

| Actor             | `docker-compose.yml`, `docker/**` | root `package.json` scripts | `tests/local-stack.test.ts` |
| ----------------- | --------------------------------- | --------------------------- | --------------------------- |
| `agent-devops`    | write                             | write                       | write                       |
| every other agent | propose only                      | propose only                | propose only                |

`docker-compose.yml` is named explicitly in the `agent-devops` charter's `owns:` list.

## 6. Error cases

| Condition                                                     | Surfaces as                                              | Expected behaviour                                                        |
| ------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| An image is floating (`:latest` or untagged)                  | the stack drifts under the developer without a commit    | test `pins every image to an explicit tag` fails                          |
| A port is bound to `0.0.0.0`                                   | Postgres reachable from the local network                | test `binds every published port to the loopback interface` fails          |
| A service has no healthcheck                                   | `docker compose up` returns before the DB accepts traffic| test `gives every long-running service a healthcheck` fails                |
| PostGIS is absent from the database                            | `ST_DWithin` fails at query time, deep inside a slice    | live test `exposes PostGIS in the application database` fails             |
| The uploads bucket does not exist                              | first upload 404s                                         | live test `creates the uploads bucket` fails                              |
| Data does not survive a restart                                | a developer loses seed state on every `stack:down`       | test `persists database and object data in named volumes` fails            |
| Mail is actually delivered to a real recipient                 | a test email reaches a real person                        | the mail service has no upstream relay configured; asserted by inspection |

## 7. Acceptance criteria

Criteria 1–7 are **static** — they read `docker-compose.yml` and run everywhere, including CI with
no Docker daemon. Criteria 8–12 are **live** — they run against a stack that is actually up, and
are gated behind `STACK_LIVE=1` so the default suite stays fast and daemon-free.

1. **Given** the repo root, **when** `docker-compose.yml` is parsed, **then** it declares exactly
   the services `db`, `mail` and `objects` (plus one short-lived bucket-provisioning container),
   and no service is missing.
2. **Given** every service, **when** its `image` is read, **then** it carries an explicit version
   tag that is not `latest`.
3. **Given** every published port, **when** its host binding is read, **then** it is bound to
   `127.0.0.1`, never `0.0.0.0` and never a bare `"5432:5432"`.
4. **Given** every long-running service, **when** its definition is read, **then** it declares a
   `healthcheck`, and the bucket-provisioning container declares
   `depends_on: { objects: { condition: service_healthy } }`.
5. **Given** the database and object-store services, **when** their volumes are read, **then** each
   persists its data directory into a **named** volume declared in the top-level `volumes:` key —
   not a bind mount into the working tree.
6. **Given** `docker-compose.yml`, **when** it is scanned for credentials, **then** every value is
   an obvious local-development placeholder, and no value matches a real-secret shape (an AWS key
   id, a Stripe key, a JWT, a GitHub token).
7. **Given** the repo root `package.json`, **when** its scripts are read, **then** `stack:up`,
   `stack:down`, `stack:reset` and `stack:logs` exist and `stack:up` waits for health rather than
   returning immediately.
8. **Given** a running stack, **when** I connect to the application database, **then** the
   connection succeeds as the application user against the application database.
9. **Given** a running stack, **when** I run `SELECT postgis_version()`, **then** it returns a
   version — PostGIS is installed **and** the extension is enabled in the application database,
   not merely available on disk.
10. **Given** a running stack, **when** I `GET` the mail service's message API, **then** it
    responds with a message list, and after an SMTP submission the list contains that message —
    proving mail is captured rather than relayed.
11. **Given** a running stack, **when** I `GET` the object store's health endpoint, **then** it
    reports live, and the `marketplace-uploads` bucket exists.
12. **Given** a running stack, **when** `docker compose ps` is read, **then** every long-running
    service reports `healthy`.

## 8. Data

No Prisma models and no migrations — `W0-T05` owns the first schema. This task creates the empty
database and enables the `postgis` extension inside it, which is a prerequisite of that migration:
Prisma cannot create an extension it does not have superuser rights to install, so it is done once
at container initialisation.

## 9. Out of scope

- **`.env.example`** — `W0-T09`. Nothing here reads a `.env` file; compose carries its own local
  defaults inline.
- **Prisma, migrations and seed data** — `W0-T05`. The database this task creates is empty.
- **`testcontainers`** — `TODO.md` §7 puts per-test throwaway Postgres behind testcontainers, owned
  by the slice agent writing the integration test. This task gives them the long-lived stack they
  develop against; the two coexist.
- **The API and web containers.** Both apps run on the host with hot reload. Containerising them is
  `W0-T07`'s job (Fly), and doing it here would double every agent's rebuild time.
- **Redis, a queue, a search index.** Nothing in the MVP needs one yet. When something does, it is
  added by the slice that needs it.
- **CI wiring.** `W0-T06` decides whether these services run as GitHub Actions service containers.
  This task only guarantees the static criteria pass without a Docker daemon, so CI is not blocked.

## 10. Open questions

None blocking. Two decisions taken by the owning agent and recorded so a reviewer does not re-open
them — both are image-choice deviations from the literal wording of `TODO.md` §6, with evidence:

- **Mailpit replaces MailHog.** MailHog was archived by its author and its last release
  (`v1.0.1`) ships a single-architecture `amd64` image. On the operator's arm64 machine that runs
  under emulation. Mailpit is the maintained successor, publishes `arm64`, and speaks the same
  SMTP-catcher + JSON-API shape the acceptance criteria need.
- **`imresamu/postgis` replaces `postgis/postgis`.** The `postgis/postgis` images are `amd64`-only;
  `imresamu/postgis` is the multi-architecture build published by the same maintainer and linked
  from `postgis/docker-postgis` as the arm64 source. Revisit when `postgis/postgis` publishes
  `arm64` itself.
