-- =============================================================================
-- 0229: conversation_capture — Piece L brain-tab loop capture rows.
--
-- One row per "captured" user/assistant exchange the brain decided to act on.
-- A capture is the structured shadow of a chat turn: entities resolved to
-- canonical IDs, intent classified, confidence scored. The dispatcher
-- reads from this table to decide which module tabs to update.
--
-- This migration:
--   1. Creates the `conversation_capture` table — tenant-scoped, FK to
--      `threads` (via soft TEXT pointer when conversation-threads piece
--      isn't merged yet — we use the existing `threads` table from
--      conversation.schema as the FK target).
--   2. Indexes: (tenant_id, created_at DESC), (tenant_id, intent),
--      (tenant_id, message_id) for dedup, (thread_id) for thread joins.
--   3. Gold-standard RLS pattern from 0185:
--        * ENABLE + FORCE ROW LEVEL SECURITY
--        * tenant_isolation_select (USING)
--        * tenant_isolation_modify (FOR ALL, USING + WITH CHECK)
--        * REVOKE ALL FROM anon
--      Tenant-scoped via the canonical `public.current_app_tenant_id()`
--      GUC helper installed by 0172.
--
-- Capture rows are append-only by application convention (no UPDATE path).
-- We don't enforce that at the DB level because the audit chain row
-- (ai_audit_chain) is the tamper-evident witness; capture mutations
-- would break the chain hash on verify().
--
-- Idempotent: safe to re-run on a fresh database.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create the conversation_capture table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversation_capture (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  /** Optional thread join (NULL for one-shot captures outside a thread). */
  thread_id           TEXT,
  /** Soft pointer to the message that triggered capture. Piece F's messages
   *  table is in `claude/piece-f` worktree; once merged we promote to FK.
   *  Today this can also point at a `thread_events.id` for compatibility. */
  message_id          TEXT,
  /** Persona id that produced the assistant reply (matches persona_registry.id). */
  persona_id          TEXT NOT NULL,
  /** Actor (user) who sent the originating message. */
  user_id             TEXT,
  /** Verbatim user utterance after PII scrub (already scrubbed by kernel). */
  user_text           TEXT NOT NULL,
  /** Verbatim assistant reply text. */
  assistant_text      TEXT NOT NULL,
  /** Brain decision kind: 'answer' | 'softened' (refusals are not captured). */
  decision_kind       TEXT NOT NULL,
  /** Resolved canonical entities. JSONB ARRAY of
   *  `{type, canonical_id, raw_value, confidence, source}` rows. */
  entities            JSONB NOT NULL DEFAULT '[]'::jsonb,
  /** Intent classifier output: one of
   *  'request_info' | 'propose_action' | 'file_event' | 'ask_for_help' | 'ambiguous'. */
  intent              TEXT NOT NULL,
  /** Intent classification confidence in [0, 1]. */
  intent_confidence   DOUBLE PRECISION NOT NULL DEFAULT 0,
  /** Overall capture confidence = min(resolver, intent, persona_trust, tenant_trust). */
  capture_confidence  DOUBLE PRECISION NOT NULL DEFAULT 0,
  /** Persona trust at capture time (T1 = 1.0, T2 = 0.85, ... T5 = 0.40). */
  persona_trust       DOUBLE PRECISION NOT NULL DEFAULT 0.7,
  /** Tenant trust at capture time (0.5..1.0). */
  tenant_trust        DOUBLE PRECISION NOT NULL DEFAULT 0.8,
  /** Free-form attributes (e.g. session id, surface id, cohort signal). */
  attributes          JSONB NOT NULL DEFAULT '{}'::jsonb,
  /** SHA-256 hash of (user_text || '\n' || assistant_text) for dedup. */
  exchange_hash       TEXT NOT NULL,
  /** Cumulative latency budget tracked: classifier_ms + dispatch_ms. */
  latency_ms          INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS conversation_capture_tenant_created_idx
  ON conversation_capture (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS conversation_capture_tenant_intent_idx
  ON conversation_capture (tenant_id, intent);

CREATE INDEX IF NOT EXISTS conversation_capture_thread_idx
  ON conversation_capture (thread_id);

CREATE INDEX IF NOT EXISTS conversation_capture_message_idx
  ON conversation_capture (message_id);

CREATE INDEX IF NOT EXISTS conversation_capture_hash_idx
  ON conversation_capture (tenant_id, exchange_hash);

COMMENT ON TABLE conversation_capture IS
  'Piece L — captured user/assistant exchanges with resolved entities + classified intent. Append-only; audit chain row witnesses each insert.';

COMMENT ON COLUMN conversation_capture.message_id IS
  'Soft FK to messages (Piece F) or thread_events.id. Promoted to FK once piece-f merges.';

COMMENT ON COLUMN conversation_capture.entities IS
  'JSONB ARRAY of {type, canonical_id, raw_value, confidence, source}. Entities that failed canonical resolution are dropped (NOT stored).';

COMMENT ON COLUMN conversation_capture.intent IS
  'One of request_info | propose_action | file_event | ask_for_help | ambiguous. Used by dispatcher to gate the routing matrix.';

COMMENT ON COLUMN conversation_capture.capture_confidence IS
  'min(resolver_confidence, intent_confidence, persona_trust, tenant_trust). Below router threshold → emit proactive nudge instead of dispatching.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Gold-standard RLS pattern (matches 0185).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  tbl text;
  tenant_tables text[] := ARRAY[
    'conversation_capture'
  ];
BEGIN
  FOREACH tbl IN ARRAY tenant_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);

      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_select ON public.%I;', tbl
      );
      EXECUTE format(
        'DROP POLICY IF EXISTS tenant_isolation_modify ON public.%I;', tbl
      );

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_select ON public.%I
        FOR SELECT
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format($pol$
        CREATE POLICY tenant_isolation_modify ON public.%I
        FOR ALL
        TO authenticated
        USING (tenant_id = public.current_app_tenant_id())
        WITH CHECK (tenant_id = public.current_app_tenant_id());
      $pol$, tbl);

      EXECUTE format('REVOKE ALL ON public.%I FROM anon;', tbl);
    END IF;
  END LOOP;
END
$$;
