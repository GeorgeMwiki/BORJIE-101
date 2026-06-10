/**
 * Causal DAG + do-calculus-lite ROOT-CAUSE engine (Wave D — causal reasoning).
 *
 * THE GAP THIS CLOSES. Today Mr. Mwikila SHOWS that cash dipped while, in the
 * same window, the royalty filing was late AND production softened — but it
 * gestures at CORRELATION and lets the owner guess the REASON. This lets the
 * brain say, with evidence: "cash dipped BECAUSE of the late royalty filing —
 * production is a red herring; it moved too, but its move was small and its
 * causal route to cash is weaker." A wrong root cause is worse than none, so
 * when nothing clears the confidence floor the engine returns an explicit
 * { established: false, reason } — never a fabricated causal claim.
 *
 * TWO STAGES.
 * 1. buildCausalDag(db, tenantId) — the estate's observable METRICS (cash
 *    runway, sales receipts, production tonnage, royalty-filing timeliness) are
 *    the causal nodes; a small DOMAIN-PRIOR set of candidate directed edges is
 *    the hypothesis space. A candidate is PROMOTED to a causal edge only if it
 *    validates against this tenant's history: (a) TEMPORAL PRECEDENCE — the
 *    cause leads the effect by a non-negative lag — and (b) lagged CORRELATION
 *    above a strength floor over enough paired observations. Failing candidates
 *    are DROPPED (never an unvalidated cause). ACYCLIC by construction: a
 *    cycle-break keeps the strongest temporally-valid edge.
 * 2. explainRootCause(dag, { metric, observedDeltaPct, asOf }) — walks UPSTREAM
 *    from the moved KPI and scores each ancestor by (path strength × the
 *    ancestor's OWN realized move). A node earns leverage only if it ITSELF
 *    moved AND has a validated route. Returns the top cause + ranked list +
 *    "ruled out" red herrings + confidence + evidence, or { established: false,
 *    reason } when nothing clears the floor.
 *
 * The LEAF layer — the metric model, the tunables, the pure numeric helpers
 * (pearson / day-bucketing / edgeConfidence / bestLaggedFit / realizedMove) and
 * the four tenant-scoped windowed series readers — lives in the sibling
 * `causal-dag-series.ts` (file-size cap) and is re-exported here so this module
 * stays the single public import surface for consumers + tests. This file owns
 * the ENGINE orchestration: the DAG types, the domain-prior candidate edges,
 * edge validation wiring, acyclicity, buildCausalDag and explainRootCause.
 *
 * HARD RAILS (BORJIE). TENANT-SCOPED: every read carries `tenant_id =
 * ${tenantId}` and runs inside a pinned/`withTenantContext` handle so RLS FORCE
 * also filters server-side. READ-ONLY ANALYSIS: never writes accounting truth
 * (money path stays LedgerService-only), never actuates — a "commit as plan"
 * consumer must route through the governed action membrane; this only explains.
 * HONEST-DEGRADE: a missing table / thin window / sub-floor support yields a
 * dropped edge or { established: false }, never a guess. IMMUTABLE (frozen
 * results). PINO ONLY (no `console.*`).
 *
 * Companion to postgres-kg-store.ts + estate-baseline-computer.ts (same
 * windowed-series reader idiom: forecasts / production_tonnage_events / sales /
 * royalty_return_drafts, fault-isolated per metric).
 */

import { createLogger } from '../../utils/logger.js';
import {
  MS_PER_DAY,
  DEFAULT_CAUSAL_WINDOW_DAYS,
  MIN_EDGE_STRENGTH,
  MIN_PAIRED_OBSERVATIONS,
  ROOT_CAUSE_CONFIDENCE_FLOOR,
  MIN_REALIZED_MOVE,
  METRIC_READERS,
  bestLaggedFit,
  edgeConfidence,
  realizedMove,
  type CausalDbExecLike,
  type CausalMetric,
  type MetricPoint,
  type MetricSeries,
} from './causal-dag-series.js';

