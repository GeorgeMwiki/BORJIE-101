-- ─────────────────────────────────────────────────────────────────────
-- Migration 0151 — Core memory blocks (Letta-style persistent self-summary).
--
-- Phase D / D8 — LITFIN parity gap closure.
--
-- One row per (tenant_id, user_id, persona_id, block_kind). The kernel
-- reads the latest non-archived block for each (persona_id) tuple at
-- step 6 (identity preamble) and injects the rendered block at the
-- TOP of the system prompt — above any other instruction. This is
-- how the agent "remembers who it is for this person" across sessions
-- without re-running consolidation.
--
-- Block kinds:
--   - 'persona'     — the agent's first-person voice for this user
--   - 'human'       — what the agent knows about the user
--   - 'preferences' — explicit preferences the user has declared
--   - 'project'     — the current cross-session goal / project context
--
-- Idempotent + append-only. Archival via UPDATE archived_at.
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS core_memory_blocks (
  id                  TEXT PRIMARY KEY,
  tenant_id           TEXT REFERENCES tenants(id) ON DELETE CASCADE,
  /** Nullable so platform-tier (HQ) agents can keep a global block. */
  user_id             TEXT,
  /** Persona id (matches the kernel's PersonaIdentity.id). */
  persona_id          TEXT NOT NULL,
  /** 'persona' | 'human' | 'preferences' | 'project' */
  block_kind          TEXT NOT NULL,
  /** Rendered block text — kept under ~2000 chars to keep prompt cost bounded. */
  block_text          TEXT NOT NULL,
  /** Optional structured context the kernel can introspect. */
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at         TIMESTAMPTZ
);

-- Latest-non-archived per (tenant, user, persona, kind) is the active block.
CREATE UNIQUE INDEX IF NOT EXISTS idx_core_memory_blocks_active_uniq
  ON core_memory_blocks (
    COALESCE(tenant_id, ''),
    COALESCE(user_id, ''),
    persona_id,
    block_kind
  )
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_core_memory_blocks_tenant_user_persona
  ON core_memory_blocks (tenant_id, user_id, persona_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_core_memory_blocks_persona_kind
  ON core_memory_blocks (persona_id, block_kind, updated_at DESC);

COMMENT ON TABLE core_memory_blocks IS
  'Letta-style per-agent persistent self-summary blocks. The kernel injects the active blocks at the top of every system prompt.';

COMMENT ON COLUMN core_memory_blocks.block_kind IS
  'One of: persona | human | preferences | project';

COMMENT ON COLUMN core_memory_blocks.archived_at IS
  'Soft-delete marker. Active blocks have archived_at IS NULL; the unique partial index enforces "at most one active per kind" per (tenant, user, persona).';
