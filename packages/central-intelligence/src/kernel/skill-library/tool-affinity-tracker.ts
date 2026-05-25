/**
 * Tool affinity tracker — re-rank the orchestrator's candidate tools by
 * historical success on similar intents.
 *
 * The flat `ToolSearch.searchRelevant(goal, k)` lookup returns the top-k
 * by keyword overlap. That's a sound first pass, but it ignores prior
 * experience: a tool that succeeded for the same kind of intent in the
 * past deserves a boost; a tool that failed repeatedly deserves a
 * dampener. This tracker layers an affinity score on top.
 *
 * Storage:
 *   - In-memory ring buffer by default (`maxRecords` cap, oldest evicted).
 *   - Optional persistence port — composition root wires the
 *     Postgres-backed adapter from `@borjie/database`.
 *
 * Scoring (per tool):
 *   - cosine-weighted success rate of past invocations whose
 *     `intent_embedding` is close to the query embedding.
 *   - Cold-start: 0.5 (neutral — neither boost nor penalty).
 *   - Range: [0, 1]. 1 = always succeeded for very similar intents;
 *     0 = always failed.
 *
 * Re-ranking:
 *   - `reRankWithAffinity(baseRanking, intentEmbedding)` returns a new
 *     array sorted by `position-bonus + affinity * weight`. Stable on
 *     ties so the base ranking's original order is preserved.
 */

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface ToolUsageRecord {
  readonly intent_embedding: ReadonlyArray<number>;
  readonly tool_name: string;
  readonly success: boolean;
  readonly latency_ms: number;
  readonly cost_usd: number;
  readonly ts: string;
}

export interface AffinityPersistencePort {
  load(): Promise<ReadonlyArray<ToolUsageRecord>>;
  append(record: ToolUsageRecord): Promise<void>;
}

export interface ToolAffinityTrackerConfig {
  /** Max in-memory records before oldest is evicted. Default 5_000. */
  readonly maxRecords?: number;
  /**
   * Cosine-similarity threshold below which a past record is treated as
   * unrelated and excluded from the affinity calculation. Default 0.5.
   */
  readonly similarityFloor?: number;
  /** Weight applied to the affinity score when re-ranking. Default 1.0. */
  readonly affinityWeight?: number;
  /** Optional persistence adapter. */
  readonly persistence?: AffinityPersistencePort;
}

const DEFAULT_MAX_RECORDS = 5_000;
const DEFAULT_SIMILARITY_FLOOR = 0.5;
const DEFAULT_AFFINITY_WEIGHT = 1.0;
const COLD_START_SCORE = 0.5;

// ─────────────────────────────────────────────────────────────────────
// Class
// ─────────────────────────────────────────────────────────────────────

export class ToolAffinityTracker {
  private records: ToolUsageRecord[] = [];
  private readonly maxRecords: number;
  private readonly similarityFloor: number;
  private readonly affinityWeight: number;
  private readonly persistence: AffinityPersistencePort | null;

  constructor(config: ToolAffinityTrackerConfig = {}) {
    this.maxRecords =
      typeof config.maxRecords === 'number' && config.maxRecords > 0
        ? Math.floor(config.maxRecords)
        : DEFAULT_MAX_RECORDS;
    this.similarityFloor =
      typeof config.similarityFloor === 'number' &&
      config.similarityFloor >= -1 &&
      config.similarityFloor <= 1
        ? config.similarityFloor
        : DEFAULT_SIMILARITY_FLOOR;
    this.affinityWeight =
      typeof config.affinityWeight === 'number' && config.affinityWeight >= 0
        ? config.affinityWeight
        : DEFAULT_AFFINITY_WEIGHT;
    this.persistence = config.persistence ?? null;
  }

  /**
   * Hydrate the in-memory buffer from the persistence port. Safe to call
   * at boot; idempotent.
   */
  async hydrate(): Promise<void> {
    if (this.persistence === null) return;
    try {
      const rows = await this.persistence.load();
      if (Array.isArray(rows) && rows.length > 0) {
        this.records = rows.slice(-this.maxRecords).map((r) => ({ ...r }));
      }
    } catch {
      // Persistence is best-effort. A failed hydrate leaves the tracker
      // in cold-start mode rather than blocking boot.
    }
  }

