-- =============================================================================
-- 0055: AI agent certifications \u2014 Wave-11 OpenClaw port
-- =============================================================================
-- Agents (internal and external partner agents calling via MCP) must present a
-- signed certificate proving they are authorised to operate against a tenant's
-- data inside a specific scope set until expiresAt. Revocation is supported.
--
-- Shape:
--   agent_certifications        \u2014 issued certs (id PK, agentId, tenantId,
--                                  scopes JSONB, signature, expiresAt, revoked)
--   agent_cert_revocations      \u2014 append-only revocation log for audit.
--
-- Cross-tenant safety: every row carries tenant_id and every index is scoped.
-- The cert's `signature` is an HMAC-SHA256 hex string produced by
-- AgentCertificationService.sign() over the canonical JSON body.
-- =============================================================================

CREATE TABLE IF NOT EXISTS agent_certifications (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scopes          JSONB NOT NULL DEFAULT '[]'::jsonb,
  issuer          TEXT NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  signature       TEXT NOT NULL,
  revoked         BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_at      TIMESTAMPTZ,
  revoked_reason  TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_certifications_tenant
  ON agent_certifications(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_certifications_agent_tenant
  ON agent_certifications(agent_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_certifications_expires
  ON agent_certifications(expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_certifications_revoked
  ON agent_certifications(tenant_id, revoked);

CREATE TABLE IF NOT EXISTS agent_cert_revocations (
  id              TEXT PRIMARY KEY,
  cert_id         TEXT NOT NULL REFERENCES agent_certifications(id) ON DELETE CASCADE,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  revoked_at      TIMESTAMPTZ NOT NULL,
  revoked_by      TEXT NOT NULL,
  reason          TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_cert_revocations_tenant
  ON agent_cert_revocations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_cert_revocations_cert
  ON agent_cert_revocations(cert_id);
