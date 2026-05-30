/**
 * Auto-Populate — Persister
 *
 * Writes auto-populated entities to Supabase under RLS, idempotent on
 * `(tenant_id, canonical_name)` thanks to the unique indexes declared in
 * `migration.sql`.
 *
 * Each kind maps to its own table (see ENTITY_KIND_TO_TABLE in
 * entity-types.ts). We serialise the extracted entity into the table's
 * column set, drop fields that do not exist on that table, and upsert
 * by the idempotency key.
 *
 * Side effects:
 *   - Writes one row to the per-kind table.
 *   - Returns the persisted row id so the audit-trail can link it.
 *   - Never throws — failures bubble up as `{ ok: false, error }` so the
 *     MD turn still completes.
 */

import { createServiceClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/logger";
import {
  ENTITY_KIND_TO_TABLE,
  type EntityKind,
  type ExtractedEntity,
} from "./entity-types";
import type { KnownEntity } from "./dedupe";

const log = createLogger("md.auto-populate.persister");

// ---------------------------------------------------------------------------
// Public contracts
// ---------------------------------------------------------------------------

export interface PersistContext {
  /** Tenant id from RLS context. Required — never persist without it. */
  readonly tenantId: string;
  /** User id of the owner whose chat produced the entity. */
  readonly userId: string;
}

export interface PersistOk {
  readonly ok: true;
  readonly rowId: string;
  readonly merged: boolean;
}

export interface PersistErr {
  readonly ok: false;
  readonly error: string;
}

export type PersistResult = PersistOk | PersistErr;

// ---------------------------------------------------------------------------
// Column projection per entity kind
// ---------------------------------------------------------------------------

/**
 * Translate an ExtractedEntity into the row shape its table expects.
 * We keep this explicit (no reflective Object.keys() copy) so unexpected
 * extra fields from the LLM never reach the DB layer.
 */
function entityToRow(
  entity: ExtractedEntity,
  ctx: PersistContext,
): Record<string, unknown> {
  const base = {
    tenant_id: ctx.tenantId,
    canonical_name: entity.canonicalName,
    display_name: entity.displayName,
    confidence: entity.confidence,
    notes: entity.notes ?? null,
    source_span: entity.sourceSpan,
    created_by: ctx.userId,
    updated_at: new Date().toISOString(),
  };

  switch (entity.kind) {
    case "employee":
      return {
        ...base,
        role: entity.role ?? null,
        department: entity.department ?? null,
        email: entity.email ?? null,
        phone: entity.phone ?? null,
        start_date: entity.startDate ?? null,
        is_new_hire: entity.isNewHire ?? null,
      };
    case "customer":
      return {
        ...base,
        industry: entity.industry ?? null,
        contact_name: entity.contactName ?? null,
        contact_email: entity.contactEmail ?? null,
        contact_phone: entity.contactPhone ?? null,
        arr_usd: entity.arrUsd ?? null,
        signed_date: entity.signedDate ?? null,
        status: entity.status ?? null,
      };
    case "product":
      return {
        ...base,
        sku: entity.sku ?? null,
        category: entity.category ?? null,
        price_usd: entity.priceUsd ?? null,
        is_top_seller: entity.isTopSeller ?? null,
        margin: entity.margin ?? null,
      };
    case "supplier":
      return {
        ...base,
        category: entity.category ?? null,
        contact_name: entity.contactName ?? null,
        contact_email: entity.contactEmail ?? null,
        contact_phone: entity.contactPhone ?? null,
        annual_spend_usd: entity.annualSpendUsd ?? null,
        criticality: entity.criticality ?? null,
        contract_renewal_date: entity.contractRenewalDate ?? null,
      };
    case "meeting":
      return {
        ...base,
        occurred_at: entity.occurredAt ?? null,
        attendees: entity.attendees ?? null,
        topic: entity.topic ?? null,
        outcome: entity.outcome ?? null,
      };
    case "decision":
      return {
        ...base,
        decided_at: entity.decidedAt ?? null,
        rationale: entity.rationale ?? null,
        impact_area: entity.impactArea ?? null,
        reversible: entity.reversible ?? null,
      };
    case "feedback":
      return {
        ...base,
        source: entity.source ?? null,
        sentiment: entity.sentiment ?? null,
        topic: entity.topic ?? null,
      };
    case "goal":
      return {
        ...base,
        target_date: entity.targetDate ?? null,
        metric: entity.metric ?? null,
        target_value: entity.targetValue ?? null,
        owner: entity.owner ?? null,
      };
    case "project":
      return {
        ...base,
        status: entity.status ?? null,
        started_at: entity.startedAt ?? null,
        due_date: entity.dueDate ?? null,
        owner: entity.owner ?? null,
      };
    case "risk":
      return {
        ...base,
        severity: entity.severity ?? null,
        likelihood: entity.likelihood ?? null,
        mitigation: entity.mitigation ?? null,
      };
    case "opportunity":
      return {
        ...base,
        estimated_value_usd: entity.estimatedValueUsd ?? null,
        probability: entity.probability ?? null,
        horizon: entity.horizon ?? null,
      };
  }
}

// ---------------------------------------------------------------------------
// Fetch known rows for dedupe
// ---------------------------------------------------------------------------

/**
 * Fetch existing rows of the given kinds for this tenant — used by the
 * service to feed `resolveEntity()`. Limit imposed to keep this fast.
 */
export async function fetchKnownEntities(
  tenantId: string,
  kinds: ReadonlyArray<EntityKind>,
  limitPerKind = 500,
): Promise<ReadonlyArray<KnownEntity>> {
  if (!tenantId) return [];
  const supabase = createServiceClient();
  const out: KnownEntity[] = [];

  for (const kind of kinds) {
    const table = ENTITY_KIND_TO_TABLE[kind];
    const { data, error } = await supabase
      .from(table)
      .select("id, tenant_id, canonical_name, display_name")
      .eq("tenant_id", tenantId)
      .limit(limitPerKind);
    if (error) {
      log.warn("fetchKnownEntities failed", { kind, error: error.message });
      continue;
    }
    for (const row of data ?? []) {
      out.push({
        id: String(row.id),
        tenantId: String(row.tenant_id),
        kind,
        canonicalName: String(row.canonical_name),
        displayName: String(row.display_name),
      });
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Persist a single entity
// ---------------------------------------------------------------------------

/**
 * Upsert one entity. Returns the row id and whether it was an existing
 * row that got merged (UPDATE) or a brand-new INSERT.
 */
export async function persistEntity(
  entity: ExtractedEntity,
  ctx: PersistContext,
  options?: {
    /** When set, UPDATE this id instead of upserting on canonical_name. */
    readonly matchedRowId?: string | null;
  },
): Promise<PersistResult> {
  if (!ctx.tenantId) {
    return { ok: false, error: "missing tenantId" };
  }

  const table = ENTITY_KIND_TO_TABLE[entity.kind];
  const row = entityToRow(entity, ctx);

  const supabase = createServiceClient();

  // Explicit UPDATE path when the dedupe step found a match by fuzzy means
  // (canonical name differs but they are the same entity).
  if (options?.matchedRowId) {
    const { data, error } = await supabase
      .from(table)
      .update(row)
      .eq("id", options.matchedRowId)
      .eq("tenant_id", ctx.tenantId)
      .select("id")
      .single();
    if (error) {
      log.error("update failed", { kind: entity.kind, error: error.message });
      return { ok: false, error: error.message };
    }
    return { ok: true, rowId: String(data.id), merged: true };
  }

  // Idempotent path: upsert on (tenant_id, canonical_name).
  const { data, error } = await supabase
    .from(table)
    .upsert(row, {
      onConflict: "tenant_id,canonical_name",
      ignoreDuplicates: false,
    })
    .select("id")
    .single();

  if (error) {
    log.error("upsert failed", { kind: entity.kind, error: error.message });
    return { ok: false, error: error.message };
  }
  return { ok: true, rowId: String(data.id), merged: false };
}