// Re-export the leaf layer so this module remains the single public import
// surface for consumers + tests (pure-move refactor; no behaviour change).
export {
  MS_PER_DAY,
  DEFAULT_CAUSAL_WINDOW_DAYS,
  MIN_EDGE_STRENGTH,
  MIN_PAIRED_OBSERVATIONS,
  ROOT_CAUSE_CONFIDENCE_FLOOR,
  CANDIDATE_LAG_DAYS,
  MIN_REALIZED_MOVE,
  dayBucket,
  pearson,
  bucketize,
  bestLaggedFit,
  edgeConfidence,
  realizedMove,
} from './causal-dag-series.js';
export type {
  CausalDbExecLike,
  CausalMetric,
  MetricPoint,
  MetricSeries,
  MetricReaderSpec,
  LagFit,
} from './causal-dag-series.js';

const logger = createLogger('causal-dag');

// ───────────────────────────────────────────────────────────────────────────
// Metric model — ordered list of the canonical metrics (the nodes).
// ───────────────────────────────────────────────────────────────────────────

const ALL_METRICS: ReadonlyArray<CausalMetric> = Object.freeze([
  'cash_runway',
  'sales_receipts',
  'production_tonnage',
  'royalty_filing_lateness',
]);

// ───────────────────────────────────────────────────────────────────────────
// Causal DAG types
// ───────────────────────────────────────────────────────────────────────────

/** A validated causal edge `from → to` with strength / confidence / lag. */
export interface CausalEdge {
  readonly from: CausalMetric;
  readonly to: CausalMetric;
  /** |lagged correlation| in [0,1]; the do-calculus-lite "strength". */
  readonly strength: number;
  /** Validation confidence in [0,1] — strength tempered by sample support. */
  readonly confidence: number;
  /** Best-fit lag (days) by which the cause leads the effect (≥ 0). */
  readonly lagDays: number;
  /** Sign of the relationship (+1 same-direction, −1 inverse). */
  readonly sign: 1 | -1;
  /** Number of paired observations the validation rested on. */
  readonly support: number;
}

/** A node in the causal DAG — one estate metric. */
export interface CausalNode {
  readonly metric: CausalMetric;
  /** Whether this tenant had any series data for the metric. */
  readonly hasData: boolean;
  readonly points: number;
}

/** The tenant's validated causal DAG. Acyclic by construction. */
export interface CausalDag {
  readonly tenantId: string;
  readonly nodes: ReadonlyArray<CausalNode>;
  readonly edges: ReadonlyArray<CausalEdge>;
  /** Candidate edges that were DROPPED, with the reason — auditable honesty. */
  readonly dropped: ReadonlyArray<DroppedCandidate>;
  /** The window the series were sampled over. */
  readonly windowDays: number;
  readonly asOf: number;
  /**
   * The metric series the DAG was built from — exposed so a consumer
   * (explainRootCause ancestor scoring, the counterfactual baseline) uses the
   * SAME data, not a divergent re-read. Without this, root-cause scoring
   * degrades to edge-strength-only and can never establish a cause.
   */
  readonly series: ReadonlyArray<MetricSeries>;
}

export interface DroppedCandidate {
  readonly from: CausalMetric;
  readonly to: CausalMetric;
  readonly reason:
    | 'no_temporal_precedence'
    | 'below_strength_floor'
    | 'insufficient_paired_data'
    | 'cycle_break_weaker_edge'
    | 'no_series';
}

// ───────────────────────────────────────────────────────────────────────────
// Domain-prior candidate edges — the estate's causal STRUCTURE (what *could*
// cause what) and the ONLY hypotheses the validator may promote. Each asserts a
// mechanism the data must then confirm with precedence + lagged correlation;
// the set is acyclic by design.
//   production → sales       more ore mined feeds more saleable inventory
//   sales      → cash        sale receipts replenish runway
//   production → cash        direct (sold-at-pit / advances) shortcut path
//   royalty_late → cash      late filing → penalty / blocked disbursement
//   production → royalty_late larger return → more likely to slip its window
// ───────────────────────────────────────────────────────────────────────────

