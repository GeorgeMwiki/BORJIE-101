/**
 * Memory Recall Bench — runner.
 *
 * Phase D fix-wave (A4) — closes parity gap "Memory recall bench"
 * (`.planning/parity-litfin/08-eval-judge.md` Gap 8).
 *
 * Given a `MemoryHierarchy` + a seeded `RecallSample` corpus:
 *
 *   1. Drives the appropriate recall API per tier.
 *   2. Computes exact-match (sample.id appears in top-k) and token-F1
 *      (best-matching candidate's stringified value vs expectedAnswer).
 *   3. Returns a deterministic, immutable `RecallBenchReport`.
 *
 * No I/O. Adapters bind in-memory fakes; production runs use Drizzle
 * services + a baseline corpus offline.
 */

import { tokenF1 } from './tokenize.js';
import type {
  RecallBenchInput,
  RecallBenchReport,
  RecallMetric,
  RecallSample,
} from './types.js';

const DEFAULT_TOP_K = 5;

/** Stable JSON stringify for token-F1 scoring. */
function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

interface Candidate {
  readonly id: string;
  readonly text: string;
}

async function recallEpisodic(
  input: RecallBenchInput,
  sample: RecallSample,
  topK: number,
): Promise<ReadonlyArray<Candidate>> {
  const port = input.memory.episodic;
  if (!port || !sample.userId) return [];
  const recalled = await port.recall({
    tenantId: sample.tenantId,
    userId: sample.userId,
    limit: topK,
  });
  return recalled.map((row) => ({
    id: row.id,
    text: `${row.summary} ${stringify(row.payload)}`,
  }));
}

async function recallSemantic(
  input: RecallBenchInput,
  sample: RecallSample,
  topK: number,
): Promise<ReadonlyArray<Candidate>> {
  const port = input.memory.semantic;
  if (!port) return [];
  const key = typeof sample.fact.key === 'string' ? sample.fact.key : undefined;
  // Prefer exact lookup when sample has a key; fall back to prefix search.
  if (key) {
    const hit = await port.lookup({
      tenantId: sample.tenantId,
      userId: sample.userId ?? null,
      key,
    });
    if (hit) return [{ id: hit.id, text: stringify(hit.value) }];
  }
  const rows = await port.search({
    tenantId: sample.tenantId,
    userId: sample.userId ?? null,
    limit: topK,
  });
  return rows.map((row) => ({ id: row.id, text: stringify(row.value) }));
}

async function recallProcedural(
  input: RecallBenchInput,
  sample: RecallSample,
  topK: number,
): Promise<ReadonlyArray<Candidate>> {
  const port = input.memory.procedural;
  if (!port || !sample.userId) return [];
  const matches = await port.match({
    tenantId: sample.tenantId,
    userId: sample.userId,
    userMessage: sample.query,
    limit: topK,
  });
  return matches.map((row) => ({
    id: row.id,
    text: `${row.patternName} ${row.toolSequence.join(' ')}`,
  }));
}

async function recallReflective(
  input: RecallBenchInput,
  sample: RecallSample,
  topK: number,
): Promise<ReadonlyArray<Candidate>> {
  const port = input.memory.reflective;
  if (!port) return [];
  const periodKind =
    typeof sample.fact.periodKind === 'string'
      ? (sample.fact.periodKind as 'daily' | 'weekly' | 'monthly')
      : 'daily';
  const rows = await port.latest({
    tenantId: sample.tenantId,
    userId: sample.userId ?? null,
    periodKind,
    n: topK,
  });
  return rows.map((row) => ({ id: row.id, text: row.summary }));
}

async function recallForTier(
  input: RecallBenchInput,
  sample: RecallSample,
  topK: number,
): Promise<ReadonlyArray<Candidate>> {
  switch (sample.tier) {
    case 'episodic':
      return recallEpisodic(input, sample, topK);
    case 'semantic':
      return recallSemantic(input, sample, topK);
    case 'procedural':
      return recallProcedural(input, sample, topK);
    case 'reflective':
      return recallReflective(input, sample, topK);
  }
}

function bestF1(
  candidates: ReadonlyArray<Candidate>,
  expectedAnswer: string,
): number {
  if (candidates.length === 0) return 0;
  let best = 0;
  for (const cand of candidates) {
    const f1 = tokenF1(expectedAnswer, cand.text);
    if (f1 > best) best = f1;
  }
  return best;
}

/**
 * Run the recall bench. Always succeeds; never throws on per-sample
 * failure. Callers compare the report against a baseline.
 */
export async function runRecallBench(
  input: RecallBenchInput,
): Promise<RecallBenchReport> {
  const topK = input.options?.topK ?? DEFAULT_TOP_K;
  const perSample: Array<{
    readonly id: string;
    readonly tier: RecallSample['tier'];
    readonly matched: boolean;
    readonly tokenF1: number;
  }> = [];
  const tierBuckets = new Map<
    RecallSample['tier'],
    { samples: number; exact: number; f1: number }
  >();

  for (const sample of input.samples) {
    let candidates: ReadonlyArray<Candidate>;
    try {
      candidates = await recallForTier(input, sample, topK);
    } catch {
      candidates = [];
    }
    const matched = candidates.some((c) => c.id === sample.id);
    const f1 = bestF1(candidates, sample.expectedAnswer);
    perSample.push({
      id: sample.id,
      tier: sample.tier,
      matched,
      tokenF1: f1,
    });
    const bucket = tierBuckets.get(sample.tier) ?? {
      samples: 0,
      exact: 0,
      f1: 0,
    };
    tierBuckets.set(sample.tier, {
      samples: bucket.samples + 1,
      exact: bucket.exact + (matched ? 1 : 0),
      f1: bucket.f1 + f1,
    });
  }

  const perTier: RecallMetric[] = [];
  let totalExact = 0;
  let totalF1 = 0;
  for (const [tier, bucket] of tierBuckets) {
    perTier.push({
      tier,
      samples: bucket.samples,
      exactMatch: bucket.samples === 0 ? 0 : bucket.exact / bucket.samples,
      tokenF1: bucket.samples === 0 ? 0 : bucket.f1 / bucket.samples,
    });
    totalExact += bucket.exact;
    totalF1 += bucket.f1;
  }
  perTier.sort((a, b) => a.tier.localeCompare(b.tier));

  const total = input.samples.length;
  return {
    totals: {
      samples: total,
      exactMatch: total === 0 ? 0 : totalExact / total,
      tokenF1: total === 0 ? 0 : totalF1 / total,
    },
    perTier,
    perSample,
  };
}
