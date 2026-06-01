/**
 * Server-side ports of the chat-ui progression engines.
 *
 * The mastery tracker (`packages/chat-ui/.../user-mastery/mastery-tracker.ts`)
 * and the learned-shortcuts ranker
 * (`packages/chat-ui/.../learned-shortcuts/ranker.ts`) are pure scoring
 * functions, but they live inside `@borjie/chat-ui` — a React package the
 * api-gateway must NOT depend on. Rather than pull React/JSX into the
 * backend, we reproduce the EXACT published formulas here over the
 * `user_action_tracker` rows the gateway already owns.
 *
 * Source-of-truth formulas mirrored 1:1:
 *
 *   Mastery (recency-weighted action count):
 *     weightedScore = round(totalActions * recencyWeight)
 *     recencyWeight ∈ [0.25, 1.0], linear between 7d (full) and 90d (floor)
 *     thresholds: novice ≤10, intermediate ≤50, expert ≤200, power-user >200
 *
 *   Shortcuts (per-action score):
 *     score = log(1+frequency) * exp(-ln2 * age / halfLife) * (0.5 + 0.5*confRate)
 *     halfLife = 7 days; confRate defaults to 0.5 when no outcomes recorded.
 *
 * Any change to the published engines MUST be mirrored here (and ideally
 * folded into a shared non-React package later).
 */

// ─── Shared row shape (subset of user_action_tracker) ───────────────

export interface ActionTrackerRecord {
  readonly actionId: string;
  readonly actionCount: number;
  readonly firstSeen: string;
  readonly lastSeen: string;
}

// ─── Mastery engine (port of computeMasteryScore) ───────────────────

export type MasteryLevel = 'novice' | 'intermediate' | 'expert' | 'power-user';

const MASTERY_LEVELS: ReadonlyArray<MasteryLevel> = [
  'novice',
  'intermediate',
  'expert',
  'power-user',
];

const MASTERY_THRESHOLDS: ReadonlyArray<{
  readonly level: MasteryLevel;
  readonly maxWeightedActions: number;
}> = [
  { level: 'novice', maxWeightedActions: 10 },
  { level: 'intermediate', maxWeightedActions: 50 },
  { level: 'expert', maxWeightedActions: 200 },
  { level: 'power-user', maxWeightedActions: Number.POSITIVE_INFINITY },
];

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const MIN_RECENCY_WEIGHT = 0.25;

export interface MasteryScore {
  readonly level: MasteryLevel;
  readonly totalActions: number;
  readonly distinctActions: number;
  readonly recencyWeight: number;
  readonly weightedScore: number;
  readonly nextThreshold: number | null;
  readonly nextLevel: MasteryLevel | null;
}

function levelFromWeightedActions(weighted: number): MasteryLevel {
  if (!Number.isFinite(weighted) || weighted < 0) return 'novice';
  for (const t of MASTERY_THRESHOLDS) {
    if (weighted <= t.maxWeightedActions) return t.level;
  }
  return 'power-user';
}

function nextLevelAbove(level: MasteryLevel): MasteryLevel | null {
  const idx = MASTERY_LEVELS.indexOf(level);
  if (idx === -1 || idx >= MASTERY_LEVELS.length - 1) return null;
  return MASTERY_LEVELS[idx + 1] ?? null;
}

function nextThresholdAbove(level: MasteryLevel): number | null {
  if (level === 'power-user') return null;
  const t = MASTERY_THRESHOLDS.find((x) => x.level === level);
  return t ? t.maxWeightedActions + 1 : null;
}

function computeRecencyWeight(mostRecentMs: number, nowMs: number): number {
  if (!Number.isFinite(mostRecentMs) || mostRecentMs <= 0) {
    return MIN_RECENCY_WEIGHT;
  }
  const ageMs = Math.max(0, nowMs - mostRecentMs);
  if (ageMs <= RECENT_WINDOW_MS) return 1;
  if (ageMs >= STALE_WINDOW_MS) return MIN_RECENCY_WEIGHT;
  const span = STALE_WINDOW_MS - RECENT_WINDOW_MS;
  const traveled = ageMs - RECENT_WINDOW_MS;
  const decay = (1 - MIN_RECENCY_WEIGHT) * (traveled / span);
  return Math.max(MIN_RECENCY_WEIGHT, 1 - decay);
}