  recordToolUsage(record: ToolUsageRecord): void {
    if (!isValidRecord(record)) return;
    const snapshot: ToolUsageRecord = {
      intent_embedding: [...record.intent_embedding],
      tool_name: record.tool_name,
      success: record.success === true,
      latency_ms: Number.isFinite(record.latency_ms) ? record.latency_ms : 0,
      cost_usd: Number.isFinite(record.cost_usd) ? record.cost_usd : 0,
      ts: record.ts,
    };
    this.records.push(snapshot);
    if (this.records.length > this.maxRecords) {
      this.records.splice(0, this.records.length - this.maxRecords);
    }
    if (this.persistence !== null) {
      // Fire-and-forget; persistence errors must not bubble into the
      // hot path. The composition root logs failures via the port.
      void this.persistence.append(snapshot).catch(() => undefined);
    }
  }

  /**
   * Return a number in [0, 1] representing the cosine-weighted success
   * rate of past invocations whose intent embedding is close to the
   * query embedding. Cold start returns 0.5.
   */
  getAffinityScore(
    intentEmbedding: ReadonlyArray<number>,
    toolName: string,
  ): number {
    if (!Array.isArray(intentEmbedding) || intentEmbedding.length === 0) {
      return COLD_START_SCORE;
    }
    if (typeof toolName !== 'string' || toolName.length === 0) {
      return COLD_START_SCORE;
    }

    let totalWeight = 0;
    let successWeight = 0;
    for (const r of this.records) {
      if (r.tool_name !== toolName) continue;
      if (r.intent_embedding.length !== intentEmbedding.length) continue;
      const sim = cosineSimilarity(intentEmbedding, r.intent_embedding);
      if (sim < this.similarityFloor) continue;
      const weight = Math.max(0, sim);
      totalWeight += weight;
      if (r.success === true) successWeight += weight;
    }
    if (totalWeight === 0) return COLD_START_SCORE;
    return clamp01(successWeight / totalWeight);
  }

  /**
   * Re-rank a base ranking using affinity. The base ranking carries
   * positional information (top → bottom). The output combines a
   * normalised position score with the affinity score so that:
   *   - all-cold-start input → output equals input (stable sort)
   *   - strong-positive affinity floats a lower-ranked tool up
   *   - strong-negative affinity pushes a top-ranked tool down
   */
  reRankWithAffinity<T extends { readonly name: string }>(
    baseRanking: ReadonlyArray<T>,
    intentEmbedding: ReadonlyArray<number>,
  ): ReadonlyArray<T> {
    if (!Array.isArray(baseRanking) || baseRanking.length === 0) {
      return [];
    }
    if (!Array.isArray(intentEmbedding) || intentEmbedding.length === 0) {
      return [...baseRanking];
    }
    const N = baseRanking.length;
    const scored = baseRanking.map((tool, idx) => {
      const positionScore = (N - idx) / N; // 1.0 for top, → 0 for bottom
      const affinity = this.getAffinityScore(intentEmbedding, tool.name);
      // Centre affinity around 0 so a neutral tool contributes 0 lift.
      const lift = (affinity - COLD_START_SCORE) * 2 * this.affinityWeight;
      return { tool, idx, score: positionScore + lift };
    });
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.idx - b.idx;
    });
    return scored.map((s) => s.tool);
  }

  /** Test seam — number of records currently held. */
  size(): number {
    return this.records.length;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Math helpers
// ─────────────────────────────────────────────────────────────────────

export function cosineSimilarity(
  a: ReadonlyArray<number>,
  b: ReadonlyArray<number>,
): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i] as number;
    const bi = b[i] as number;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function isValidRecord(record: ToolUsageRecord): boolean {
  if (!record || typeof record !== 'object') return false;
  if (!Array.isArray(record.intent_embedding)) return false;
  if (record.intent_embedding.length === 0) return false;
  if (typeof record.tool_name !== 'string' || record.tool_name.length === 0) {
    return false;
  }
  if (typeof record.ts !== 'string' || record.ts.length === 0) return false;
  return true;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return COLD_START_SCORE;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
