/**
 * Theory of mind — observed user mental state.
 *
 * Two layers ship in this file:
 *
 *   1. Per-turn `inferMindState()` — stateless heuristic that infers
 *      urgency / expertise / mode / emotional-charge from the current
 *      user message. The original Borjie contract; preserved
 *      verbatim so the kernel call sites do not change.
 *
 *   2. **Stateful per-(tenant, user) affective accumulator** —
 *      mirrors LITFIN's `src/core/brain/theory-of-mind.ts:1-325`.
 *      Tracks five [0,1] dimensions with decay:
 *
 *        - frustration
 *        - comprehension
 *        - anxiety
 *        - trust
 *        - urgency
 *
 *      The accumulator absorbs each turn's per-message inference
 *      plus optional outcome / latency signals, and the kernel mixes
 *      the running state into the directive ("Your last 3 turns
 *      showed escalating frustration; soften tone").
 *
 *   - urgency='high'      → lead with the action, defer rationale
 *   - expertise='novice'  → define jargon on first use
 *   - decision-mode       → produce a recommendation, not a survey
 *
 * Pure heuristic over the message text and recent thread history.
 */

export type Urgency = 'low' | 'medium' | 'high';
export type Expertise = 'novice' | 'intermediate' | 'expert';
export type Mode = 'browse' | 'decide' | 'execute' | 'learn';

export interface MindState {
  readonly urgency: Urgency;
  readonly expertise: Expertise;
  readonly mode: Mode;
  readonly emotionalCharge: number;     // [-1,1]; negative = frustrated
}

const URGENCY_HIGH = [
  /\b(now|right now|immediately|asap|today|urgent|emergency)\b/i,
  /!{2,}/,
];
const URGENCY_LOW = [
  /\b(when you have a moment|no rush|whenever|at some point)\b/i,
];

const EXPERTISE_NOVICE_PHRASES = [
  /\bwhat is (a|an|the)\b/i,
  /\bhow do i\b/i,
  /\bcan you explain\b/i,
  /\bi don'?t understand\b/i,
];
const EXPERTISE_EXPERT_TOKENS = [
  /\bdscr\b/i,
  /\bcap rate\b/i,
  /\barrears ladder\b/i,
  /\bk-anonym\w+/i,
  /\btgn\b/i,
  /\bconformal\b/i,
];

const MODE_DECIDE = [
  /\bshould i\b/i,
  /\bwhich one\b/i,
  /\bbetter\b/i,
  /\brecommend\w*/i,
];
const MODE_EXECUTE = [
  /\b(do it|go ahead|proceed|run|trigger|start|begin|book|file|send)\b/i,
];
const MODE_LEARN = [
  /\b(teach me|walk me through|how does .* work|explain)\b/i,
];

const NEG_EMO = [
  /\b(angry|furious|frustrated|annoyed|upset|fed up|sick of)\b/i,
  /!{3,}/,
];
const POS_EMO = [
  /\b(thanks|thank you|appreciate|love|great|excellent|perfect)\b/i,
];

export function inferMindState(message: string): MindState {
  return {
    urgency:        scoreUrgency(message),
    expertise:      scoreExpertise(message),
    mode:           scoreMode(message),
    emotionalCharge: scoreEmotion(message),
  };
}

function scoreUrgency(m: string): Urgency {
  if (URGENCY_HIGH.some((re) => re.test(m))) return 'high';
  if (URGENCY_LOW.some((re) => re.test(m))) return 'low';
  return 'medium';
}

function scoreExpertise(m: string): Expertise {
  const novice = EXPERTISE_NOVICE_PHRASES.some((re) => re.test(m));
  const expert = EXPERTISE_EXPERT_TOKENS.some((re) => re.test(m));
  // Domain shorthand wins: a novice would not say "cap rate" or "DSCR",
  // even if the sentence uses a "what is …" framing.
  if (expert) return 'expert';
  if (novice) return 'novice';
  return 'intermediate';
}

function scoreMode(m: string): Mode {
  if (MODE_EXECUTE.some((re) => re.test(m))) return 'execute';
  if (MODE_DECIDE.some((re) => re.test(m))) return 'decide';
  if (MODE_LEARN.some((re) => re.test(m))) return 'learn';
  return 'browse';
}

function scoreEmotion(m: string): number {
  let score = 0;
  if (NEG_EMO.some((re) => re.test(m))) score -= 0.6;
  if (POS_EMO.some((re) => re.test(m))) score += 0.5;
  return Math.max(-1, Math.min(1, score));
}

/**
 * Render a one-line behavioural directive for the system prompt that
 * tells the sensor how to frame the answer for this mind state.
 */
