-- =============================================================================
-- Down-migration 0284 — reverse AI-generated mining courses.
--
-- Dev/staging only. Dropping these tables loses every generated course, every
-- normalised lesson row, and every attached-document link. A production
-- rollback must export these tables first if any course rows are retained for
-- credentialing / training-record purposes.
--
-- Reverses migration 0284_courses.sql. course_lessons + course_documents FK to
-- courses (ON DELETE CASCADE), so we drop dependents first.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS course_documents_tenant_isolation ON course_documents;
DROP POLICY IF EXISTS course_lessons_tenant_isolation   ON course_lessons;
DROP POLICY IF EXISTS courses_tenant_isolation          ON courses;

DROP INDEX IF EXISTS course_documents_tenant_course;
DROP INDEX IF EXISTS course_lessons_tenant_course;
DROP INDEX IF EXISTS courses_tenant_status;
DROP INDEX IF EXISTS courses_tenant_owner_created;

DROP TABLE IF EXISTS course_documents;
DROP TABLE IF EXISTS course_lessons;
DROP TABLE IF EXISTS courses;

COMMIT;
