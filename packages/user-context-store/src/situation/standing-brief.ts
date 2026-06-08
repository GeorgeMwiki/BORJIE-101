/**
 * Standing-brief synthesizer.
 *
 * `buildStandingBrief(tenantId, sources, ctx)` SYNTHESIZES the six-facet
 * per-tenant situational model from injected read-only ports. It is the
 * one queryable artifact the orchestrator reads first each turn.
 *
 * Pipeline per facet: load (port) → map to BriefItem → score salience →
 * sort desc → cap. Then derive `caveats` (uncertainty/abstention) and
 * `nextBestAction` (highest-salience undone item) from the synthesized
 * facets.
 *
 * Pure orchestration of pure builders. Ports are read-only and may throw
 * — every load is guarded so a single failing source degrades to an empty
 * facet rather than sinking the brief.
 *
 * ADDITIVE + READ-ONLY: never writes source state, the audit chain, or
 * the money path. Never gates anything — it INFORMS the brain.
 */
import type {
  BlindSpot,
  BriefItem,
  Caveat,
  FutureItem,
  StandingBrief,
} from './brief-types.js';
import type {
  BlindSpotRecord,
  BriefSources,
  DoingRecord,
  FutureRecord,
  HappenedRecord,
  ToDoRecord,
} from './brief-ports.js';
import { salience, type SalienceContext } from './salience.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface BuildBriefContext extends SalienceContext {
  /** Max items kept per facet after ranking. Default 8. */
  readonly perFacetLimit?: number;
  /**
   * Below this salience, a high-stakes area earns an abstain caveat
   * (semantic-entropy-style: low confidence → escalate, not bluff).
   * Default 0.35.
   */
  readonly abstainThreshold?: number;
}

const DEFAULT_LIMIT = 8;
const DEFAULT_ABSTAIN_THRESHOLD = 0.35;

/**
 * Build the standing brief for a tenant. `tenantId === null` is the
 * platform-internal (HQ) scope.
 */
export async function buildStandingBrief(
  tenantId: string | null,
  sources: BriefSources,
  ctx: BuildBriefContext,
): Promise<StandingBrief> {
  const limit = ctx.perFacetLimit ?? DEFAULT_LIMIT;
  const builtAt = ctx.now().toISOString();

  const [happenedRaw, doingRaw, toDoRaw, futureRaw, blindRaw] =
    await Promise.all([
      safeLoad(sources.happened),
      safeLoad(sources.doing),
      safeLoad(sources.toDo),
      safeLoad(sources.future),
      safeLoad(sources.blindSpots),
    ]);

  const happened = rank(happenedRaw.map((r) => mapHappened(r, ctx)), limit);
  const doing = rank(doingRaw.map((r) => mapDoing(r, ctx)), limit);
  const toDo = rank(toDoRaw.map((r) => mapToDo(r, ctx)), limit);
  const couldMatterLater = rankFuture(
    futureRaw.map((r) => mapFuture(r, ctx)),
    limit,
  );
  const blindSpots = rankBlind(
    blindRaw.map((r) => mapBlind(r, ctx)),
    limit,
  );

  const caveats = deriveCaveats(
    { toDo, blindSpots, couldMatterLater },
    ctx.abstainThreshold ?? DEFAULT_ABSTAIN_THRESHOLD,
  );

  const nextBestAction = pickNextBestAction(toDo);

  return {
    tenantId,
    builtAt,
    happened,
    doing,
    toDo,
    couldMatterLater,
    blindSpots,
    caveats,
    nextBestAction,
  };
}

// ---------------------------------------------------------------------------
// Mappers — record → scored BriefItem
// ---------------------------------------------------------------------------

function mapHappened(r: HappenedRecord, ctx: BuildBriefContext): BriefItem {
  return {
    id: r.id,
    summary: r.summary,
    salience: salience({ at: r.at, importance: r.importance }, ctx),
    at: r.at,
    evidence: [{ kind: r.evidenceKind, id: r.evidenceId }],
  };
}

function mapDoing(r: DoingRecord, ctx: BuildBriefContext): BriefItem {
  return {
    id: r.id,
    summary: r.summary,
    // In-flight work is inherently salient — floor the recency at "now".
    salience: salience({ at: r.startedAt, importance: r.importance }, ctx),
    at: r.startedAt,
    evidence: [{ kind: r.evidenceKind, id: r.evidenceId }],
  };
}