export function renderMindStateDirective(s: MindState): string {
  const parts: string[] = [];
  if (s.urgency === 'high') parts.push('Lead with the action; rationale follows in one short sentence.');
  if (s.urgency === 'low')  parts.push('You may take a measured tone; the user is not in a rush.');
  if (s.expertise === 'novice') parts.push('Define any jargon on first use; offer an example before the rule.');
  if (s.expertise === 'expert') parts.push('You may use domain shorthand without expansion.');
  if (s.mode === 'decide')  parts.push('End with a single recommendation, not a list of options.');
  if (s.mode === 'execute') parts.push('Confirm what will be done, then either do it or hand off to the workflow.');
  if (s.mode === 'learn')   parts.push('Teach by example before stating the rule. Check understanding mid-way.');
  if (s.emotionalCharge < -0.3) parts.push('The user is frustrated. Acknowledge that briefly, then move to action.');
  return parts.length > 0 ? parts.join(' ') : 'Answer at conversational pace.';
}

// ────────────────────────────────────────────────────────────────────
// Stateful affective accumulator — per-(tenant, user) profile with
// 24h TTL + LRU eviction. Mirrors LITFIN's `STORE` map at
// `theory-of-mind.ts:47` with frustration / comprehension / anxiety
// / trust dimensions. Adds `urgency` so the kernel can detect a
// sustained-urgency streak ("user has been escalating for 4 turns").
// ────────────────────────────────────────────────────────────────────

export interface AffectiveState {
  readonly frustration: number;     // [0,1]
  readonly comprehension: number;   // [0,1]; high = following along
  readonly anxiety: number;         // [0,1]
  readonly trust: number;           // [0,1]; high = grants the brain authority
  readonly urgency: number;         // [0,1]
}

export const AFFECTIVE_DEFAULT: AffectiveState = {
  frustration:   0.0,
  comprehension: 0.7,
  anxiety:       0.3,
  trust:         0.6,
  urgency:       0.4,
};

export interface AffectiveProfile {
  readonly state: AffectiveState;
  readonly turns: number;
  readonly updatedAt: string;
}

export interface AffectiveObservation {
  readonly mindState: MindState;
  readonly capturedAt: string;
  /** Optional outcome of the previous turn. */
  readonly priorOutcome?: 'success' | 'failure' | 'drop';
  /** Optional latency-to-respond of the previous turn (ms). */
  readonly priorTurnLatencyMs?: number;
}

const TOM_MAX_ENTRIES = 10_000;
const TOM_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DECAY_PER_TURN = 0.05; // gentle decay back toward defaults each turn

export interface AffectiveAccumulator {
  observe(tenantId: string, userId: string, obs: AffectiveObservation): AffectiveProfile;
  read(tenantId: string, userId: string, nowMs?: number): AffectiveProfile | null;
  reset(): void;
  size(): number;
}

interface InternalEntry {
  state: AffectiveState;
  turns: number;
  updatedAtMs: number;
  touchOrder: number;
}

export function createAffectiveAccumulator(): AffectiveAccumulator {
  const store = new Map<string, InternalEntry>();
  let touchCounter = 0;

  const key = (tenantId: string, userId: string): string =>
    `${tenantId}:${userId}`;

  const evict = (nowMs: number): void => {
    for (const [k, v] of store) {
      if (nowMs - v.updatedAtMs > TOM_TTL_MS) store.delete(k);
    }
    if (store.size <= TOM_MAX_ENTRIES) return;
    const sorted = [...store.entries()].sort(
      (a, b) => a[1].touchOrder - b[1].touchOrder,
    );
    const overflow = store.size - TOM_MAX_ENTRIES;
    for (let i = 0; i < overflow; i += 1) {
      const entry = sorted[i];
      if (entry) store.delete(entry[0]);
    }
  };

  return {
    observe(tenantId, userId, obs) {
      const nowMs = Date.parse(obs.capturedAt);
      const k = key(tenantId, userId);
      const prev = store.get(k);
      const baseState = prev ? prev.state : AFFECTIVE_DEFAULT;
      const decayed = applyDecay(baseState);
      const delta = deltaFromObservation(obs);
      const nextState = mergeAffective(decayed, delta);
      const next: InternalEntry = {
        state: nextState,
        turns: (prev?.turns ?? 0) + 1,
        updatedAtMs: nowMs,
        touchOrder: ++touchCounter,
      };
      store.set(k, next);
      evict(nowMs);
      return toProfile(next);
    },
    read(tenantId, userId, nowMs) {
      const k = key(tenantId, userId);
      const entry = store.get(k);
      if (!entry) return null;
      const at = nowMs ?? Date.now();
      if (at - entry.updatedAtMs > TOM_TTL_MS) {
        store.delete(k);
        return null;
      }
      entry.touchOrder = ++touchCounter;
      return toProfile(entry);
    },
    reset() {
      store.clear();
      touchCounter = 0;
    },
    size() {
      return store.size;
    },
  };
}

