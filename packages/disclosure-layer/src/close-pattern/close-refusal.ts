/**
 * `closeRefusal` — build a 4-segment refusal card.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §3
 */

import { getPrebuiltRefusal } from './prebuilt.js';
import { type CloseRefusalCategory, type CloseRefusalInput, type RefusalCard } from './types.js';

/** Trim and validate that a segment is non-empty. */
function normalizeSegment(s: string): string {
  const t = s.trim();
  if (t.length === 0) {
    throw new Error('CLOSE-pattern segment must be non-empty');
  }
  return t;
}

/**
 * Render a 4-segment refusal card from raw segments.
 *
 * Throws on empty / whitespace-only segments — CLOSE requires all 4.
 */
export function closeRefusal(
  input: CloseRefusalInput,
  category?: CloseRefusalCategory
): RefusalCard {
  const segments = {
    acknowledge: normalizeSegment(input.ack),
    refuse: normalizeSegment(input.refuse),
    redirect: normalizeSegment(input.redirect),
    invite: normalizeSegment(input.invite),
  };
  const text = [
    segments.acknowledge,
    segments.refuse,
    '',
    segments.redirect,
    '',
    segments.invite,
  ].join('\n');
  return Object.freeze({
    segments: Object.freeze(segments),
    ...(category !== undefined ? { category } : {}),
    text,
  });
}

/**
 * Shortcut — build a refusal card from one of the 6 pre-built categories.
 */
export function closeRefusalForCategory(category: CloseRefusalCategory): RefusalCard {
  return closeRefusal(getPrebuiltRefusal(category), category);
}
