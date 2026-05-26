/**
 * Result repository — CRUD over the `research_results` table.
 *
 * Migration 0018 §4. Carries id, plan_id, summary_md, span_citations,
 * confidence, disagreements, audit_hash, generated_at.
 *
 * @module research-orchestrator/storage/result-repository
 */

import type { ResearchResult } from '../types.js';
import type { SqlLike } from './plan-repository.js';

export interface ResultRepository {
  create(result: ResearchResult): Promise<void>;
  findByPlan(plan_id: string): Promise<ResearchResult | null>;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export function createInMemoryResultRepository(): ResultRepository {
  const byPlan = new Map<string, ResearchResult>();
  return {
    async create(result) {
      byPlan.set(result.plan_id, result);
    },
    async findByPlan(plan_id) {
      return byPlan.get(plan_id) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL implementation
// ---------------------------------------------------------------------------

export function createSqlResultRepository(sql: SqlLike): ResultRepository {
  return {
    async create(result) {
      await sql`
        INSERT INTO research_results (
          id, plan_id, summary_md, span_citations, confidence,
          disagreements, audit_hash, generated_at
        )
        VALUES (
          ${result.id}, ${result.plan_id}, ${result.summary_md},
          ${JSON.stringify(result.span_citations)}::jsonb,
          ${result.confidence},
          ${JSON.stringify(result.disagreements)}::jsonb,
          ${result.audit_hash}, ${result.generated_at}::timestamptz
        )
        ON CONFLICT (id) DO NOTHING
      `;
    },
    async findByPlan(plan_id) {
      const rows = (await sql<ReadonlyArray<Record<string, unknown>>>`
        SELECT id, plan_id, summary_md, span_citations, confidence,
               disagreements, audit_hash, generated_at
        FROM research_results
        WHERE plan_id = ${plan_id}
        LIMIT 1
      `) as unknown as ReadonlyArray<Record<string, unknown>>;
      const row = rows[0];
      if (!row) return null;
      const generatedAt =
        row['generated_at'] instanceof Date
          ? (row['generated_at'] as Date).toISOString()
          : String(row['generated_at']);
      return {
        id: String(row['id']),
        plan_id: String(row['plan_id']),
        summary_md: String(row['summary_md']),
        span_citations: Object.freeze(
          (row['span_citations'] as ReadonlyArray<never> | null) ?? [],
        ),
        confidence: row['confidence'] as ResearchResult['confidence'],
        disagreements: Object.freeze(
          (row['disagreements'] as ReadonlyArray<{ readonly topic: string; readonly sources: ReadonlyArray<string> }> | null) ?? [],
        ),
        audit_hash: String(row['audit_hash']),
        generated_at: generatedAt,
        total_cost_usd_cents: 0,
        total_duration_ms: 0,
      };
    },
  };
}