function deltaFromObservation(obs: AffectiveObservation): Partial<AffectiveState> {
  const ms = obs.mindState;
  const d: { frustration?: number; comprehension?: number; anxiety?: number; trust?: number; urgency?: number } = {};

  // Per-turn inference → delta.
  if (ms.emotionalCharge < -0.3) {
    d.frustration = (d.frustration ?? 0) + 0.18;
    d.trust = (d.trust ?? 0) - 0.05;
  } else if (ms.emotionalCharge > 0.3) {
    d.frustration = (d.frustration ?? 0) - 0.12;
    d.trust = (d.trust ?? 0) + 0.05;
  }
  if (ms.expertise === 'novice') d.comprehension = (d.comprehension ?? 0) - 0.12;
  if (ms.expertise === 'expert') d.comprehension = (d.comprehension ?? 0) + 0.06;
  if (ms.urgency === 'high') {
    d.urgency = (d.urgency ?? 0) + 0.25;
    d.anxiety = (d.anxiety ?? 0) + 0.10;
  }
  if (ms.urgency === 'low') d.urgency = (d.urgency ?? 0) - 0.15;
  if (ms.mode === 'decide') d.anxiety = (d.anxiety ?? 0) + 0.05;

  // Prior outcome → delta.
  if (obs.priorOutcome === 'success') {
    d.trust = (d.trust ?? 0) + 0.10;
    d.frustration = (d.frustration ?? 0) - 0.10;
  }
  if (obs.priorOutcome === 'failure') {
    d.trust = (d.trust ?? 0) - 0.15;
    d.frustration = (d.frustration ?? 0) + 0.15;
  }
  if (obs.priorOutcome === 'drop') {
    d.frustration = (d.frustration ?? 0) + 0.08;
    d.urgency = (d.urgency ?? 0) - 0.10;
  }

  // Latency → comprehension / anxiety.
  const latency = obs.priorTurnLatencyMs ?? 0;
  if (latency >= 90_000) d.comprehension = (d.comprehension ?? 0) - 0.05;
  if (latency >= 300_000) {
    d.anxiety = (d.anxiety ?? 0) + 0.08;
    d.comprehension = (d.comprehension ?? 0) - 0.05;
  }

  return d as Partial<AffectiveState>;
}

function applyDecay(state: AffectiveState): AffectiveState {
  const toward = AFFECTIVE_DEFAULT;
  return {
    frustration:   moveToward(state.frustration, toward.frustration, DECAY_PER_TURN),
    comprehension: moveToward(state.comprehension, toward.comprehension, DECAY_PER_TURN),
    anxiety:       moveToward(state.anxiety, toward.anxiety, DECAY_PER_TURN),
    trust:         moveToward(state.trust, toward.trust, DECAY_PER_TURN),
    urgency:       moveToward(state.urgency, toward.urgency, DECAY_PER_TURN),
  };
}

function moveToward(value: number, target: number, step: number): number {
  if (Math.abs(value - target) <= step) return target;
  return value > target ? value - step : value + step;
}

function mergeAffective(
  base: AffectiveState,
  delta: Partial<AffectiveState>,
): AffectiveState {
  return {
    frustration:   clamp01(base.frustration + (delta.frustration ?? 0)),
    comprehension: clamp01(base.comprehension + (delta.comprehension ?? 0)),
    anxiety:       clamp01(base.anxiety + (delta.anxiety ?? 0)),
    trust:         clamp01(base.trust + (delta.trust ?? 0)),
    urgency:       clamp01(base.urgency + (delta.urgency ?? 0)),
  };
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function toProfile(e: InternalEntry): AffectiveProfile {
  return {
    state: e.state,
    turns: e.turns,
    updatedAt: new Date(e.updatedAtMs).toISOString(),
  };
}

/**
 * Render a richer directive that mixes the per-turn mind state with
 * the affective profile (running frustration / comprehension /
 * anxiety / trust / urgency). The accumulator nudges the directive
 * narratively: "Your last 3 turns showed escalating frustration;
 * soften tone."
 */
export function renderMindStateDirectiveWithProfile(
  ms: MindState,
  profile: AffectiveProfile | null,
): string {
  const base = renderMindStateDirective(ms);
  if (!profile || profile.turns < 2) return base;
  const hints = describeAffective(profile);
  return hints.length > 0 ? `${base} ${hints.join(' ')}` : base;
}

function describeAffective(p: AffectiveProfile): ReadonlyArray<string> {
  const out: string[] = [];
  const s = p.state;
  if (s.frustration >= 0.5) {
    out.push(`The last ${Math.min(p.turns, 4)} turns showed escalating frustration; soften tone and lead with the simplest next step.`);
  }
  if (s.comprehension <= 0.4) {
    out.push('Comprehension has eroded across recent turns; re-explain with a concrete example and skip terminology.');
  }
  if (s.anxiety >= 0.6) {
    out.push('Anxiety is high; lead with reassurance, name what is normal, defer hard numbers until trust rebuilds.');
  }
  if (s.trust <= 0.4) {
    out.push('Trust is low; cite every claim by source, never speculate, and acknowledge prior misses explicitly.');
  }
  if (s.urgency >= 0.7) {
    out.push('Sustained urgency across recent turns; cut rationale, do not introduce new concepts this turn.');
  }
  return out;
}
