-- W1-T05 §5.7 — the four closed sets.
--
-- Postgres enums rather than check-constrained text: adding a value is `ALTER TYPE ... ADD VALUE`
-- and removing one is a rewrite, which is the right asymmetry for a set that only ever grows.
-- Prisma generates TypeScript unions from them, so the API layer inherits the constraint.
--
-- MANITAS/PRO appears only in provider_kind. It is deliberately absent from user_role: the same
-- fact in two columns is two columns that can disagree, and the reader that suffers is W3-T08
-- licence gating (spec §4.2).

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('CLIENT', 'PROVIDER', 'ADMIN');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "provider_kind" AS ENUM ('MANITAS', 'PRO');

-- CreateEnum
CREATE TYPE "locale" AS ENUM ('ES', 'EN');
