'use client';

/**
 * hint-action-suggestion — the SINGLE mapping from a ProactiveHint CTA emit to
 * the localized follow-up turn the cockpit sends to the brain.
 *
 * BorjieDynamicHints fires `onHintAction(hintId, action)` for the canonical
 * Theory-of-Mind emits. Every host that mounts BorjieDynamicHints MUST wire a
 * handler that turns the emit into a real follow-up — otherwise the hint's
 * button is a dead click. Keeping the action→turn map here (one source of
 * truth) means a new mount cannot diverge from the wired one.
 *
 * Pure + locale-bound: the returned text resolves through the caller's `t`, so
 * every word comes from the dictionary (EN/SW pure by construction). Returns
 * `null` for an unmapped action so the caller drops it (never a junk turn).
 */

import type { TFn } from '@/i18n/resolve';

/** Canonical hint action → dictionary key for its follow-up owner message. */
const KEY_BY_HINT_ACTION: Readonly<Record<string, string>> = {
  'borjie:handoff:human': 'teach.hintHandoff',
  'borjie:explain:simpler': 'teach.hintSimpler',
  'borjie:teach:cmdk': 'teach.hintCmdk',
};

/**
 * Resolve the localized follow-up turn for a hint CTA, or `null` when the
 * action is not one of the canonical emits (caller drops it — no dead click,
 * no junk turn).
 */
export function hintActionSuggestion(action: string, t: TFn): string | null {
  const key = KEY_BY_HINT_ACTION[action];
  return key ? t(key) : null;
}
