/**
 * Stage 02 — Cluster.
 *
 * Groups traces by intent / failure mode. A real implementation would
 * embed each trace summary and cluster in vector space (HDBSCAN /
 * agglomerative); the production hook lives at the composition root.
 *
 * The default in-worker implementation is **keyword-bucketed**:
 *   - extract a small bag of property-management vocabulary tokens
 *     from each summary
 *   - bucket by (tenantId, normalised-token-set)
 *
 * That keeps the worker self-contained for unit tests and exercises
 * the same downstream interface the real clusterer will satisfy.
 *
 * Outcome scoring per cluster:
 *   + 0.5 per thumbs-up; + 0.7 * strength per copy / time-to-resolution
 *   - 0.7 * strength per thumbs-down / correction / re-prompt /
 *     edit-resubmit / override / abandonment
 *   Normalised to [-1, 1] by signal count.
 */

import { randomUUID } from 'crypto';
import type {
  FeedbackEntry,
  ImplicitSignalEntry,
  IngestBundle,
  StageLogger,
  TraceCluster,
  TraceEntry,
} from './types.js';

export interface ClusterArgs {
  readonly bundle: IngestBundle;
  readonly logger: StageLogger;
  /**
   * Optional override — when wired the orchestrator can swap in a
   * real embedding-based clusterer at the composition root.
   */
  readonly clusterer?: (
    bundle: IngestBundle,
  ) => Promise<ReadonlyArray<TraceCluster>>;
}

export async function runClusterStage(
  args: ClusterArgs,
): Promise<ReadonlyArray<TraceCluster>> {
  try {
    const clusters = args.clusterer
      ? await args.clusterer(args.bundle)
      : keywordCluster(args.bundle);
    args.logger.info(
      {
        stage: '02-cluster',
        clusters: clusters.length,
        traces: args.bundle.traces.length,
      },
      'cluster stage complete',
    );
    return clusters;
  } catch (error) {
    args.logger.warn(
      { stage: '02-cluster', err: asMessage(error) },
      'cluster stage failed — degrading to empty',
    );
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// In-worker keyword clusterer (fallback / unit-test default)
// ─────────────────────────────────────────────────────────────────────

const VOCAB: ReadonlyArray<{ label: string; rxs: RegExp[] }> = [
  {
    label: 'late-rent-reminder',
    rxs: [/late\s*rent/i, /overdue/i, /reminder/i, /arrears/i],
  },
  {
    label: 'lease-draft',
    rxs: [/lease/i, /contract/i, /agreement/i, /clause/i],
  },
  {
    label: 'maintenance-ticket',
    rxs: [/maintenance/i, /repair/i, /ticket/i, /work\s*order/i, /leak/i],
  },
  {
    label: 'prorated-charge',
    rxs: [/prorated|prorate/i, /mid[- ]month/i, /partial/i],
  },
  {
    label: 'unit-vacancy',
    rxs: [/vacan(?:t|cy)/i, /occupanc/i, /move[- ](?:in|out)/i],
  },
  {
    label: 'payment-plan',
    rxs: [/payment\s*plan/i, /instal+ment/i, /repayment/i],
  },
  {
    label: 'inspection',
    rxs: [/inspection/i, /walkthrough/i, /move-?out/i],
  },
];

function keywordCluster(bundle: IngestBundle): ReadonlyArray<TraceCluster> {
  // index signals + feedback by traceId for outcome scoring
  const signalsByTrace = new Map<string, ImplicitSignalEntry[]>();
  for (const s of bundle.implicitSignals) {
    const bucket = signalsByTrace.get(s.traceId);
    if (bucket) bucket.push(s);
    else signalsByTrace.set(s.traceId, [s]);
  }
  // we key feedback by thoughtId which the traces array carries as
  // `traceId` — that mapping is established by the kernel substrate.
  const feedbackByTrace = new Map<string, FeedbackEntry[]>();
  for (const f of bundle.explicitFeedback) {
    const bucket = feedbackByTrace.get(f.thoughtId);
    if (bucket) bucket.push(f);
    else feedbackByTrace.set(f.thoughtId, [f]);
  }

  const buckets = new Map<string, TraceEntry[]>();
  for (const t of bundle.traces) {
    const label = matchVocab(t.summary);
    const key = `${t.tenantId ?? ''}::${label}`;
    const arr = buckets.get(key);
    if (arr) arr.push(t);
    else buckets.set(key, [t]);
  }

  const clusters: TraceCluster[] = [];
  for (const [key, traces] of buckets.entries()) {
    if (traces.length === 0) continue;
    const [tenantPart, label] = key.split('::', 2);
    const tenantId = tenantPart && tenantPart.length > 0 ? tenantPart : null;
    let score = 0;
    let signalsCounted = 0;
    for (const t of traces) {
      const traceSignals = signalsByTrace.get(t.traceId) ?? [];
      const traceFeedback = feedbackByTrace.get(t.traceId) ?? [];
      for (const s of traceSignals) {
        signalsCounted += 1;
        const direction = signedSignalWeight(s);
        score += direction;
      }
      for (const f of traceFeedback) {
        signalsCounted += 1;
        if (f.signal === 'thumbs-up') score += 0.5;
        else if (f.signal === 'thumbs-down') score -= 0.7;
        else if (f.signal === 'correction') score -= 0.6;
      }
    }
    const normalised =
      signalsCounted > 0 ? clamp(score / signalsCounted, -1, 1) : 0;
    const outcome: TraceCluster['outcome'] =
      normalised >= 0.3 ? 'success' : normalised <= -0.3 ? 'failure' : 'mixed';
    clusters.push({
      clusterId: `cls_${randomUUID()}`,
      tenantId,
      intentLabel: label ?? 'unknown',
      traces,
      outcome,
      score: normalised,
      signalsInside: signalsCounted,
    });
  }
  return clusters;
}

function matchVocab(summary: string): string {
  const s = summary ?? '';
  for (const v of VOCAB) {
    for (const rx of v.rxs) {
      if (rx.test(s)) return v.label;
    }
  }
  return 'unknown';
}

function signedSignalWeight(s: ImplicitSignalEntry): number {
  const strength = clamp(s.strength, 0, 1);
  switch (s.signalType) {
    case 'copy':
    case 'time-to-resolution':
      return 0.7 * strength;
    case 're-prompt':
    case 'edit-resubmit':
    case 'override':
    case 'abandonment':
      return -0.7 * strength;
    default:
      return 0;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
