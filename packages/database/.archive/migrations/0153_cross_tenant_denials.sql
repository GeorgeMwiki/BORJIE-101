-- ─────────────────────────────────────────────────────────────────────
-- Migration 0153 — Cross-tenant denial audit table.
--
-- Phase D agent D9 — G4 closure (SOC 2 CC6.1 + GDPR Art. 30).
--
-- Every time the AI tenant-isolation guard (packages/ai-copilot/src/
-- security/tenant-isolation.ts) detects that a tool result, memory
-- fragment, or query plan carries a tenant_id different from the
-- caller's tenantId, we record a row HERE. This is the auditor-grade
-- evidence channel for the soft + hard isolation boundary.
--
-- Two consumption modes:
--   1. `validateTenantScope()` returns a non-empty violations list
--      → writes one row per violation with verdict='detected'.
--   2. `assertTenantScope()` throws TenantBoundaryError
--      → writes one row per violation with verdict='blocked'.
--
-- Rows are append-only by RLS convention; deletion is reserved for the
-- 7-year SOC 2 retention sweep (data-retention manager handles).
--
-- Idempotent — CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
-- Safe to re-apply.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cross_tenant_denials (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Tenant the CALLER claimed (the one being defended).
  caller_tenant_id    TEXT NOT NULL,
  -- Tenant present on the foreign record/field (what we kept OUT).
  foreign_tenant_id   TEXT,
  -- Optional actor / persona / session for traceability.
  actor_id            TEXT,
  persona_id          TEXT,
  session_id          TEXT,
  -- Where in the object graph the breach was detected (e.g. "root.tool_result[3].lease.tenantId").
  violation_path      TEXT NOT NULL,
  -- Violation kind, mirrors IsolationViolation.type.
  violation_type      TEXT NOT NULL
                        CHECK (violation_type IN ('cross_tenant_record', 'missing_tenant_filter', 'unscoped_query')),
  -- Severity, mirrors IsolationViolation.severity.
  severity            TEXT NOT NULL
                        CHECK (severity IN ('critical', 'high', 'medium')),
  -- Free-text detail; never carries PII (just structural reason).
  detail              TEXT NOT NULL,
  -- Whether the call was BLOCKED (assertTenantScope threw) or merely DETECTED.
  verdict             TEXT NOT NULL
                        CHECK (verdict IN ('blocked', 'detected')),
  -- Optional caller surface (e.g. "kernel.think", "tool.lookupTenantArrears").
  surface             TEXT,
  -- ID-style trace correlator for joins to the security-event stream.
  trace_id            TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cross_tenant_denials_caller
  ON cross_tenant_denials (caller_tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_cross_tenant_denials_severity
  ON cross_tenant_denials (severity, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_cross_tenant_denials_verdict
  ON cross_tenant_denials (verdict, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_cross_tenant_denials_trace
  ON cross_tenant_denials (trace_id)
  WHERE trace_id IS NOT NULL;

COMMENT ON TABLE  cross_tenant_denials IS
  'D9/G4: audit log of detected cross-tenant boundary breaches; supports SOC 2 CC6.1 evidence and GDPR Art. 30 record-of-processing.';
COMMENT ON COLUMN cross_tenant_denials.verdict IS
  'blocked = caller request was refused (assertTenantScope threw); detected = soft scan only.';
