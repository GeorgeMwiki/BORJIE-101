/**
 * InsightStore \u2014 in-memory and Postgres-backed implementations.
 *
 * Dedupe is by (tenant_id, dedupe_key): a nightly task that has already
 * raised an insight for the same underlying situation simply refreshes the
 * existing row instead of piling up duplicates.
 */

import { randomUUID } from 'node:crypto';

import type {
  BackgroundInsight,
  InsightStore,
  NewBackgroundInsightInput,
} from './types.js';

export class InMemoryInsightStore implements InsightStore {
  private rows: readonly BackgroundInsight[] = [];

  async upsert(input: NewBackgroundInsightInput): Promise<BackgroundInsight> {
    const existing = this.rows.find(
      (r) => r.tenantId === input.tenantId && r.dedupeKey === input.dedupeKey,
    );
    if (existing) {
      const updated: BackgroundInsight = {
        ...existing,
        severity: input.severity,
        title: input.title,
        description: input.description,
        evidenceRefs: input.evidenceRefs,
        actionPlan: input.actionPlan,
      };
      this.rows = this.rows.map((r) => (r.id === existing.id ? updated : r));
      return updated;
    }
    const created: BackgroundInsight = {
      id: `insight_${randomUUID()}`,
      tenantId: input.tenantId,
      kind: input.kind,
      severity: input.severity,
      title: input.title,
      description: input.description,
      evidenceRefs: input.evidenceRefs,
      actionPlan: input.actionPlan,
      dedupeKey: input.dedupeKey,
      createdAt: new Date().toISOString(),
    };
    this.rows = [...this.rows, created];
    return created;
  }

  async listUnacknowledged(
    tenantId: string,
    limit = 50,
  ): Promise<readonly BackgroundInsight[]> {
    return this.rows
      .filter((r) => r.tenantId === tenantId && !r.acknowledgedAt)
      .slice(0, limit);
  }

  async acknowledge(
    insightId: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    this.rows = this.rows.map((r) =>
      r.id === insightId && r.tenantId === tenantId
        ? {
            ...r,
            acknowledgedAt: new Date().toISOString(),
            acknowledgedBy: userId,
          }
        : r,
    );
  }

  async findByDedupeKey(
    tenantId: string,
    dedupeKey: string,
  ): Promise<BackgroundInsight | null> {
    return (
      this.rows.find(
        (r) => r.tenantId === tenantId && r.dedupeKey === dedupeKey,
      ) ?? null
    );
  }
}

export interface SqlRunner {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: readonly Row[] }>;
}

export class PostgresInsightStore implements InsightStore {
  constructor(private readonly sql: SqlRunner) {}

  async upsert(input: NewBackgroundInsightInput): Promise<BackgroundInsight> {
    const id = `insight_${randomUUID()}`;
    const now = new Date().toISOString();
    const { rows } = await this.sql.query<Record<string, unknown>>(
      `INSERT INTO ai_background_insights (
         id, tenant_id, kind, severity, title, description,
         evidence_refs, action_plan, dedupe_key, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id, dedupe_key)
         DO UPDATE SET
           severity = EXCLUDED.severity,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           evidence_refs = EXCLUDED.evidence_refs,
           action_plan = EXCLUDED.action_plan
       RETURNING *`,
      [
        id,
        input.tenantId,
        input.kind,
        input.severity,
        input.title,
        input.description,
        JSON.stringify(input.evidenceRefs),
        JSON.stringify(input.actionPlan),
        input.dedupeKey,
        now,
      ],
    );
    const row = rows[0];
    return mapRow(row);
  }

  async listUnacknowledged(
    tenantId: string,
    limit = 50,
  ): Promise<readonly BackgroundInsight[]> {
    const { rows } = await this.sql.query<Record<string, unknown>>(
      `SELECT * FROM ai_background_insights
       WHERE tenant_id = $1 AND acknowledged_at IS NULL
       ORDER BY created_at DESC
       LIMIT $2`,
      [tenantId, limit],
    );
    return rows.map(mapRow);
  }

  async acknowledge(
    insightId: string,
    tenantId: string,
    userId: string,
  ): Promise<void> {
    await this.sql.query(
      `UPDATE ai_background_insights
       SET acknowledged_at = NOW(), acknowledged_by = $3
       WHERE id = $1 AND tenant_id = $2`,
      [insightId, tenantId, userId],
    );
  }

  async findByDedupeKey(
    tenantId: string,
    dedupeKey: string,
  ): Promise<BackgroundInsight | null> {
    const { rows } = await this.sql.query<Record<string, unknown>>(
      `SELECT * FROM ai_background_insights
       WHERE tenant_id = $1 AND dedupe_key = $2
       LIMIT 1`,
      [tenantId, dedupeKey],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }
}

function mapRow(row: Record<string, unknown>): BackgroundInsight {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    kind: row.kind as BackgroundInsight['kind'],
    severity: row.severity as BackgroundInsight['severity'],
    title: String(row.title),
    description: String(row.description),
    evidenceRefs: parseJson(row.evidence_refs, []) as BackgroundInsight['evidenceRefs'],
    actionPlan: parseJson(row.action_plan, {
      summary: '',
      steps: [],
    }) as BackgroundInsight['actionPlan'],
    dedupeKey: String(row.dedupe_key),
    createdAt: String(row.created_at),
    acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : undefined,
    acknowledgedBy: row.acknowledged_by ? String(row.acknowledged_by) : undefined,
  };
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}
