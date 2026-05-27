/**
 * RecommendationRepository — persist runs + ingest feedback.
 *
 * Two adapters:
 *
 *   - createInMemoryRecommendationRepository — in-process tenant-
 *     scoped store. Used by tests and in dev. Never returns a row
 *     whose `tenant_id` does not match the caller's `tenantId`.
 *
 *   - createSqlRecommendationRepository — Postgres adapter. The
 *     migration 0071_recommendation_runs.sql declares RLS with the
 *     `app.tenant_id` GUC, so RLS is enforced at the row level. The
 *     adapter still asserts tenant equality in code as a belt-and-
 *     braces defense.
 *
 * The SQL adapter is built against a thin `SqlExecutor` port (matching
 * the convention in `@borjie/database`) so this package keeps its
 * dependency-free posture and can be imported from the edge.
 */

import { canonicalJSON, sha256Hex } from '../util/hash.js';
import type {
  FeedbackSignal,
  MatchTarget,
  RecommendationFeedback,
  RecommendationResult,
  RecommendationRun,
  ScoredItem,
} from '../types.js';

export interface SaveRunInput {
  readonly id?: string;
  readonly tenantId: string;
  readonly target: MatchTarget;
  readonly result: RecommendationResult;
  readonly servedAt?: number;
  readonly prevHash?: string;
}

export interface RecordFeedbackInput {
  readonly id?: string;
  readonly runId: string;
  readonly userId: string;
  readonly itemId: string;
  readonly signal: FeedbackSignal;
  readonly value: number;
  readonly recordedAt?: number;
}

export interface FindRunsArgs {
  readonly tenantId: string;
  readonly target?: MatchTarget;
  readonly userId?: string;
  readonly limit?: number;
}

export interface FindFeedbackArgs {
  readonly runId: string;
  /** Required: enforces the caller can prove tenant ownership. */
  readonly tenantId: string;
}

export interface RecommendationRepository {
  saveRun(input: SaveRunInput): Promise<RecommendationRun>;
  recordFeedback(input: RecordFeedbackInput): Promise<RecommendationFeedback>;
  findRuns(args: FindRunsArgs): Promise<ReadonlyArray<RecommendationRun>>;
  findFeedback(
    args: FindFeedbackArgs,
  ): Promise<ReadonlyArray<RecommendationFeedback>>;
}

export interface InMemoryRepoOptions {
  /** UUID generator. Default uses node:crypto. */
  readonly newId?: () => string;
  /** Now-clock. Default Date.now. */
  readonly now?: () => number;
}

// ──────────────────────────────────────────────────────────────────
// In-memory adapter.
// ──────────────────────────────────────────────────────────────────

export function createInMemoryRecommendationRepository(
  opts: InMemoryRepoOptions = {},
): RecommendationRepository {
  const runs: RecommendationRun[] = [];
  const feedback: RecommendationFeedback[] = [];
  const newId = opts.newId ?? defaultNewId;
  const now = opts.now ?? ((): number => Date.now());

  async function saveRun(input: SaveRunInput): Promise<RecommendationRun> {
    if (input.result.tenantId !== input.tenantId) {
      throw new Error(
        `repo.saveRun: tenant mismatch (input ${input.tenantId} vs result ${input.result.tenantId})`,
      );
    }
    const prevHash = input.prevHash ?? lastHashForTenant(input.tenantId);
    const id = input.id ?? newId();
    const servedAt = input.servedAt ?? now();
    const candidates = [...input.result.candidates];
    const topKItems = input.result.topK.map((s) => s.itemId);
    const scores: ScoredItem[] = input.result.topK.map((s) => ({
      itemId: s.itemId,
      score: s.score,
      ...(s.reason !== undefined ? { reason: s.reason } : {}),
    }));
    const auditHash = sha256Hex(
      `${prevHash}|${canonicalJSON({
        id,
        tenantId: input.tenantId,
        target: input.target,
        algorithm: input.result.algorithm,
        candidates,
        topKItems,
        scores,
        servedAt,
      })}`,
    );
    const run: RecommendationRun = {
      id,
      tenantId: input.tenantId,
      target: input.target,
      algorithm: input.result.algorithm,
      candidates,
      topKItems,
      scores,
      servedAt,
      prevHash,
      auditHash,
    };
    runs.push(run);
    return run;
  }

  async function recordFeedback(
    input: RecordFeedbackInput,
  ): Promise<RecommendationFeedback> {
    if (input.value < 0 || input.value > 5) {
      throw new Error(
        `repo.recordFeedback: value out of range [0,5], got ${input.value}`,
      );
    }
    const run = runs.find((r) => r.id === input.runId);
    if (!run) {
      throw new Error(`repo.recordFeedback: run ${input.runId} not found`);
    }
    const id = input.id ?? newId();
    const recordedAt = input.recordedAt ?? now();
    const auditHash = sha256Hex(
      `${run.auditHash}|${canonicalJSON({
        id,
        runId: input.runId,
        userId: input.userId,
        itemId: input.itemId,
        signal: input.signal,
        value: input.value,
        recordedAt,
      })}`,
    );
    const fb: RecommendationFeedback = {
      id,
      runId: input.runId,
      userId: input.userId,
      itemId: input.itemId,
      signal: input.signal,
      value: input.value,
      recordedAt,
      auditHash,
    };
    feedback.push(fb);
    return fb;
  }

  async function findRuns(
    args: FindRunsArgs,
  ): Promise<ReadonlyArray<RecommendationRun>> {
    const limit = args.limit ?? 100;
    return runs
      .filter((r) => r.tenantId === args.tenantId)
      .filter((r) => (args.target ? r.target === args.target : true))
      .sort((a, b) => b.servedAt - a.servedAt)
      .slice(0, limit);
  }

  async function findFeedback(
    args: FindFeedbackArgs,
  ): Promise<ReadonlyArray<RecommendationFeedback>> {
    const run = runs.find((r) => r.id === args.runId);
    if (!run) return [];
    if (run.tenantId !== args.tenantId) {
      // Strict tenant isolation: refuse to leak.
      return [];
    }
    return feedback
      .filter((f) => f.runId === args.runId)
      .sort((a, b) => b.recordedAt - a.recordedAt);
  }

  function lastHashForTenant(tenantId: string): string {
    let last = '';
    for (const r of runs) {
      if (r.tenantId === tenantId) last = r.auditHash;
    }
    return last;
  }

  return { saveRun, recordFeedback, findRuns, findFeedback };
}

