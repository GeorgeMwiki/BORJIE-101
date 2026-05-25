-- ─────────────────────────────────────────────────────────────────────
-- Migration 0142 — Session replay chunks (cold store metadata).
--
-- Central Command Phase B (B5 — Session Replay + Counter-Model Safety).
--
-- One row per uploaded rrweb chunk. The PII-masked, gzip-compressed
-- event blob lives in the cold object store (S3 in prod, local FS in
-- dev) addressed by `storage_uri`. This table is the *index* — it lets
-- the admin replay viewer list and order chunks for a session without
-- listing the bucket prefix on every request.
--
-- Hard guardrails:
--   - rrweb events are PII-masked at the client (apps/admin-platform-
--     portal/src/lib/session-replay/pii-mask.ts) BEFORE bytes are sent
--     to the gateway. The server never sees raw passwords / inputs.
--   - The rrweb event stream is held SEPARATELY from the 14-event
--     sensorium analytics taxonomy. Per PostHog's pattern (R4 brain-
--     as-OS doc) we never feed mouse-move replay events back into the
--     LLM context window.
--   - Append-only by convention — no UPDATE / DELETE path. Tenant
--     cascade so GDPR right-to-be-forgotten over a tenant purges
--     session replay metadata. Cold-store object deletion is a
--     separate retention worker (Phase C).
--
-- Dedup key: (session_id, sequence_number) — a retried upload from a
-- flaky client must not duplicate rows. Sequence numbers are
-- monotonically allocated by the client recorder.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_replay_chunks (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id             TEXT NOT NULL,
  session_id          TEXT NOT NULL,
  surface             TEXT NOT NULL,
  sequence_number     INTEGER NOT NULL,
  /** rrweb event count carried by the chunk — convenient for the
      viewer's per-chunk progress indicator without downloading the
      blob. */
  event_count         INTEGER NOT NULL DEFAULT 0,
  /** Gzip-compressed payload size in bytes. Surfaced to the operator
      so they can spot a runaway client. */
  byte_size           INTEGER NOT NULL DEFAULT 0,
  /** Pointer to the cold object. Backed by LocalFileStorage in dev
      (file:///tmp/session-replay/<id>.gz) and S3Storage in prod
      (s3://<bucket>/<key>). */
  storage_uri         TEXT NOT NULL,
  captured_at         TIMESTAMPTZ NOT NULL,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_replay_chunks_session_seq
  ON session_replay_chunks (session_id, sequence_number);

CREATE INDEX IF NOT EXISTS idx_session_replay_chunks_tenant_session
  ON session_replay_chunks (tenant_id, session_id, captured_at);

CREATE INDEX IF NOT EXISTS idx_session_replay_chunks_tenant_user_time
  ON session_replay_chunks (tenant_id, user_id, captured_at DESC);

COMMENT ON TABLE session_replay_chunks IS
  'Metadata for chunked rrweb session-replay uploads. Cold blob lives in object store at storage_uri. PII masked at client before upload.';

COMMENT ON COLUMN session_replay_chunks.storage_uri IS
  'file://... in dev, s3://... in prod. The api-gateway resolves this through the SessionReplayStoragePort adapter.';

COMMENT ON COLUMN session_replay_chunks.sequence_number IS
  'Monotonic per-session sequence allocated by the client recorder. UNIQUE(session_id, sequence_number) defeats retry duplicates.';
