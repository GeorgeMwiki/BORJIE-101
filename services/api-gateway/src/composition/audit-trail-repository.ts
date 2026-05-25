/**
 * Postgres-backed AuditTrailRepository (Wave 27 Agent C).
 *
 * Persists rows into `audit_trail_entries` (migration 0111). Tenant
 * isolation is enforced twice:
 *   1. RLS policy on the table (`app.current_tenant_id`)
 *   2. Every SELECT/INSERT includes `tenant_id = ${tenantId}`
 *
 * No mutation: rows go in via INSERT only. The service never issues
 * UPDATE or DELETE against this table; operators should REVOKE those
 * grants at deploy time as belt-and-braces.
 */

import { sql } from 'drizzle-orm';
import type {
  AuditActionCategory,
  AuditActorKind,
  AuditTrailEntry,
  AuditTrailRepository,
} from '@borjie/ai-copilot/audit-trail';

interface AuditTrailRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly sequence_id: string | number;
  readonly occurred_at: string;
  readonly actor_kind: AuditActorKind;
  readonly actor_id: string | null;
  readonly actor_display: string | null;
  readonly action_kind: string;
  readonly action_category: AuditActionCategory;
  readonly subject_entity_type: string | null;
  readonly subject_entity_id: string | null;
  readonly resource_uri: string | null;
  readonly ai_model_version: string | null;
  readonly prompt_hash: string | null;
  readonly prompt_tokens_in: number | null;
  readonly prompt_tokens_out: number | null;
  readonly cost_usd_micro: string | number | null;
  readonly evidence_json: Record<string, unknown>;
  readonly decision: string;
  readonly prev_hash: string;
  readonly this_hash: string;
  readonly signature: string | null;
  readonly created_at: string;
}

type SqlExecutor = {
  execute: (q: unknown) => Promise<unknown>;
};

function extractRows<T>(res: unknown): readonly T[] {
  if (Array.isArray(res)) return res as T[];
  const maybe = (res as { rows?: T[] } | null)?.rows;
  return maybe ?? [];
}

function mapRow(r: AuditTrailRow): AuditTrailEntry {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    sequenceId: typeof r.sequence_id === 'string' ? Number(r.sequence_id) : r.sequence_id,
    occurredAt: typeof r.occurred_at === 'string' ? r.occurred_at : new Date(r.occurred_at).toISOString(),
    actorKind: r.actor_kind,
    actorId: r.actor_id,
    actorDisplay: r.actor_display,
    actionKind: r.action_kind,
    actionCategory: r.action_category,
    subjectEntityType: r.subject_entity_type,
    subjectEntityId: r.subject_entity_id,
    resourceUri: r.resource_uri,
    aiModelVersion: r.ai_model_version,
    promptHash: r.prompt_hash,
    promptTokensIn: r.prompt_tokens_in,
    promptTokensOut: r.prompt_tokens_out,
    costUsdMicro:
      r.cost_usd_micro === null
        ? null
        : typeof r.cost_usd_micro === 'string'
          ? Number(r.cost_usd_micro)
          : r.cost_usd_micro,
    evidence: r.evidence_json ?? {},
    decision: r.decision as AuditTrailEntry['decision'],
    prevHash: r.prev_hash,
    thisHash: r.this_hash,
    signature: r.signature,
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
  };
}

export class PostgresAuditTrailRepository implements AuditTrailRepository {
  constructor(private readonly db: SqlExecutor) {}

  async insert(entry: AuditTrailEntry): Promise<AuditTrailEntry> {
    const evidenceLiteral = JSON.stringify(entry.evidence ?? {});
    await this.db.execute(
      sql`INSERT INTO audit_trail_entries (
            id, tenant_id, sequence_id, occurred_at,
            actor_kind, actor_id, actor_display,
            action_kind, action_category,
            subject_entity_type, subject_entity_id, resource_uri,
            ai_model_version, prompt_hash,
            prompt_tokens_in, prompt_tokens_out, cost_usd_micro,
            evidence_json, decision,
            prev_hash, this_hash, signature,
            created_at
          ) VALUES (
            ${entry.id},
            ${entry.tenantId},
            ${entry.sequenceId},
            ${entry.occurredAt}::timestamptz,
            ${entry.actorKind},
            ${entry.actorId},
            ${entry.actorDisplay},
            ${entry.actionKind},
            ${entry.actionCategory},
            ${entry.subjectEntityType},
            ${entry.subjectEntityId},
            ${entry.resourceUri},
            ${entry.aiModelVersion},
            ${entry.promptHash},
            ${entry.promptTokensIn},
            ${entry.promptTokensOut},
            ${entry.costUsdMicro},
            ${evidenceLiteral}::jsonb,
            ${entry.decision},
            ${entry.prevHash},
            ${entry.thisHash},
            ${entry.signature},
            ${entry.createdAt}::timestamptz
          )
          ON CONFLICT (id) DO NOTHING`,
    );
    return entry;
  }

  async getLatest(tenantId: string): Promise<AuditTrailEntry | null> {
    const res = await this.db.execute(
      sql`SELECT *
          FROM audit_trail_entries
          WHERE tenant_id = ${tenantId}
          ORDER BY sequence_id DESC
          LIMIT 1`,
    );
    const rows = extractRows<AuditTrailRow>(res);
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async list(
    tenantId: string,
    options?: {
      readonly from?: Date;
      readonly to?: Date;
      readonly category?: AuditActionCategory;
      readonly actorKind?: AuditActorKind;
      readonly limit?: number;
      readonly offset?: number;
    },
  ): Promise<readonly AuditTrailEntry[]> {
    const limit = Math.min(options?.limit ?? 500, 5000);
    const offset = options?.offset ?? 0;
    const from = options?.from ?? null;
    const to = options?.to ?? null;
    const category = options?.category ?? null;
    const actorKind = options?.actorKind ?? null;
    const res = await this.db.execute(
      sql`SELECT *
          FROM audit_trail_entries
          WHERE tenant_id = ${tenantId}
            AND (${from}::timestamptz IS NULL OR occurred_at >= ${from}::timestamptz)
            AND (${to}::timestamptz   IS NULL OR occurred_at <= ${to}::timestamptz)
            AND (${category}::text    IS NULL OR action_category = ${category}::text)
            AND (${actorKind}::text   IS NULL OR actor_kind = ${actorKind}::text)
          ORDER BY sequence_id ASC
          LIMIT ${limit} OFFSET ${offset}`,
    );
    return extractRows<AuditTrailRow>(res).map(mapRow);
  }

  async count(
    tenantId: string,
    options?: {
      readonly from?: Date;
      readonly to?: Date;
      readonly category?: AuditActionCategory;
      readonly actorKind?: AuditActorKind;
    },
  ): Promise<number> {
    const from = options?.from ?? null;
    const to = options?.to ?? null;
    const category = options?.category ?? null;
    const actorKind = options?.actorKind ?? null;
    const res = await this.db.execute(
      sql`SELECT COUNT(*)::bigint AS total
          FROM audit_trail_entries
          WHERE tenant_id = ${tenantId}
            AND (${from}::timestamptz IS NULL OR occurred_at >= ${from}::timestamptz)
            AND (${to}::timestamptz   IS NULL OR occurred_at <= ${to}::timestamptz)
            AND (${category}::text    IS NULL OR action_category = ${category}::text)
            AND (${actorKind}::text   IS NULL OR actor_kind = ${actorKind}::text)`,
    );
    const rows = extractRows<{ total: string | number }>(res);
    const first = rows[0];
    if (!first) return 0;
    return typeof first.total === 'string' ? Number(first.total) : first.total;
  }
}
