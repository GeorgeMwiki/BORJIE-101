/**
 * Post-quality-scores repository — in-memory + SQL adapters.
 *
 * Wave BLACKBOARD-INTEL. Both adapters implement
 * `PostQualityScoresRepository` from `../types.ts`. The in-memory
 * variant powers tests; the SQL variant targets the
 * `blackboard_post_quality_scores` table from migration 0074.
 *
 * @module @borjie/blackboard-intel/repositories/post-quality-scores-repository
 */

import {
  BlackboardIntelError,
  type PostQualityScore,
  type PostQualityScoresRepository,
  type QualityAxis,
} from '../types.js';

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export function createInMemoryPostQualityScoresRepository(): PostQualityScoresRepository {
  // Internal mutable map indexed by row id; reads return frozen copies.
  const byId: Map<string, PostQualityScore> = new Map();
  return {
    async insert(row) {
      if (row.score < 0 || row.score > 1 || !Number.isFinite(row.score)) {
        throw new BlackboardIntelError(
          `score out of range: ${row.score}`,
          'INVALID_SCORE_RANGE',
        );
      }
      if (
        row.axis !== 'groundedness' &&
        row.axis !== 'calibration' &&
        row.axis !== 'utility'
      ) {
        throw new BlackboardIntelError(
          `unknown axis: ${row.axis}`,
          'INVALID_AXIS',
        );
      }
      if (byId.has(row.id)) {
        throw new BlackboardIntelError(
          `duplicate score id ${row.id}`,
          'DUPLICATE_SCORE_ID',
        );
      }
      byId.set(row.id, row);
    },
    async listForPost(tenantId, postId) {
      const out: PostQualityScore[] = [];
      for (const r of byId.values()) {
        if (r.tenantId === tenantId && r.postId === postId) {
          out.push(r);
        }
      }
      out.sort((a, b) => Date.parse(b.scoredAt) - Date.parse(a.scoredAt));
      return Object.freeze([...out]);
    },
    async tipPerAxis(tenantId, postId) {
      const out: Partial<Record<QualityAxis, PostQualityScore>> = {};
      for (const r of byId.values()) {
        if (r.tenantId !== tenantId || r.postId !== postId) continue;
        const existing = out[r.axis];
        if (
          existing === undefined ||
          Date.parse(r.scoredAt) > Date.parse(existing.scoredAt)
        ) {
          out[r.axis] = r;
        }
      }
      return Object.freeze(out);
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter — Drizzle-compatible driver port
// ---------------------------------------------------------------------------

/**
 * Minimal SQL driver port the SQL adapter depends on. Implementations
 * adapt Drizzle, pg, or any other client.
 */
export interface PostQualityScoresSqlDriver {
  /** Insert one row into `blackboard_post_quality_scores`. */
  readonly insertRow: (
    row: Readonly<{
      id: string;
      tenantId: string;
      postId: string;
      axis: QualityAxis;
      score: number;
      scoredAt: string;
      prevHash: string;
      auditHash: string;
    }>,
  ) => Promise<void>;
  /** Select rows for a (tenantId, postId) ordered scored_at DESC. */
  readonly selectForPost: (
    tenantId: string,
    postId: string,
  ) => Promise<
    ReadonlyArray<{
      id: string;
      tenantId: string;
      postId: string;
      axis: QualityAxis;
      score: number;
      scoredAt: string;
      prevHash: string;
      auditHash: string;
    }>
  >;
}

export function createSqlPostQualityScoresRepository(
  driver: PostQualityScoresSqlDriver,
): PostQualityScoresRepository {
  return {
    async insert(row) {
      if (row.score < 0 || row.score > 1 || !Number.isFinite(row.score)) {
        throw new BlackboardIntelError(
          `score out of range: ${row.score}`,
          'INVALID_SCORE_RANGE',
        );
      }
      await driver.insertRow({
        id: row.id,
        tenantId: row.tenantId,
        postId: row.postId,
        axis: row.axis,
        score: row.score,
        scoredAt: row.scoredAt,
        prevHash: row.prevHash,
        auditHash: row.auditHash,
      });
    },
    async listForPost(tenantId, postId) {
      const rows = await driver.selectForPost(tenantId, postId);
      return Object.freeze(rows.map((r) => Object.freeze({ ...r })));
    },
    async tipPerAxis(tenantId, postId) {
      const rows = await driver.selectForPost(tenantId, postId);
      const out: Partial<Record<QualityAxis, PostQualityScore>> = {};
      for (const r of rows) {
        const existing = out[r.axis];
        if (
          existing === undefined ||
          Date.parse(r.scoredAt) > Date.parse(existing.scoredAt)
        ) {
          out[r.axis] = Object.freeze({ ...r });
        }
      }
      return Object.freeze(out);
    },
  };
}
