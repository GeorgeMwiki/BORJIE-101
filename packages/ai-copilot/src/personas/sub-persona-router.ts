/**
 * Sub-Persona Router.
 *
 * Picks which differential prompt layer to stack on top of the primary
 * persona given a context snapshot (route, chat mode, message, recent
 * messages, emotional tone, session metrics).
 *
 * Zero LLM cost. <1ms execution. Signal-weighted; returns null if no
 * dimension clears the confidence threshold.
 */

import {
  SUB_PERSONA_REGISTRY,
  type SubPersonaConfig,
  type SubPersonaId,
  type SubPersonaSignal,
} from './sub-persona-types.js';

// ============================================================================
// Router Input
// ============================================================================

export interface SubPersonaRoutingContext {
  readonly route: string;
  readonly portalId: string;
  readonly chatMode: string | null;
  readonly isAuthenticated: boolean;
  readonly message: string;
  readonly recentMessages: ReadonlyArray<string>;
  readonly emotionalTone: 'positive' | 'neutral' | 'negative';
  readonly sessionMetrics: {
    readonly messageCount: number;
    readonly errorMentionCount: number;
    readonly helpRequestCount: number;
    readonly navigationRequestCount: number;
    readonly minutesSinceStart: number;
  };
}

// ============================================================================
// Router Result
// ============================================================================

export interface SubPersonaRoutingResult {
  readonly subPersonaId: SubPersonaId;
  readonly confidence: number;
  readonly promptLayer: string;
  readonly signals: ReadonlyArray<SubPersonaSignal>;
}

// ============================================================================
// Constants
// ============================================================================

const MIN_CONFIDENCE = 0.4;
const ALL_DIMENSIONS: ReadonlyArray<SubPersonaId> = [
  'finance',
  'leasing',
  'maintenance',
  'compliance',
  'communications',
  'professor',
  'advisor',
  'consultant',
];

// ============================================================================
// Route-Based Detection
// ============================================================================

function detectRouteSignals(route: string): ReadonlyArray<SubPersonaSignal> {
  if (!route) return [];
  const lower = route.toLowerCase();
  const signals: SubPersonaSignal[] = [];
  for (const id of ALL_DIMENSIONS) {
    const cfg = SUB_PERSONA_REGISTRY[id];
    for (const pattern of cfg.routePatterns) {
      const p = pattern.toLowerCase();
      const matches = p.endsWith('/*')
        ? lower.startsWith(p.slice(0, -2))
        : p.endsWith('*')
          ? lower.startsWith(p.slice(0, -1))
          : lower === p;
      if (matches) {
        signals.push({
          source: 'route',
          dimension: id,
          weight: 5,
          detail: `Route pattern "${pattern}" matched "${route}"`,
        });
        break;
      }
    }
  }
  return signals;
}

// ============================================================================
// Keyword-Based Detection
// ============================================================================

function detectKeywordSignals(text: string): ReadonlyArray<SubPersonaSignal> {
  if (!text) return [];
  const lower = text.toLowerCase();
  const signals: SubPersonaSignal[] = [];
  for (const id of ALL_DIMENSIONS) {
    const cfg = SUB_PERSONA_REGISTRY[id];
    const matchCount = countKeywordMatches(lower, cfg.keywordSignals);
    if (matchCount >= 1) {
      signals.push({
        source: 'keyword',
        dimension: id,
        weight: Math.min(4, matchCount + 1),
        detail: `${matchCount} keyword match(es) for ${id}`,
      });
    }
  }
  return signals;
}

function countKeywordMatches(text: string, keywords: ReadonlyArray<string>): number {
  let count = 0;
  for (const kw of keywords) {
    if (text.includes(kw.toLowerCase())) count += 1;
  }
  return count;
}

// ============================================================================
// Chat-Mode Signal
// ============================================================================

const CHAT_MODE_MAP: Readonly<Record<string, SubPersonaId>> = {
  teaching: 'professor',
  quiz: 'professor',
  learning: 'professor',
  classroom: 'professor',
  strategy: 'consultant',
  advisory: 'consultant',
  consulting: 'consultant',
  decision: 'consultant',
  scenario: 'advisor',
};

