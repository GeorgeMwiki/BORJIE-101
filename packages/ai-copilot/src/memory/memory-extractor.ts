/**
 * BORJIE AI memory extractor — Wave-11.
 *
 * Pattern-based extraction from conversation turns. Pure, no LLM calls —
 * extracts tenant preferences, decisions, and entity relationships for the
 * semantic store. Rate-limited (every N turns) to keep cost near zero.
 *
 * Swahili + English patterns cover typical BORJIE interactions
 * (property, rent, maintenance, notice, payment).
 */

import type { MemoryType, RememberInput, SemanticMemory } from './semantic-memory.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConversationTurn {
  readonly userMessage: string;
  readonly assistantResponse: string;
  readonly intent: string;
  readonly turnNumber: number;
}

export interface ExtractedInsight {
  readonly type: MemoryType;
  readonly content: string;
  readonly confidence: number;
}

export interface ExtractorDeps {
  readonly memory: SemanticMemory;
  readonly extractEveryNTurns?: number;
}

// ---------------------------------------------------------------------------
// Rule table
// ---------------------------------------------------------------------------

interface Rule {
  readonly regex: RegExp;
  readonly type: MemoryType;
  readonly render: (match: RegExpMatchArray) => string;
  readonly confidence: number;
}

const RULES: readonly Rule[] = [
  // Preference — preferred language / channel.
  {
    regex: /(?:i\s+prefer|napendelea)\s+([^\n.]{5,60})/i,
    type: 'preference',
    render: (m) => `Tenant prefers ${m[1].trim()}`,
    confidence: 0.75,
  },
  {
    regex: /(?:please\s+use|nitumie\s+kwa)\s+(whatsapp|sms|email|simu)/i,
    type: 'preference',
    render: (m) => `Preferred contact channel: ${m[1].toLowerCase()}`,
    confidence: 0.85,
  },
  // Decision — rent increase, renewal, termination.
  {
    regex: /(?:i\s+(?:will|agreed\s+to|decided\s+to))\s+([^\n.]{5,80})/i,
    type: 'decision',
    render: (m) => `Tenant decision: ${m[1].trim()}`,
    confidence: 0.7,
  },
  {
    regex: /(?:nimekubali|nimeamua)\s+([^\n.]{5,80})/i,
    type: 'decision',
    render: (m) => `Tenant decision (sw): ${m[1].trim()}`,
    confidence: 0.7,
  },
  // Relationship — known guarantor, referral, family.
  {
    regex:
      /(?:my\s+(?:guarantor|co-?signer|next\s+of\s+kin)\s+is|mdhamini\s+wangu\s+ni)\s+([^\n.]{3,60})/i,
    type: 'relationship',
    render: (m) => `Key relationship: ${m[1].trim()}`,
    confidence: 0.8,
  },
  // Learning — tenant learned / understood a concept.
  {
    regex:
      /(?:now\s+i\s+(?:understand|see|get)|naelewa\s+sasa|nimeelewa)\s+([^\n.]{3,80})/i,
    type: 'learning',
    render: (m) => `Tenant now understands: ${m[1].trim()}`,
    confidence: 0.65,
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function extractInsightsFromTurn(
  turn: ConversationTurn,
): readonly ExtractedInsight[] {
  const insights: ExtractedInsight[] = [];
  const source = turn.userMessage;

  for (const rule of RULES) {
    const match = source.match(rule.regex);
    if (!match) continue;
    insights.push({
      type: rule.type,
      content: rule.render(match),
      confidence: rule.confidence,
    });
  }

  return insights;
}

const lastExtractionByTenant: Map<string, number> = new Map();

function shouldExtract(
  tenantId: string,
  turnNumber: number,
  every: number,
): boolean {
  const last = lastExtractionByTenant.get(tenantId) ?? 0;
  if (turnNumber - last < every) return false;
  lastExtractionByTenant.set(tenantId, turnNumber);
  if (lastExtractionByTenant.size > 2_000) {
    const drop = Array.from(lastExtractionByTenant.keys()).slice(0, 1_000);
    for (const k of drop) lastExtractionByTenant.delete(k);
  }
  return true;
}

/**
 * Extract insights and push them to the semantic memory. Fire-and-forget —
 * never blocks the chat flow. Returns the number of insights persisted.
 */
export async function analyzeAndRemember(
  turn: ConversationTurn,
  tenantId: string,
  deps: ExtractorDeps,
  options: { readonly personaId?: string; readonly sessionId?: string } = {},
): Promise<number> {
  if (!tenantId) return 0;
  if (turn.intent === 'greeting' || turn.userMessage.length < 20) return 0;

  const every = deps.extractEveryNTurns ?? 3;
  if (!shouldExtract(tenantId, turn.turnNumber, every)) return 0;

  const insights = extractInsightsFromTurn(turn);
  if (insights.length === 0) return 0;

  let stored = 0;
  for (const insight of insights) {
    const payload: RememberInput = {
      tenantId,
      personaId: options.personaId,
      memoryType: insight.type,
      content: insight.content,
      confidence: insight.confidence,
      sessionId: options.sessionId,
      metadata: {
        intent: turn.intent,
        turnNumber: turn.turnNumber,
      },
    };
    const row = await deps.memory.remember(payload);
    if (row) stored += 1;
  }
  return stored;
}
