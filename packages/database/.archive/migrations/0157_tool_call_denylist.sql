-- A2b-2 wire #6 — per-tenant tool-call denylist.
--
-- Operators sometimes need to disable a specific BrainToolSpec for a
-- single tenant (e.g. a regulator hold on `computeKraMri` while a
-- tenant is under investigation). The kernel-side executor reads this
-- table via the `ToolCallDenylistStore` port at dispatch time and
-- refuses the call with a `tool-denylisted` audit row.
--
-- See: `packages/central-intelligence/src/kernel/tool-spec/tool-call-denylist.ts`

CREATE TABLE IF NOT EXISTS tool_call_denylist (
  id           bigserial PRIMARY KEY,
  tenant_id    text       NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tool_name    text       NOT NULL,
  reason       text       NOT NULL,
  applied_by   text,
  -- Optional sunset window — NULL means "indefinite". The kernel skips
  -- entries whose `expires_at` has already elapsed (idempotent on
  -- repeat verification).
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- One denylist row per (tenant, tool) pair. Re-applying replaces the
  -- prior rationale + sunset via ON CONFLICT in the upsert path.
  UNIQUE (tenant_id, tool_name)
);

CREATE INDEX IF NOT EXISTS idx_tool_call_denylist_tenant
  ON tool_call_denylist (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tool_call_denylist_expires
  ON tool_call_denylist (expires_at)
  WHERE expires_at IS NOT NULL;

COMMENT ON TABLE tool_call_denylist IS
  'Per-tenant kernel tool-call denylist. A2b-2 wire #6 — the executor consults this table BEFORE the autonomy-policy + four-eye-approval flow so a regulator-ordered hold can refuse the call without redeploying.';