function detectChatModeSignal(chatMode: string | null): SubPersonaSignal | null {
  if (!chatMode) return null;
  const mapped = CHAT_MODE_MAP[chatMode.toLowerCase()];
  if (!mapped) return null;
  return {
    source: 'chat_mode',
    dimension: mapped,
    weight: 4,
    detail: `Chat mode "${chatMode}" maps to ${mapped}`,
  };
}

// ============================================================================
// Aggregation + Winner Pick
// ============================================================================

function aggregateSignals(
  signals: ReadonlyArray<SubPersonaSignal>,
): Readonly<Record<SubPersonaId, number>> {
  const scores: Record<SubPersonaId, number> = {
    finance: 0,
    leasing: 0,
    maintenance: 0,
    compliance: 0,
    communications: 0,
    professor: 0,
    advisor: 0,
    consultant: 0,
  };
  for (const s of signals) {
    scores[s.dimension] += s.weight;
  }
  return scores;
}

function pickWinner(
  scores: Readonly<Record<SubPersonaId, number>>,
): { readonly id: SubPersonaId; readonly confidence: number } | null {
  const entries = Object.entries(scores) as Array<[SubPersonaId, number]>;
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (total === 0) return null;
  const sorted = [...entries].sort((a, b) => b[1] - a[1]);
  const [topId, topScore] = sorted[0];
  if (topScore === 0) return null;
  const confidence = topScore / total;
  if (confidence < MIN_CONFIDENCE) return null;
  return { id: topId, confidence };
}

// ============================================================================
// Main Router
// ============================================================================

/**
 * Route to the correct sub-persona dimension based on context signals.
 * Returns null if no dimension passes the confidence threshold (in which
 * case the caller falls back to the base primary persona only).
 */
export function routeToSubPersona(
  context: SubPersonaRoutingContext,
): SubPersonaRoutingResult | null {
  const signals: SubPersonaSignal[] = [];

  // 1. Route patterns (strongest signal)
  signals.push(...detectRouteSignals(context.route));

  // 2. Chat-mode signal
  const chatModeSignal = detectChatModeSignal(context.chatMode);
  if (chatModeSignal) signals.push(chatModeSignal);

  // 3. Keyword signals from message + recent messages
  const joinedText = [context.message, ...context.recentMessages.slice(0, 3)].join(' ');
  signals.push(...detectKeywordSignals(joinedText));

  // 4. Emotional-tone boost: negative tone + help request -> communications dimension
  if (
    context.emotionalTone === 'negative' &&
    context.sessionMetrics.helpRequestCount > 0
  ) {
    signals.push({
      source: 'emotion',
      dimension: 'communications',
      weight: 1,
      detail: 'Negative tone with help request - draft an empathetic reply',
    });
  }

  const scores = aggregateSignals(signals);
  const winner = pickWinner(scores);
  if (!winner) return null;

  const cfg = SUB_PERSONA_REGISTRY[winner.id];
  return {
    subPersonaId: winner.id,
    confidence: winner.confidence,
    promptLayer: cfg.promptLayer,
    signals,
  };
}

/**
 * Direct prompt-layer lookup when the caller already knows the dimension.
 */
export function getSubPersonaPromptLayer(id: SubPersonaId): string {
  return SUB_PERSONA_REGISTRY[id].promptLayer;
}

/**
 * Build the effective prompt: base persona system prompt + differential
 * sub-persona layer if one is active. When no sub-persona routes, the
 * caller gets the bare base prompt.
 */
export function composePersonaPrompt(
  basePrompt: string,
  subPersonaId: SubPersonaId | null,
): string {
  if (!subPersonaId) return basePrompt;
  const layer = SUB_PERSONA_REGISTRY[subPersonaId].promptLayer;
  return `${basePrompt}\n\n${layer}`;
}

/**
 * Return the list of available tools for a persona enriched by the
 * active sub-persona's preferred tools. Deduplicated, immutable.
 */
export function composeAvailableTools(
  baseTools: ReadonlyArray<string>,
  subPersonaId: SubPersonaId | null,
): ReadonlyArray<string> {
  if (!subPersonaId) return baseTools;
  const cfg = SUB_PERSONA_REGISTRY[subPersonaId];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of baseTools) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  for (const t of cfg.preferredTools) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return Object.freeze(out);
}

/**
 * Look up sub-persona config by id (pass-through for convenience).
 */
export function getSubPersonaConfig(id: SubPersonaId): SubPersonaConfig {
  return SUB_PERSONA_REGISTRY[id];
}