interface CandidateEdge {
  readonly from: CausalMetric;
  readonly to: CausalMetric;
}

const CANDIDATE_EDGES: ReadonlyArray<CandidateEdge> = Object.freeze([
  { from: 'production_tonnage', to: 'sales_receipts' },
  { from: 'sales_receipts', to: 'cash_runway' },
  { from: 'production_tonnage', to: 'cash_runway' },
  { from: 'royalty_filing_lateness', to: 'cash_runway' },
  { from: 'production_tonnage', to: 'royalty_filing_lateness' },
]);

// ───────────────────────────────────────────────────────────────────────────
// Acyclicity guard — keep the strongest temporally-valid edge on any cycle.
// ───────────────────────────────────────────────────────────────────────────

/** Greedily admit validated edges strongest-first, skipping any that would
 *  introduce a cycle. Admitting strongest-first means a residual cycle is always
 *  broken by dropping the WEAKER back-edge (the mandated tie-break). Returns the
 *  acyclic accepted set + the cycle-broken drops. */
function enforceAcyclic(
  edges: ReadonlyArray<CausalEdge>,
): { kept: ReadonlyArray<CausalEdge>; dropped: ReadonlyArray<DroppedCandidate> } {
  const ordered = [...edges].sort((a, b) => b.strength - a.strength);
  const adjacency = new Map<CausalMetric, Set<CausalMetric>>();
  const kept: CausalEdge[] = [];
  const dropped: DroppedCandidate[] = [];

  const reaches = (start: CausalMetric, target: CausalMetric): boolean => {
    // DFS over current accepted adjacency: does `start` already reach `target`?
    const stack: CausalMetric[] = [start];
    const seen = new Set<CausalMetric>();
    while (stack.length > 0) {
      const cur = stack.pop() as CausalMetric;
      if (cur === target) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const nxt of adjacency.get(cur) ?? []) stack.push(nxt);
    }
    return false;
  };

  for (const e of ordered) {
    // Adding from→to creates a cycle iff `to` already reaches `from`.
    if (reaches(e.to, e.from)) {
      dropped.push({ from: e.from, to: e.to, reason: 'cycle_break_weaker_edge' });
      continue;
    }
    kept.push(e);
    const set = adjacency.get(e.from) ?? new Set<CausalMetric>();
    set.add(e.to);
    adjacency.set(e.from, set);
  }
  return { kept, dropped };
}

// ───────────────────────────────────────────────────────────────────────────
// Public: buildCausalDag
// ───────────────────────────────────────────────────────────────────────────

export interface BuildCausalDagOptions {
  readonly windowDays?: number;
  readonly minStrength?: number;
  readonly minPairedObservations?: number;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => number;
  /** Pre-read series (test seam): when set, DB readers are bypassed and these
   *  series are validated directly. Production callers omit this. */
  readonly seriesOverride?: ReadonlyArray<MetricSeries>;
}

/**
 * Build the tenant's validated causal DAG. Reads each metric's windowed series
 * (fault-isolated), promotes each domain-prior candidate edge that clears
 * temporal precedence + the strength floor + minimum paired support, then
 * enforces acyclicity. Returns a frozen DAG; a tenant with no series yields a
 * DAG of data-less nodes and zero edges (honest-degrade) — never a guess.
 */
