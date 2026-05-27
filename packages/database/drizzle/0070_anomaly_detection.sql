-- =============================================================================
-- Migration 0070 — Anomaly Detection (SOTA 2026)
--
-- Companion to Docs/DESIGN/ANOMALY_DETECTION_SOTA_2026.md.
--
-- Persists every anomaly verdict emitted by @borjie/anomaly-detection for
-- Mr. Mwikila's mining operations: fuel consumption spikes, weight-bridge
-- deviations, worker check-in misses, royalty filing irregularities, and
-- equipment vibration outliers. Verdicts are immutable, tenant-scoped, and
-- hash-chained per tenant for forensic replay.
--
-- One table:
--
--   anomaly_detections — append-only, tenant-scoped registry of anomaly
--                        verdicts. Each row carries the value, score,
--                        threshold, boolean verdict, structured evidence,
--                        and an audit_hash chained against the prior
--                        verdict in the tenant's chain.
--
-- RLS uses the canonical `app.tenant_id` GUC pattern from migration 0003.
-- Idempotent (IF NOT EXISTS + DO blocks). Safe to re-run.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- anomaly_detections — immutable, audit-chained anomaly verdict ledger
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS anomaly_detections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text NOT NULL,
  /** Detector identity — e.g. 'isolation-forest', 'lof', 'zscore',
      'mad', 'adwin', 'kswin', 'page-hinkley', 'autoencoder',
      'one-class-svm', 'voting-ensemble', or one of the mining-domain
      wrappers ('fuel-consumption-spike', 'weight-bridge-deviation',
      'worker-check-in-miss', 'royalty-filing-irregularity',
      'equipment-vibration-outlier'). */
  detector     text NOT NULL,
  /** What was scored — e.g. 'asset:loader-7', 'truck:TZ-1234',
      'worker:supervisor-12', 'quarter:2026-Q2', 'crusher:primary-1'. */
  target       text NOT NULL,
  /** The observed value — units encoded in evidence.unit. */
  value        numeric NOT NULL,
  /** The detector's anomaly score — semantics encoded in
      evidence.score_kind ('iforest' is in [0,1], 'lof' is in [0, ∞),
      'zscore' is signed, 'mad' is signed, etc.). */
  score        numeric NOT NULL,
  /** Configured decision threshold. */
  threshold    numeric NOT NULL,
  /** Final verdict — true means the value was flagged anomalous. */
  anomalous    boolean NOT NULL,
  /** Structured evidence — unit, score_kind, contributing detectors
      (for ensembles), window stats, etc. */
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at  timestamptz NOT NULL DEFAULT now(),
  /** Hash of the previous anomaly_detection row in this tenant's
      chain. Empty string for the genesis row. */
  prev_hash    text NOT NULL DEFAULT '',
  audit_hash   text NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'anomaly_detections_detector_nonempty_chk'
  ) THEN
    ALTER TABLE anomaly_detections
      ADD CONSTRAINT anomaly_detections_detector_nonempty_chk
      CHECK (length(detector) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'anomaly_detections_target_nonempty_chk'
  ) THEN
    ALTER TABLE anomaly_detections
      ADD CONSTRAINT anomaly_detections_target_nonempty_chk
      CHECK (length(target) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'anomaly_detections_audit_hash_nonempty_chk'
  ) THEN
    ALTER TABLE anomaly_detections
      ADD CONSTRAINT anomaly_detections_audit_hash_nonempty_chk
      CHECK (length(audit_hash) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'anomaly_detections_tenant_nonempty_chk'
  ) THEN
    ALTER TABLE anomaly_detections
      ADD CONSTRAINT anomaly_detections_tenant_nonempty_chk
      CHECK (length(tenant_id) > 0);
  END IF;
END $$;

-- Hot path: list a tenant's recent verdicts for a given detector, newest
-- first. Used by the executive-brief engine and Mr. Mwikila's dashboards.
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_tenant_detector_detected_at
  ON anomaly_detections (tenant_id, detector, detected_at DESC);

-- Hot path: list a tenant's anomalous-only verdicts, newest first.
-- Used by the alerting pipeline.
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_tenant_anomalous_detected_at
  ON anomaly_detections (tenant_id, anomalous, detected_at DESC);

-- Forensic replay path — audit-hash lookup.
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_audit_hash
  ON anomaly_detections (audit_hash);

-- Target-specific replay (e.g. "show every verdict for asset:loader-7").
CREATE INDEX IF NOT EXISTS idx_anomaly_detections_tenant_target_detected_at
  ON anomaly_detections (tenant_id, target, detected_at DESC);

ALTER TABLE anomaly_detections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'anomaly_detections'
       AND policyname = 'anomaly_detections_tenant_isolation'
  ) THEN
    CREATE POLICY anomaly_detections_tenant_isolation
      ON anomaly_detections
      FOR ALL
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END $$;

COMMIT;