// ──────────────────────────────────────────────────────────────────
// SQL adapter — port-style.
// ──────────────────────────────────────────────────────────────────

/** Thin SQL executor port. The shape matches `@borjie/database`. */
export interface SqlExecutor {
  query<T = unknown>(
    text: string,
    params: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<T>>;
}

export interface SqlRepoOptions {
  readonly executor: SqlExecutor;
  readonly newId?: () => string;
  readonly now?: () => number;
}

interface RawRunRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly target: MatchTarget;
  readonly algorithm: string;
  readonly candidates: ReadonlyArray<string>;
  readonly top_k_items: ReadonlyArray<string>;
  readonly scores: ReadonlyArray<ScoredItem>;
  readonly served_at_ms: number;
  readonly prev_hash: string;
  readonly audit_hash: string;
}

interface RawFeedbackRow {
  readonly id: string;
  readonly run_id: string;
  readonly user_id: string;
  readonly item_id: string;
  readonly signal: FeedbackSignal;
  readonly value: number | string;
  readonly recorded_at_ms: number;
  readonly audit_hash: string;
}

export function createSqlRecommendationRepository(
  opts: SqlRepoOptions,
): RecommendationRepository {
  const newId = opts.newId ?? defaultNewId;
  const now = opts.now ?? ((): number => Date.now());

  async function saveRun(input: SaveRunInput): Promise<RecommendationRun> {
    if (input.result.tenantId !== input.tenantId) {
      throw new Error('repo.saveRun: tenant mismatch');
    }
    const id = input.id ?? newId();
    const servedAt = input.servedAt ?? now();
    const candidates = [...input.result.candidates];
    const topKItems = input.result.topK.map((s) => s.itemId);
    const scores: ScoredItem[] = input.result.topK.map((s) => ({
      itemId: s.itemId,
      score: s.score,
      ...(s.reason !== undefined ? { reason: s.reason } : {}),
    }));
    const prevHash =
      input.prevHash ?? (await lastHashForTenant(input.tenantId));
    const auditHash = sha256Hex(
      `${prevHash}|${canonicalJSON({
        id,
        tenantId: input.tenantId,
        target: input.target,
        algorithm: input.result.algorithm,
        candidates,
        topKItems,
        scores,
        servedAt,
      })}`,
    );
    await opts.executor.query(
      `INSERT INTO recommendation_runs
         (id, tenant_id, target, algorithm, candidates, top_k_items, scores, served_at, prev_hash, audit_hash)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, to_timestamp($8 / 1000.0), $9, $10)`,
      [
        id,
        input.tenantId,
        input.target,
        input.result.algorithm,
        JSON.stringify(candidates),
        JSON.stringify(topKItems),
        JSON.stringify(scores),
        servedAt,
        prevHash,
        auditHash,
      ],
    );
    return {
      id,
      tenantId: input.tenantId,
      target: input.target,
      algorithm: input.result.algorithm,
      candidates,
      topKItems,
      scores,
      servedAt,
      prevHash,
      auditHash,
    };
  }

  async function recordFeedback(
    input: RecordFeedbackInput,
  ): Promise<RecommendationFeedback> {
    if (input.value < 0 || input.value > 5) {
      throw new Error(
        `repo.recordFeedback: value out of range [0,5], got ${input.value}`,
      );
    }
    const id = input.id ?? newId();
    const recordedAt = input.recordedAt ?? now();
    const auditHash = sha256Hex(
      canonicalJSON({
        id,
        runId: input.runId,
        userId: input.userId,
        itemId: input.itemId,
        signal: input.signal,
        value: input.value,
        recordedAt,
      }),
    );
    await opts.executor.query(
      `INSERT INTO recommendation_feedback
         (id, run_id, user_id, item_id, signal, value, recorded_at, audit_hash)
       VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7 / 1000.0), $8)`,
      [
        id,
        input.runId,
        input.userId,
        input.itemId,
        input.signal,
        input.value,
        recordedAt,
        auditHash,
      ],
    );
    return {
      id,
      runId: input.runId,
      userId: input.userId,
      itemId: input.itemId,
      signal: input.signal,
      value: input.value,
      recordedAt,
      auditHash,
    };
  }

  async function findRuns(
    args: FindRunsArgs,
  ): Promise<ReadonlyArray<RecommendationRun>> {
    const limit = args.limit ?? 100;
    const conds: string[] = ['tenant_id = $1'];
    const params: unknown[] = [args.tenantId];
    if (args.target) {
      conds.push(`target = $${params.length + 1}`);
      params.push(args.target);
    }
    params.push(limit);
    const rows = await opts.executor.query<RawRunRow>(
      `SELECT id, tenant_id, target, algorithm, candidates, top_k_items, scores,
              EXTRACT(EPOCH FROM served_at) * 1000 AS served_at_ms,
              prev_hash, audit_hash
         FROM recommendation_runs
        WHERE ${conds.join(' AND ')}
        ORDER BY served_at DESC
        LIMIT $${params.length}`,
      params,
    );
    return rows.map(rowToRun);
  }

  async function findFeedback(
    args: FindFeedbackArgs,
  ): Promise<ReadonlyArray<RecommendationFeedback>> {
    const rows = await opts.executor.query<RawFeedbackRow>(
      `SELECT f.id, f.run_id, f.user_id, f.item_id, f.signal, f.value,
              EXTRACT(EPOCH FROM f.recorded_at) * 1000 AS recorded_at_ms,
              f.audit_hash
         FROM recommendation_feedback f
         JOIN recommendation_runs   r ON r.id = f.run_id
        WHERE f.run_id = $1 AND r.tenant_id = $2
        ORDER BY f.recorded_at DESC`,
      [args.runId, args.tenantId],
    );
    return rows.map(rowToFeedback);
  }

  async function lastHashForTenant(tenantId: string): Promise<string> {
    const rows = await opts.executor.query<{ readonly audit_hash: string }>(
      `SELECT audit_hash FROM recommendation_runs
        WHERE tenant_id = $1 ORDER BY served_at DESC LIMIT 1`,
      [tenantId],
    );
    return rows[0]?.audit_hash ?? '';
  }

  return { saveRun, recordFeedback, findRuns, findFeedback };
}

function rowToRun(row: RawRunRow): RecommendationRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    target: row.target,
    algorithm: row.algorithm as RecommendationRun['algorithm'],
    candidates: [...row.candidates],
    topKItems: [...row.top_k_items],
    scores: row.scores.map((s) => ({ ...s })),
    servedAt: Number(row.served_at_ms),
    prevHash: row.prev_hash,
    auditHash: row.audit_hash,
  };
}

function rowToFeedback(row: RawFeedbackRow): RecommendationFeedback {
  return {
    id: row.id,
    runId: row.run_id,
    userId: row.user_id,
    itemId: row.item_id,
    signal: row.signal,
    value: Number(row.value),
    recordedAt: Number(row.recorded_at_ms),
    auditHash: row.audit_hash,
  };
}

function defaultNewId(): string {
  // node:crypto v15+ supports randomUUID() directly; fall back to a
  // hex-string for older runtimes.
  try {
    return (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
      ?.randomUUID?.() ?? hexFallback();
  } catch {
    return hexFallback();
  }
}

function hexFallback(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
