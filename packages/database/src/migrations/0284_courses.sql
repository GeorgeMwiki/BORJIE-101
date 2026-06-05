-- =============================================================================
-- Migration 0284 — AI-generated mining courses (owner-cockpit create-course).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Borjie's owner cockpit can generate a tailored mining course on demand: the
-- operator picks a domain (mine operations / licensing & compliance / royalties
-- & finance / safety & reliability / offtake & commercial / investment &
-- strategy), describes their situation, optionally attaches documents, and the
-- brain (or the deterministic ESTATE_CONCEPTS sequencer) generates a 5-to-8
-- lesson course. This migration adds the three tables backing the surface
-- (owner-web /training/create-course + /training/course/[id]), reached via
-- /api/v1/courses/*.
--
-- Ported from the BossNyumba course-gen stack (itself a LitFin borrower
-- learning-generator port) and retargeted real-estate -> mining.
--
-- Tables:
--   * courses            — one row per generated course. The validated
--                          curriculum snapshot lives in
--                          ai_generated_curriculum jsonb. A `draft` row with
--                          lesson_count 0 and NULL generation_error is "still
--                          generating"; a `draft` row WITH generation_error is
--                          "failed" (the status CHECK has no failed value).
--   * course_lessons     — normalised per-lesson rows for per-lesson progress.
--   * course_documents   — the documents the learner attached as grounding.
--
-- TENANT SCOPE (CLAUDE.md hard rule — mirrors mig 0280/0281/0282/0283):
--   tenant_id is TEXT; FORCE ROW LEVEL SECURITY + a tenant policy on the
--   canonical `app.current_tenant_id` GUC (the GUC the api-gateway
--   databaseMiddleware binds). The compare is bare (no cast) because tenant_id
--   is already TEXT. NEVER the legacy app.tenant_id. Every row also carries
--   created_by_user_id so the route can defend-in-depth scope to the signed-in
--   operator (no IDOR across cockpit users).
--
-- HONEST-DEGRADE (CLAUDE.md hard rule): generated_via records whether the brain
-- ('llm') or the deterministic catalog sequencer ('deterministic') produced the
-- curriculum, so the UI can be transparent. Content is never silently
-- fabricated.
--
-- CURRENCY NEUTRALITY (CLAUDE.md hard rule): NOTHING here hard-codes a
-- jurisdiction currency. Any money figures live inside the jsonb curriculum as
-- plain numbers; the surface formats with formatCurrency at render time.
--
-- FRESH-DB SAFETY / IDEMPOTENCY (CLAUDE.md hard rule: migrations are immutable
-- + forward-only). Every object uses CREATE TABLE IF NOT EXISTS / guarded
-- DO-blocks (pg_constraint / pg_policies checks) / CREATE (UNIQUE) INDEX IF NOT
-- EXISTS, and a pg_roles guard around the anon REVOKE. On a fully-migrated DB
-- this is a pure no-op; on a fresh / partially-applied DB it stands the tables
-- up correctly secured. course_lessons + course_documents FK to courses with
-- ON DELETE CASCADE (a deleted course removes its lessons + document links).
-- References only pre-existing infra (pgcrypto for gen_random_uuid).
--
-- Companion files:
--   * packages/database/src/schemas/courses.schema.ts
--   * packages/ai-copilot/src/courses/* (generator + deterministic sequencer)
--   * services/api-gateway/src/services/courses/* + routes/courses.hono.ts
--   * packages/api-client/src/services/courses.ts (+ courses.types.ts)
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- courses
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS courses (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                text        NOT NULL,
  created_by_user_id       text        NOT NULL,
  domain                   text        NOT NULL,
  scenario_description     text        NOT NULL DEFAULT '',
  status                   text        NOT NULL DEFAULT 'draft',
  difficulty               text        NOT NULL DEFAULT 'beginner',
  language                 text        NOT NULL DEFAULT 'en',
  ai_generated_curriculum  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  lesson_count             integer     NOT NULL DEFAULT 0,
  generated_via            text,
  generation_error         text,
  document_ids             jsonb       NOT NULL DEFAULT '[]'::jsonb,
  completed_at             timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'courses_status_chk'
  ) THEN
    ALTER TABLE courses
      ADD CONSTRAINT courses_status_chk
      CHECK (status IN ('draft', 'in_progress', 'completed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'courses_difficulty_chk'
  ) THEN
    ALTER TABLE courses
      ADD CONSTRAINT courses_difficulty_chk
      CHECK (difficulty IN ('beginner', 'intermediate', 'advanced'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'courses_language_chk'
  ) THEN
    ALTER TABLE courses
      ADD CONSTRAINT courses_language_chk
      CHECK (language IN ('en', 'sw'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'courses_generated_via_chk'
  ) THEN
    ALTER TABLE courses
      ADD CONSTRAINT courses_generated_via_chk
      CHECK (generated_via IS NULL OR generated_via IN ('llm', 'deterministic'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'courses_lesson_count_chk'
  ) THEN
    ALTER TABLE courses
      ADD CONSTRAINT courses_lesson_count_chk
      CHECK (lesson_count >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS courses_tenant_owner_created
  ON courses (tenant_id, created_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS courses_tenant_status
  ON courses (tenant_id, status);

ALTER TABLE courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE courses FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'courses'
       AND policyname = 'courses_tenant_isolation'
  ) THEN
    CREATE POLICY courses_tenant_isolation
      ON courses
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- course_lessons
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS course_lessons (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  course_id           uuid        NOT NULL
                        REFERENCES courses(id) ON DELETE CASCADE,
  created_by_user_id  text        NOT NULL,
  lesson_number       integer     NOT NULL,
  lesson_title        text        NOT NULL DEFAULT '',
  lesson_content      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status              text        NOT NULL DEFAULT 'not_started',
  quiz_score          integer,
  completed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_lessons_status_chk'
  ) THEN
    ALTER TABLE course_lessons
      ADD CONSTRAINT course_lessons_status_chk
      CHECK (status IN ('not_started', 'in_progress', 'completed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_lessons_quiz_score_chk'
  ) THEN
    ALTER TABLE course_lessons
      ADD CONSTRAINT course_lessons_quiz_score_chk
      CHECK (quiz_score IS NULL OR (quiz_score >= 0 AND quiz_score <= 100));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_lessons_course_number_uq'
  ) THEN
    ALTER TABLE course_lessons
      ADD CONSTRAINT course_lessons_course_number_uq
      UNIQUE (course_id, lesson_number);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS course_lessons_tenant_course
  ON course_lessons (tenant_id, course_id);

ALTER TABLE course_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_lessons FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'course_lessons'
       AND policyname = 'course_lessons_tenant_isolation'
  ) THEN
    CREATE POLICY course_lessons_tenant_isolation
      ON course_lessons
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- course_documents
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS course_documents (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text        NOT NULL,
  course_id           uuid        NOT NULL
                        REFERENCES courses(id) ON DELETE CASCADE,
  created_by_user_id  text        NOT NULL,
  document_id         text        NOT NULL,
  document_name       text        NOT NULL DEFAULT '',
  document_type       text        NOT NULL DEFAULT '',
  extracted_data      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS course_documents_tenant_course
  ON course_documents (tenant_id, course_id);

ALTER TABLE course_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_documents FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'course_documents'
       AND policyname = 'course_documents_tenant_isolation'
  ) THEN
    CREATE POLICY course_documents_tenant_isolation
      ON course_documents
      FOR ALL
      USING (tenant_id = current_setting('app.current_tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Lock down the anon role (Supabase-only; guarded for vanilla Postgres / CI).
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.courses FROM anon;';
    EXECUTE 'REVOKE ALL ON public.course_lessons FROM anon;';
    EXECUTE 'REVOKE ALL ON public.course_documents FROM anon;';
  END IF;
END $$;

COMMIT;
