/**
 * Auto-Populate — Audit Trail
 *
 * Every silent write — and every CONFIRM_NEEDED suggestion, and every drop
 * — produces an `auto_populate_audit` row. The owner can later open the
 * audit-trail UI, see exactly what the MD wrote (and why), and revert any
 * row with one click.
 *
 * The audit row also satisfies the platform-wide invariant that every
 * decision surface produces a DecisionTrace.
 *
 * Schema (see migration.sql):
 *   id            UUID
 *   tenant_id     UUID
 *   user_id       UUID
 *   turn_id       TEXT      -- chat turn id (FK is logical, not enforced)
 *   entity_kind   TEXT
 *   entity_data   JSONB     -- the full ExtractedEntity
 *   confidence    NUMERIC
 *   gate_decision TEXT      -- 'auto_persist' | 'confirm_needed' | 'drop'
 *   dedupe_action TEXT      -- 'insert' | 'merge'
 *   dedupe_reason TEXT
 *   dedupe_score  NUMERIC
 *   persisted_row_id UUID NULL   -- id of the per-kind row, when persisted
 *   persisted_table  TEXT NULL
 *   owner_confirmation TEXT      -- 'auto' | 'pending' | 'confirmed' | 'rejected' | 'reverted'
 *   error_message TEXT NULL
 *   created_at    TIMESTAMPTZ
 *   updated_at    TIMESTAMPTZ
 */

import { createServiceClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/logger";
import {
  ENTITY_KIND_TO_TABLE,
  type ExtractedEntity,
  type EntityKind,
} from "./entity-types";
import type { DedupeAction } from "./dedupe";
import type { GateDecision } from "./confidence-gate";

const log = createLogger("md.auto-populate.audit");

const TABLE = "auto_populate_audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OwnerConfirmation =
  | "auto"
  | "pending"
  | "confirmed"
  | "rejected"
  | "reverted";

export interface AuditRowInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly turnId: string;
  readonly entity: ExtractedEntity;
  readonly gateDecision: GateDecision;
  readonly dedupeAction: DedupeAction | null;
  readonly dedupeReason: string;
  readonly dedupeScore: number;
  readonly persistedRowId: string | null;
  readonly ownerConfirmation: OwnerConfirmation;
  readonly errorMessage: string | null;
}

export interface AuditRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly turnId: string;
  readonly entityKind: EntityKind;
  readonly entity: ExtractedEntity;
  readonly confidence: number;
  readonly gateDecision: GateDecision;
  readonly dedupeAction: DedupeAction | null;
  readonly dedupeReason: string;
  readonly dedupeScore: number;
  readonly persistedRowId: string | null;
  readonly persistedTable: string | null;
  readonly ownerConfirmation: OwnerConfirmation;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without DB)
// ---------------------------------------------------------------------------

/**
 * Project an AuditRowInput into the column shape of `auto_populate_audit`.
 * Pure; used both by `recordAudit` and tests.
 */
export function auditInputToRow(input: AuditRowInput): Record<string, unknown> {
  return {
    tenant_id: input.tenantId,
    user_id: input.userId,
    turn_id: input.turnId,
    entity_kind: input.entity.kind,
    entity_data: input.entity,
    confidence: input.entity.confidence,
    gate_decision: input.gateDecision,
    dedupe_action: input.dedupeAction,
    dedupe_reason: input.dedupeReason,
    dedupe_score: input.dedupeScore,
    persisted_row_id: input.persistedRowId,
    persisted_table: input.persistedRowId
      ? ENTITY_KIND_TO_TABLE[input.entity.kind]
      : null,
    owner_confirmation: input.ownerConfirmation,
    error_message: input.errorMessage,
    updated_at: new Date().toISOString(),
  };
}

function rowToAudit(row: Record<string, unknown>): AuditRow {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    userId: String(row.user_id),
    turnId: String(row.turn_id),
    entityKind: row.entity_kind as EntityKind,
    entity: row.entity_data as ExtractedEntity,
    confidence: Number(row.confidence ?? 0),
    gateDecision: row.gate_decision as GateDecision,
    dedupeAction: (row.dedupe_action as DedupeAction | null) ?? null,
    dedupeReason: String(row.dedupe_reason ?? ""),
    dedupeScore: Number(row.dedupe_score ?? 0),
    persistedRowId: (row.persisted_row_id as string | null) ?? null,
    persistedTable: (row.persisted_table as string | null) ?? null,
    ownerConfirmation: row.owner_confirmation as OwnerConfirmation,
    errorMessage: (row.error_message as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Write paths
// ---------------------------------------------------------------------------

/**
 * Insert a fresh audit row. Returns the audit id (or null on failure —
 * we never throw because the owner's turn must still complete).
 */
export async function recordAudit(
  input: AuditRowInput,
): Promise<string | null> {
  if (!input.tenantId) {
    log.warn("recordAudit: missing tenantId — skipping");
    return null;
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert(auditInputToRow(input))
    .select("id")
    .single();

  if (error) {
    log.error("audit insert failed", { error: error.message });
    return null;
  }
  return String(data.id);
}

/**
 * Mark an existing audit row with a new owner-confirmation status.
 * Used when the owner confirms / rejects / reverts via the audit UI.
 */
export async function updateOwnerConfirmation(
  auditId: string,
  tenantId: string,
  status: OwnerConfirmation,
): Promise<boolean> {
  if (!auditId || !tenantId) return false;
  const supabase = createServiceClient();
  const { error } = await supabase
    .from(TABLE)
    .update({
      owner_confirmation: status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", auditId)
    .eq("tenant_id", tenantId);
  if (error) {
    log.error("updateOwnerConfirmation failed", { error: error.message });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Read paths (for the audit-trail UI we don't build here)
// ---------------------------------------------------------------------------

export async function listAuditRows(
  tenantId: string,
  limit = 100,
): Promise<ReadonlyArray<AuditRow>> {
  if (!tenantId) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    log.error("listAuditRows failed", { error: error.message });
    return [];
  }
  return (data ?? []).map((r) => rowToAudit(r as Record<string, unknown>));
}
