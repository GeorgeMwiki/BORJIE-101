/**
 * Artifact repository — CRUD over the `research_artifacts` table.
 *
 * Migration 0018 §3. Carries id, step_id, source_kind, source_uri,
 * retrieved_at, content, extracted_entities, quality_score, bias_flags,
 * citation_id.
 *
 * @module research-orchestrator/storage/artifact-repository
 */

import type { ResearchArtifact } from '../types.js';
import type { SqlLike } from './plan-repository.js';

export interface ArtifactRepository {
  createBatch(artifacts: ReadonlyArray<ResearchArtifact>): Promise<void>;
  listByStep(step_id: string): Promise<ReadonlyArray<ResearchArtifact>>;
  listByPlan(plan_id: string): Promise<ReadonlyArray<ResearchArtifact>>;
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export function createInMemoryArtifactRepository(): ArtifactRepository {
  const byStep = new Map<string, Array<ResearchArtifact>>();
  return {
    async createBatch(artifacts) {
      for (const a of artifacts) {
        const list = byStep.get(a.step_id);
        if (list) list.push(a);
        else byStep.set(a.step_id, [a]);
      }
    },
    async listByStep(step_id) {
      return Object.freeze([...(byStep.get(step_id) ?? [])]);
    },
    async listByPlan() {
      // Not used by in-memory variant.
      return Object.freeze([] as ReadonlyArray<ResearchArtifact>);
    },
  };
}

// ---------------------------------------------------------------------------
// SQL implementation
// ---------------------------------------------------------------------------

export function createSqlArtifactRepository(sql: SqlLike): ArtifactRepository {
  return {
    async createBatch(artifacts) {
      for (const a of artifacts) {
        await sql`
          INSERT INTO research_artifacts (
            id, step_id, source_kind, source_uri, retrieved_at,
            content, extracted_entities, quality_score, bias_flags,
            citation_id
          )
          VALUES (
            ${a.id}, ${a.step_id}, ${a.source_kind}, ${a.source_uri},
            ${a.retrieved_at}::timestamptz, ${a.content},
            ${JSON.stringify(a.extracted_entities)}::jsonb,
            ${a.quality_score}, ${a.bias_flags}, ${a.citation_id}
          )
          ON CONFLICT (id) DO NOTHING
        `;
      }
    },
    async listByStep(step_id) {
      const rows = (await sql<ReadonlyArray<Record<string, unknown>>>`
        SELECT id, step_id, source_kind, source_uri, retrieved_at,
               content, extracted_entities, quality_score, bias_flags,
               citation_id
        FROM research_artifacts
        WHERE step_id = ${step_id}
      `) as unknown as ReadonlyArray<Record<string, unknown>>;
      return Object.freeze(rows.map(rowToArtifact));
    },
    async listByPlan(plan_id) {
      const rows = (await sql<ReadonlyArray<Record<string, unknown>>>`
        SELECT a.id, a.step_id, a.source_kind, a.source_uri,
               a.retrieved_at, a.content, a.extracted_entities,
               a.quality_score, a.bias_flags, a.citation_id
        FROM research_artifacts a
        JOIN research_steps s ON s.id = a.step_id
        WHERE s.plan_id = ${plan_id}
        ORDER BY s.seq ASC
      `) as unknown as ReadonlyArray<Record<string, unknown>>;
      return Object.freeze(rows.map(rowToArtifact));
    },
  };
}

function rowToArtifact(row: Record<string, unknown>): ResearchArtifact {
  const retrievedAt =
    row['retrieved_at'] instanceof Date
      ? (row['retrieved_at'] as Date).toISOString()
      : String(row['retrieved_at'] ?? new Date().toISOString());
  const biasFlags = Array.isArray(row['bias_flags']) ? (row['bias_flags'] as ReadonlyArray<string>) : [];
  return {
    id: String(row['id']),
    step_id: String(row['step_id']),
    source_kind: row['source_kind'] as ResearchArtifact['source_kind'],
    source_uri: String(row['source_uri']),
    source_class: 'generic_blog',
    retrieved_at: retrievedAt,
    content: String(row['content'] ?? ''),
    excerpt: String(row['content'] ?? '').slice(0, 200),
    title: '',
    extracted_entities: Object.freeze(
      Array.isArray(row['extracted_entities'])
        ? (row['extracted_entities'] as ReadonlyArray<unknown>)
        : ([] as ReadonlyArray<unknown>),
    ) as ResearchArtifact['extracted_entities'],
    quality_score: row['quality_score'] === null || row['quality_score'] === undefined
      ? 0
      : Number(row['quality_score']),
    bias_flags: Object.freeze(biasFlags) as unknown as ResearchArtifact['bias_flags'],
    citation_id: String(row['citation_id'] ?? ''),
    audit_hash: '',
    tool_name: '',
    cost_usd_cents: 0,
  };
}