export async function buildCausalDag(
  db: CausalDbExecLike | null | undefined,
  tenantId: string,
  options: BuildCausalDagOptions = {},
): Promise<CausalDag> {
  const windowDays =
    Number.isFinite(options.windowDays) && (options.windowDays as number) > 0
      ? Math.floor(options.windowDays as number)
      : DEFAULT_CAUSAL_WINDOW_DAYS;
  const minStrength =
    Number.isFinite(options.minStrength) && (options.minStrength as number) >= 0
      ? (options.minStrength as number)
      : MIN_EDGE_STRENGTH;
  const minPairs =
    Number.isFinite(options.minPairedObservations) &&
    (options.minPairedObservations as number) >= 2
      ? Math.floor(options.minPairedObservations as number)
      : MIN_PAIRED_OBSERVATIONS;
  const nowMs = options.now?.() ?? Date.now();
  const cutoff = new Date(nowMs - windowDays * MS_PER_DAY);

  // 1. Gather each metric's series (override seam OR fault-isolated DB reads).
  const seriesByMetric = new Map<CausalMetric, ReadonlyArray<MetricPoint>>();
  if (options.seriesOverride) {
    for (const s of options.seriesOverride) {
      seriesByMetric.set(s.metric, s.points);
    }
  } else if (db && tenantId) {
    const read = await Promise.all(
      METRIC_READERS.map(async (spec): Promise<[CausalMetric, ReadonlyArray<MetricPoint>]> => {
        try {
          const pts = await spec.read(db, tenantId, cutoff);
          return [spec.metric, pts];
        } catch {
          // Missing table / column / read fault → no series for this metric.
          // A single metric failing must not abort the others (honest-degrade).
          return [spec.metric, []];
        }
      }),
    );
    for (const [metric, pts] of read) seriesByMetric.set(metric, pts);
  }

  const nodes: ReadonlyArray<CausalNode> = ALL_METRICS.map((metric): CausalNode => {
    const pts = seriesByMetric.get(metric) ?? [];
    return Object.freeze({ metric, hasData: pts.length > 0, points: pts.length });
  });

  // 2. Validate each candidate edge against history.
  const validated: CausalEdge[] = [];
  const dropped: DroppedCandidate[] = [];
  for (const cand of CANDIDATE_EDGES) {
    const cause = seriesByMetric.get(cand.from) ?? [];
    const effect = seriesByMetric.get(cand.to) ?? [];
    if (cause.length === 0 || effect.length === 0) {
      dropped.push({ from: cand.from, to: cand.to, reason: 'no_series' });
      continue;
    }
    const fit = bestLaggedFit(cause, effect, minPairs);
    if (fit === null) {
      dropped.push({ from: cand.from, to: cand.to, reason: 'insufficient_paired_data' });
      continue;
    }
    const strength = Math.abs(fit.r);
    if (strength < minStrength) {
      dropped.push({ from: cand.from, to: cand.to, reason: 'below_strength_floor' });
      continue;
    }
    // Temporal precedence: bestLaggedFit only scans lag ≥ 0 (cause leads/is
    // contemporaneous), so this guard documents + future-proofs the invariant.
    if (fit.lagDays < 0) {
      dropped.push({ from: cand.from, to: cand.to, reason: 'no_temporal_precedence' });
      continue;
    }
    const sign: 1 | -1 = fit.r >= 0 ? 1 : -1;
    validated.push(
      Object.freeze({
        from: cand.from,
        to: cand.to,
        strength,
        confidence: edgeConfidence(strength, fit.support),
        lagDays: fit.lagDays,
        sign,
        support: fit.support,
      }) satisfies CausalEdge,
    );
  }

  // 3. Enforce acyclicity (keep the strongest temporally-valid edge on a cycle).
  const { kept, dropped: cycleDropped } = enforceAcyclic(validated);

  logger.debug(
    {
      tenantId,
      nodes: nodes.length,
      validatedEdges: kept.length,
      droppedCandidates: dropped.length + cycleDropped.length,
      windowDays,
    },
    'built causal DAG',
  );

  return Object.freeze({
    tenantId,
    nodes: Object.freeze(nodes),
    edges: Object.freeze(kept),
    dropped: Object.freeze([...dropped, ...cycleDropped]),
    windowDays,
    asOf: nowMs,
    series: Object.freeze(
      ALL_METRICS.map(
        (m): MetricSeries =>
          Object.freeze({ metric: m, points: seriesByMetric.get(m) ?? [] }),
      ),
    ),
  }) satisfies CausalDag;
}

