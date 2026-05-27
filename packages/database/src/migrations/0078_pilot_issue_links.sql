-- =============================================================================
-- Migration 0078 — Pilot Issue Links (Wave PILOT-TRIAGE)
--
-- Companion to:
--   - services/consolidation-worker/src/tasks/sentry-to-github.ts
--   - services/api-gateway/src/routes/sentry-webhook.hono.ts
--   - Docs/ON_CALL.md
--
-- Persona: Mr. Mwikila (founder, single source of authority).
-- Brand: Borjie.
--
-- One table:
--
--   pilot_issue_links — one row per (sentry_fingerprint). Idempotency
--                       key for the Sentry → GitHub bridge: if a
--                       fingerprint is already in this table we skip
--                       creating a new GitHub issue and instead surface
--                       the existing one (so duplicate Sentry events
--                       don't spam the issue tracker during a pilot
--                       day-6/7 bug surge).
--
-- This table is INTENTIONALLY NOT RLS-scoped: the bridge runs as a
-- platform service against the platform schema. Sentry fingerprints
-- are not tenant-scoped (they identify error-type-level fingerprints
-- that may surface across multiple tenants in the same pilot cohort).
--
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- pilot_issue_links — fingerprint → GitHub issue de-duplication index
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pilot_issue_links (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  /** Stable Sentry issue fingerprint (e.g. SHA-1 of normalised stack frame). */
  sentry_fingerprint   text        NOT NULL UNIQUE,
  /** Full HTML URL to the GitHub Issue created by the bridge. */
  github_issue_url     text        NOT NULL,
  /** GitHub-side issue number for fast lookup without parsing URL. */
  github_issue_number  integer     NOT NULL,
  /** Pilot cohort tag from the Sentry event (`pilot_cohort:tz-pilot-1`). */
  cohort               text        NOT NULL,
  /** Sentry-reported severity at issue creation time.
      One of: 'fatal', 'error', 'warning', 'info', 'debug'. */
  severity             text        NOT NULL,
  /** Optional runbook slug linked at create-time (`mobile-auth-otp-not-received`). */
  runbook_slug         text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pil_fingerprint_nonempty_chk'
  ) THEN
    ALTER TABLE pilot_issue_links
      ADD CONSTRAINT pil_fingerprint_nonempty_chk
      CHECK (length(sentry_fingerprint) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pil_github_url_nonempty_chk'
  ) THEN
    ALTER TABLE pilot_issue_links
      ADD CONSTRAINT pil_github_url_nonempty_chk
      CHECK (length(github_issue_url) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pil_severity_chk'
  ) THEN
    ALTER TABLE pilot_issue_links
      ADD CONSTRAINT pil_severity_chk
      CHECK (severity IN ('fatal', 'error', 'warning', 'info', 'debug'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pil_cohort_nonempty_chk'
  ) THEN
    ALTER TABLE pilot_issue_links
      ADD CONSTRAINT pil_cohort_nonempty_chk
      CHECK (length(cohort) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'pil_issue_number_positive_chk'
  ) THEN
    ALTER TABLE pilot_issue_links
      ADD CONSTRAINT pil_issue_number_positive_chk
      CHECK (github_issue_number > 0);
  END IF;
END $$;

-- Hot path: bridge looks up by fingerprint to short-circuit duplicates.
-- UNIQUE on the column already gives us this index but spell it
-- explicitly for clarity.
CREATE INDEX IF NOT EXISTS idx_pil_fingerprint
  ON pilot_issue_links (sentry_fingerprint);

-- Cohort-scoped triage dashboards.
CREATE INDEX IF NOT EXISTS idx_pil_cohort_created_at
  ON pilot_issue_links (cohort, created_at DESC);

-- Severity-grouped summaries (`scripts/triage/summarize-pilot-errors.ts`).
CREATE INDEX IF NOT EXISTS idx_pil_severity_created_at
  ON pilot_issue_links (severity, created_at DESC);

COMMIT;
