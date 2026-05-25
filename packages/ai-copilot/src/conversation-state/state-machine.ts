/**
 * Conversation state machine.
 *
 * Transitions:
 *   greeting   \u2192 discovery  (after first assistant turn OR user task intent)
 *   discovery  \u2192 task       (after user provides a concrete entity / ask)
 *   task       \u2192 wrap_up    (after user says thanks / done / ok)
 *   wrap_up    \u2192 followup   (after 30 s idle)
 *   followup   \u2192 greeting   (on session resume after 24h)
 *
 * Every transition is explicit \u2014 no hidden jumps. All functions are pure
 * (take state, return next state) except `step()` which ties the knot.
 */

import { randomUUID } from 'node:crypto';

import type {
  ConversationConfig,
  ConversationPhase,
  ConversationState,
  ConversationTurn,
} from './types.js';

const DEFAULT_MAX_HISTORY = 60;
const DEFAULT_TONE_WINDOW = 5;

export class ConversationStateMachine {
  private state: ConversationState;
  private readonly maxHistory: number;
  private readonly toneWindowSize: number;

  constructor(config: ConversationConfig) {
    this.maxHistory = config.maxHistoryTurns ?? DEFAULT_MAX_HISTORY;
    this.toneWindowSize = config.toneWindowSize ?? DEFAULT_TONE_WINDOW;
    const now = new Date().toISOString();
    this.state = {
      id: config.id,
      tenantId: config.tenantId,
      userId: config.userId,
      language: config.language,
      phase: 'greeting',
      history: [],
      entities: [],
      startedAt: now,
      lastActivityAt: now,
      toneWindow: [],
    };
  }

  getState(): ConversationState {
    return this.state;
  }

  appendTurn(turn: Omit<ConversationTurn, 'id' | 'createdAt'>): ConversationState {
    const full: ConversationTurn = {
      id: `turn_${randomUUID()}`,
      createdAt: new Date().toISOString(),
      ...turn,
    };
    const history = [...this.state.history, full].slice(-this.maxHistory);
    const entities = dedupeEntities([
      ...this.state.entities,
      ...(full.entities ?? []),
    ]);
    const toneWindow = full.tone
      ? [...this.state.toneWindow, full.tone].slice(-this.toneWindowSize)
      : this.state.toneWindow;
    const phase = advancePhase(this.state.phase, full, history);

    this.state = {
      ...this.state,
      history,
      entities,
      toneWindow,
      phase,
      lastActivityAt: full.createdAt,
    };
    return this.state;
  }

  forcePhase(next: ConversationPhase): ConversationState {
    this.state = { ...this.state, phase: next };
    return this.state;
  }

  prevailingTone(): 'positive' | 'neutral' | 'negative' {
    if (this.state.toneWindow.length === 0) return 'neutral';
    const counts = { positive: 0, neutral: 0, negative: 0 };
    for (const t of this.state.toneWindow) counts[t]++;
    if (counts.negative > counts.positive && counts.negative > counts.neutral) {
      return 'negative';
    }
    if (counts.positive > counts.negative && counts.positive > counts.neutral) {
      return 'positive';
    }
    return 'neutral';
  }
}

function advancePhase(
  prev: ConversationPhase,
  turn: ConversationTurn,
  history: readonly ConversationTurn[],
): ConversationPhase {
  if (prev === 'greeting') {
    if (turn.role === 'assistant') return 'discovery';
    if (turn.role === 'user' && looksLikeTaskIntent(turn.text)) return 'task';
    return prev;
  }
  if (prev === 'discovery') {
    if (turn.role === 'user' && (turn.entities?.length ?? 0) > 0) return 'task';
    if (turn.role === 'user' && looksLikeTaskIntent(turn.text)) return 'task';
    return prev;
  }
  if (prev === 'task') {
    if (turn.role === 'user' && looksLikeWrapUp(turn.text)) return 'wrap_up';
    return prev;
  }
  if (prev === 'wrap_up') {
    if (history.length > 0 && looksIdle(history)) return 'followup';
    return prev;
  }
  return prev;
}

function looksLikeTaskIntent(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(help|show|open|draft|send|review|check|analy[sz]e|generate|create|fix|update)\b/.test(
      t,
    ) ||
    /\b(nisaidie|onyesha|fungua|andika|tuma|kagua|tengeneza)\b/.test(t)
  );
}

function looksLikeWrapUp(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(thanks|thank you|ok|done|all good|asante|sawa|nimemaliza)\b/.test(t);
}

function looksIdle(history: readonly ConversationTurn[]): boolean {
  const last = history[history.length - 1];
  if (!last) return false;
  const ageMs = Date.now() - new Date(last.createdAt).getTime();
  return ageMs > 30_000;
}

function dedupeEntities(
  input: readonly NonNullable<ConversationTurn['entities']>[number][],
): ConversationState['entities'] {
  const seen = new Set<string>();
  const out: ConversationState['entities'][number][] = [];
  for (const e of input) {
    const key = `${e.type}:${e.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