// ───────────────────────────────────────────────────────────────────────────
// Public: explainRootCause
// ───────────────────────────────────────────────────────────────────────────

export interface ExplainRootCauseInput {
  /** The KPI that was observed to move. */
  readonly metric: CausalMetric;
  /** The observed fractional move of the KPI (e.g. −0.18 for a −18% dip). */
  readonly observedDeltaPct: number;
  /** As-of epoch ms (informational; the DAG already fixed its window). */
  readonly asOf?: number;
  /** The per-metric series the DAG was built from, so ancestors are scored by
   *  their OWN realized move. Omitting it falls back to edge strength alone. */
  readonly series?: ReadonlyArray<MetricSeries>;
}

/** One scored upstream candidate cause. */
export interface RankedCause {
  readonly metric: CausalMetric;
  /** leverage = path strength × |ancestor realized move|. */
  readonly leverage: number;
  /** The validated edge strength on the best path to the KPI. */
  readonly pathStrength: number;
  /** The ancestor's own realized fractional move in the window. */
  readonly realizedMove: number;
  /** Total lag (days) along the best causal path to the KPI. */
  readonly lagDays: number;
  readonly confidence: number;
  readonly evidenceIds: ReadonlyArray<string>;
}

export type RootCauseResult =
  | {
      readonly established: true;
      /** The single highest-leverage upstream cause. */
      readonly rootCause: RankedCause;
      /** All scored upstream candidates, leverage-descending (incl. rootCause). */
      readonly ranked: ReadonlyArray<RankedCause>;
      /** Ancestors that moved but whose causal route was too weak — red herrings. */
      readonly ruledOut: ReadonlyArray<RankedCause>;
      readonly confidence: number;
      readonly metric: CausalMetric;
      readonly observedDeltaPct: number;
    }
  | {
      readonly established: false;
      readonly reason: string;
      readonly metric: CausalMetric;
      readonly observedDeltaPct: number;
      /** Whatever weak candidates existed, surfaced for transparency. */
      readonly ranked: ReadonlyArray<RankedCause>;
    };

/**
 * Walk UPSTREAM from the moved KPI and name its highest-leverage cause. For
 * each ancestor with a validated causal PATH we take the strongest-product path
 * and score it by `pathStrength × |ancestor realized move|`. An ancestor earns
 * leverage only if it ITSELF moved (> MIN_REALIZED_MOVE) AND has a validated
 * route — separating the real cause from a red herring that merely co-moved.
 * Returns the top cause + ranked list + ruled-out herrings + confidence +
 * evidence, or { established: false, reason } when no ancestor clears
 * ROOT_CAUSE_CONFIDENCE_FLOOR (or the KPI has no validated upstream at all).
 */
