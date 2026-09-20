-- W4-T02 §2.1 — the way out of OPEN.
--
-- `W4-T01` declared OPEN terminal and said, in the machine and in this folder's predecessor, that
-- the declaration was a statement about that ticket rather than about the product. This migration
-- is the other half of that promise: OPEN leaves `jobMachine.terminal` in the same change that
-- gives it somewhere to go.
--
-- **One value, not four.** AWARDED, IN_PROGRESS and COMPLETED are still absent, and each is owned
-- by the ticket that can produce it — `W4-T05` once a quote can be accepted, then the booking
-- lifecycle in `W5`, where completion is what triggers capture. See
-- `docs/specs/S4/W4-T02-job-state-machine.md` §6.1 for the table and the question it carries.
--
-- Safe in one transaction on PG 12+ (the stack is 17, ADR-006): a new enum value may be *added*
-- inside a transaction block, it just may not be *used* in the same one. Nothing below writes
-- 'CANCELLED' — if a future migration needs to, it needs its own file.

-- AlterEnum
ALTER TYPE "job_status" ADD VALUE 'CANCELLED';

-- AlterTable
--
-- Mirrors `published_at`: the timestamp a list screen needs without joining `audit_record`. The
-- cancellation *reason* is deliberately not a column — it goes to `audit_record.metadata`, so the
-- fact has one home instead of two that can disagree (§2.5).
ALTER TABLE "job" ADD COLUMN "cancelled_at" TIMESTAMPTZ(3);