function mapToDo(r: ToDoRecord, ctx: BuildBriefContext): BriefItem {
  // A deadline boosts relevance — closer = more relevant.
  const relevance = r.dueAt ? deadlineRelevance(r.dueAt, ctx.now()) : 0.8;
  // Blocked/stalled items are MORE important to surface (self-heal).
  const stateBoost = r.state === 'pending' ? 0 : 1.5;
  return {
    id: r.id,
    summary: `${r.summary}${r.state !== 'pending' ? ` [${r.state}]` : ''}`,
    salience: salience(
      { importance: Math.min(10, r.importance + stateBoost), relevance },
      ctx,
    ),
    ...(r.dueAt ? { at: r.dueAt } : {}),
    evidence: [{ kind: r.evidenceKind, id: r.evidenceId }],
  };
}

function mapFuture(r: FutureRecord, ctx: BuildBriefContext): FutureItem {
  const now = ctx.now();
  const daysUntil = Math.floor(
    (Date.parse(r.dueAt) - now.getTime()) / DAY_MS,
  );
  const relevance = deadlineRelevance(r.dueAt, now);
  return {
    id: r.id,
    summary: r.summary,
    salience: salience({ importance: r.importance, relevance }, ctx),
    dueAt: r.dueAt,
    daysUntil,
    at: r.dueAt,
    evidence: [{ kind: 'forecast', id: r.evidenceId }],
  };
}

function mapBlind(r: BlindSpotRecord, ctx: BuildBriefContext): BlindSpot {
  return {
    id: r.id,
    summary: r.summary,
    salience: salience({ importance: r.importance }, ctx),
    blocksDecision: r.blocksDecision,
    resolutionHint: r.resolutionHint,
    evidence: [{ kind: r.evidenceKind, id: r.evidenceId }],
  };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

function rank(items: ReadonlyArray<BriefItem>, limit: number): BriefItem[] {
  return [...items].sort(bySalience).slice(0, limit);
}

function rankFuture(
  items: ReadonlyArray<FutureItem>,
  limit: number,
): FutureItem[] {
  return [...items].sort(bySalience).slice(0, limit);
}

function rankBlind(
  items: ReadonlyArray<BlindSpot>,
  limit: number,
): BlindSpot[] {
  return [...items].sort(bySalience).slice(0, limit);
}

function bySalience(a: { salience: number }, b: { salience: number }): number {
  return b.salience - a.salience;
}

// ---------------------------------------------------------------------------
// Caveats + next-best-action
// ---------------------------------------------------------------------------

/**
 * Derive uncertainty caveats. Two sources:
 *   - any blind spot is, by definition, a caveat (we lack a fact).
 *   - a high-stakes future/todo item that is LOW salience earns an
 *     abstain caveat — the brain should clarify/escalate, not bluff.
 */
function deriveCaveats(
  facets: {
    toDo: ReadonlyArray<BriefItem>;
    blindSpots: ReadonlyArray<BlindSpot>;
    couldMatterLater: ReadonlyArray<FutureItem>;
  },
  abstainThreshold: number,
): Caveat[] {
  const out: Caveat[] = [];

  for (const b of facets.blindSpots) {
    out.push({
      id: `caveat:blind:${b.id}`,
      note: `Missing fact blocks: ${b.blocksDecision}. ${b.resolutionHint}`,
      confidence: clamp01(b.salience),
      abstain: true, // a known-unknown ALWAYS triggers clarify/abstain
      evidence: b.evidence,
    });
  }

  // Imminent future items (≤ 7d) that we are not yet acting on, surfaced
  // with low confidence, earn an abstain caveat.
  for (const f of facets.couldMatterLater) {
    if (f.daysUntil <= 7 && f.salience < abstainThreshold) {
      out.push({
        id: `caveat:future:${f.id}`,
        note: `${f.summary} is imminent (${f.daysUntil}d) but low-signal — verify before acting.`,
        confidence: clamp01(f.salience),
        abstain: true,
        evidence: f.evidence,
      });
    }
  }

  return out;
}

/**
 * The single highest-priority undone item the brain should re-orient to
 * first. Pulled from `toDo` (already salience-sorted). `null` when empty.
 */
function pickNextBestAction(toDo: ReadonlyArray<BriefItem>): BriefItem | null {
  return toDo.length > 0 ? (toDo[0] ?? null) : null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Closer deadlines → higher relevance ∈ [0,1]. Overdue pegs to 1. */
function deadlineRelevance(dueAt: string, now: Date): number {
  const days = (Date.parse(dueAt) - now.getTime()) / DAY_MS;
  if (Number.isNaN(days)) return 0.5;
  if (days <= 0) return 1;
  if (days >= 90) return 0.2;
  return clamp01(1 - days / 90);
}

async function safeLoad<T>(
  load: (() => Promise<ReadonlyArray<T>>) | undefined,
): Promise<ReadonlyArray<T>> {
  if (!load) return [];
  try {
    return await load();
  } catch {
    return [];
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