export function explainRootCause(
  dag: CausalDag,
  input: ExplainRootCauseInput,
): RootCauseResult {
  const { metric, observedDeltaPct } = input;

  // Index validated edges by their TARGET for upstream traversal.
  const incoming = new Map<CausalMetric, ReadonlyArray<CausalEdge>>();
  for (const e of dag.edges) {
    incoming.set(e.to, [...(incoming.get(e.to) ?? []), e]);
  }

  // Per-metric realized move + evidence, from the series the DAG was built on.
  const seriesByMetric = new Map<CausalMetric, ReadonlyArray<MetricPoint>>();
  for (const s of input.series ?? []) seriesByMetric.set(s.metric, s.points);
  const moveOf = (m: CausalMetric): number => {
    const pts = seriesByMetric.get(m);
    return pts ? realizedMove(pts) : 0;
  };
  const evidenceOf = (m: CausalMetric): ReadonlyArray<string> => {
    const pts = seriesByMetric.get(m) ?? [];
    // Dedupe + cap the evidence trail so the citation stays legible.
    return Object.freeze([...new Set(pts.map((p) => p.evidenceId))].slice(0, 12));
  };

  // Best causal PATH from each ancestor to the KPI: strongest product of edge
  // strengths (accumulating lag, min-ing confidence) via a bounded BFS upstream.
  interface PathInfo {
    readonly pathStrength: number;
    readonly lagDays: number;
    readonly confidence: number;
  }
  interface QueueItem {
    readonly node: CausalMetric;
    readonly strength: number;
    readonly lag: number;
    readonly conf: number;
  }
  const best = new Map<CausalMetric, PathInfo>();
  const queue: QueueItem[] = [];
  for (const e of incoming.get(metric) ?? []) {
    queue.push({ node: e.from, strength: e.strength, lag: e.lagDays, conf: e.confidence });
  }
  // DAG ⇒ no infinite walk; this depth bound is belt-and-braces.
  let guard = dag.nodes.length * dag.edges.length + dag.edges.length + 1;
  while (queue.length > 0 && guard-- > 0) {
    const cur = queue.shift() as QueueItem;
    const prior = best.get(cur.node);
    if (!prior || cur.strength > prior.pathStrength) {
      best.set(cur.node, {
        pathStrength: cur.strength,
        lagDays: cur.lag,
        confidence: cur.conf,
      });
      for (const e of incoming.get(cur.node) ?? []) {
        queue.push({
          node: e.from,
          strength: cur.strength * e.strength,
          lag: cur.lag + e.lagDays,
          conf: Math.min(cur.conf, e.confidence),
        });
      }
    }
  }

  // Score each reachable ancestor by leverage = pathStrength × |realized move|.
  const scored: RankedCause[] = [];
  for (const [m, info] of best) {
    const move = moveOf(m);
    const leverage = info.pathStrength * Math.abs(move);
    scored.push({
      metric: m,
      leverage,
      pathStrength: info.pathStrength,
      realizedMove: move,
      lagDays: info.lagDays,
      confidence: info.confidence,
      evidenceIds: evidenceOf(m),
    });
  }
  scored.sort((a, b) => b.leverage - a.leverage);

  if (scored.length === 0) {
    return Object.freeze({
      established: false as const,
      reason: `no validated causal ancestor for ${metric}; cannot establish a cause`,
      metric,
      observedDeltaPct,
      ranked: Object.freeze([]),
    });
  }

  // A node is a real candidate only if it ITSELF moved meaningfully. Ancestors
  // that did not move (or barely moved) are red herrings regardless of edge
  // strength — they cannot explain a KPI move they did not participate in.
  const movers = scored.filter((c) => Math.abs(c.realizedMove) >= MIN_REALIZED_MOVE);
  const nonMovers = scored.filter((c) => Math.abs(c.realizedMove) < MIN_REALIZED_MOVE);

  const top = movers[0];
  if (!top || top.confidence < ROOT_CAUSE_CONFIDENCE_FLOOR || top.leverage <= 0) {
    return Object.freeze({
      established: false as const,
      reason:
        top === undefined
          ? `no upstream metric moved enough to explain the ${metric} change; cannot establish a cause`
          : `best candidate '${top.metric}' confidence ${top.confidence.toFixed(2)} is below the ${ROOT_CAUSE_CONFIDENCE_FLOOR} floor; cannot establish a cause`,
      metric,
      observedDeltaPct,
      ranked: Object.freeze(scored),
    });
  }

  // Red herrings = scored ancestors that are NOT the top cause: either they
  // moved but lost on leverage, or they did not move at all.
  const ruledOut = Object.freeze([
    ...movers.slice(1),
    ...nonMovers,
  ]);

  logger.debug(
    {
      tenantId: dag.tenantId,
      metric,
      rootCause: top.metric,
      leverage: top.leverage,
      confidence: top.confidence,
      ruledOut: ruledOut.map((r) => r.metric),
    },
    'explained root cause',
  );

  return Object.freeze({
    established: true as const,
    rootCause: top,
    ranked: Object.freeze(scored),
    ruledOut,
    confidence: top.confidence,
    metric,
    observedDeltaPct,
  });
}