/**
 * Compute the caller's mastery score from their action-tracker rows.
 * Empty input returns the novice baseline (engines handle empty).
 */
export function computeMasteryScore(
  records: ReadonlyArray<ActionTrackerRecord>,
  now: number = Date.now(),
): MasteryScore {
  if (records.length === 0) {
    return {
      level: 'novice',
      totalActions: 0,
      distinctActions: 0,
      recencyWeight: 1,
      weightedScore: 0,
      nextThreshold: nextThresholdAbove('novice'),
      nextLevel: nextLevelAbove('novice'),
    };
  }

  const totalActions = records.reduce(
    (sum, r) => sum + Math.max(0, r.actionCount),
    0,
  );
  const distinctActions = new Set(records.map((r) => r.actionId)).size;

  let mostRecentMs = 0;
  for (const r of records) {
    const ts = Date.parse(r.lastSeen);
    if (Number.isFinite(ts) && ts > mostRecentMs) mostRecentMs = ts;
  }

  const recencyWeight = computeRecencyWeight(mostRecentMs, now);
  const weightedScore = Math.round(totalActions * recencyWeight);
  const level = levelFromWeightedActions(weightedScore);

  return {
    level,
    totalActions,
    distinctActions,
    recencyWeight,
    weightedScore,
    nextThreshold: nextThresholdAbove(level),
    nextLevel: nextLevelAbove(level),
  };
}

// ─── Shortcuts engine (port of rankActions) ─────────────────────────

const DEFAULT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TOP_N = 5;
const NEUTRAL_CONFIRMATION_RATE = 0.5;

export interface LearnedShortcut {
  readonly id: string;
  readonly label: string;
  readonly confidence: number;
}

function shortcutRecencyWeight(lastSeenMs: number, now: number): number {
  if (!Number.isFinite(lastSeenMs) || !Number.isFinite(now)) return 0;
  const ageMs = now - lastSeenMs;
  if (ageMs <= 0) return 1;
  const k = Math.LN2 / DEFAULT_HALF_LIFE_MS;
  return Math.exp(-k * ageMs);
}

/**
 * Score a single action. The `user_action_tracker` table only carries a
 * lifetime `actionCount` + `lastSeen` (no per-action success/cancel
 * tracking), so confirmation-rate uses the neutral 0.5 default — exactly
 * what the ranker does for an action with no recorded outcomes.
 */
function scoreAction(record: ActionTrackerRecord, now: number): number {
  const frequency = Math.max(0, record.actionCount);
  if (frequency <= 0) return 0;
  const last = Date.parse(record.lastSeen);
  if (Number.isNaN(last)) return 0;
  const freqTerm = Math.log1p(frequency);
  const recencyTerm = shortcutRecencyWeight(last, now);
  const confTerm = 0.5 + 0.5 * NEUTRAL_CONFIRMATION_RATE;
  return freqTerm * recencyTerm * confTerm;
}

/**
 * Rank the caller's actions into learned shortcuts. Mirrors the chat-ui
 * ranker: score desc, tie-break by frequency then id, cap at topN,
 * confidence normalised against the top score. Empty input → [].
 */
export function rankShortcuts(
  records: ReadonlyArray<ActionTrackerRecord>,
  options: { readonly now?: number; readonly topN?: number } = {},
): ReadonlyArray<LearnedShortcut> {
  const now = options.now ?? Date.now();
  const topN = options.topN ?? DEFAULT_TOP_N;
  if (records.length === 0 || topN <= 0) return [];

  const scored = records
    .map((record) => ({ record, score: scoreAction(record, now) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.record.actionCount !== a.record.actionCount) {
        return b.record.actionCount - a.record.actionCount;
      }
      return a.record.actionId.localeCompare(b.record.actionId);
    })
    .slice(0, topN);

  if (scored.length === 0) return [];

  const topScore = scored[0]?.score ?? 1;
  const safeTop = topScore > 0 ? topScore : 1;

  return scored.map(({ record, score }) => ({
    id: record.actionId,
    // No display-label column on user_action_tracker — the actionId is
    // the stable label the FE localises upstream.
    label: record.actionId,
    confidence: Math.min(1, score / safeTop),
  }));
}
