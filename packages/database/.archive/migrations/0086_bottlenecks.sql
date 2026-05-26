-- =============================================================================
-- 0086: Bottlenecks (Organizational Awareness)
-- =============================================================================
-- Detected bottlenecks per tenant — chronic stages, high-variance steps,
-- stuck hand-offs, rising approval-queue depth. Severity P1/P2/P3 drives
-- proactive-alert surfacing.
-- =============================================================================

CREATE TABLE IF NOT EXISTS bottlenecks (
  id                TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  process_kind      TEXT NOT NULL,
  stage             TEXT NOT NULL,
  bottleneck_kind   TEXT NOT NULL CHECK (bottleneck_kind IN (
                      'chronic_slow',
                      'high_variance',
                      'stalled_handoff',
                      'high_reopen_rate',
                      'queue_depth_rising'
                    )),
  severity          TEXT NOT NULL CHECK (severity IN ('P1','P2','P3')),
  evidence          JSONB NOT NULL DEFAULT '{}'::jsonb,
  suggested_remediation TEXT,
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','resolved','snoozed')),
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ,
  cooldown_until    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bottlenecks_tenant_open
  ON bottlenecks(tenant_id, status, severity);

CREATE INDEX IF NOT EXISTS idx_bottlenecks_kind
  ON bottlenecks(tenant_id, process_kind, stage, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bottlenecks_open_signature
  ON bottlenecks(tenant_id, process_kind, stage, bottleneck_kind)
  WHERE status = 'open';
