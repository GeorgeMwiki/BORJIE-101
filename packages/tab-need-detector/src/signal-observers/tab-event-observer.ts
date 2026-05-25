/**
 * Piece O — Tab event observer.
 *
 * Detects navigation patterns from Piece L's tab event log (soft TEXT
 * pointer; table may not exist yet). The pattern detection itself is
 * done upstream by Piece L's scanner — this observer receives the
 * canonical pattern id + occurrence count and turns it into a signal.
 */

import { evaluateTabEventPattern } from '../scoring-matrix.js';
import type { NewSignalInput, TabEventPatternPayload } from '../types.js';

export interface TabEventPatternEvent {
  readonly tenantId: string;
  readonly userId: string;
  readonly pattern: string;
  readonly occurrences: number;
  readonly detail?: Record<string, unknown>;
}

/**
 * Convert a pattern event into zero or more signals. Higher occurrence
 * counts boost the weight (cap at 3x to prevent runaway).
 */
export function observeTabEventPattern(
  event: TabEventPatternEvent,
): readonly NewSignalInput[] {
  if (!event || !event.tenantId || !event.userId || !event.pattern) return [];

  const hits = evaluateTabEventPattern(event.pattern);
  if (hits.length === 0) return [];

  // Occurrence multiplier: log-scaled so 3 events = 1.5x, 10 = 2.3x, 50 = 3x cap.
  const occurrences = Math.max(1, event.occurrences | 0);
  const occurrenceBoost = Math.min(3, 1 + Math.log10(occurrences));

  const payload: TabEventPatternPayload = {
    pattern: event.pattern,
    occurrences,
    ...(event.detail !== undefined ? { detail: event.detail } : {}),
  };

  return hits.map((hit) => ({
    tenantId: event.tenantId,
    userId: event.userId,
    signalKind: 'tab_event_pattern' as const,
    signalPayload: { ...payload, matchedRule: hit.rule },
    suggestedModuleTemplateId: hit.suggestedModuleTemplateId,
    weight: hit.weight * occurrenceBoost,
  }));
}
