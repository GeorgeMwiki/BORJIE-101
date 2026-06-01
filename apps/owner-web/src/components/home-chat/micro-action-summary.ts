'use client';

/**
 * micro-action-summary — build the localized one-line summary shown in
 * the chat after an inline micro-action executes.
 *
 * The gateway action-bridge returns a verb-specific `result` payload
 * (shape varies per tool). This pure helper reads the few fields the
 * SAFE verbs emit and resolves them through the locale-bound translator
 * so EVERY rendered word comes from the dictionary — zero hardcoded
 * copy, EN/SW pure by construction. Unknown verbs fall back to the
 * generic "Action completed." line.
 */

import type { TFn } from '@/i18n/resolve';
import type { MicroActionResult } from '@/lib/queries/chat-actions';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : '';
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

function reminderSummary(
  t: TFn,
  result: Record<string, unknown>,
  params: Readonly<Record<string, unknown>>,
): string {
  const title =
    asString(result.title) || asString(params['title']) || t('teach.microAction.actionDone');
  const days = asPositiveInt(result.dueInDays) ?? asPositiveInt(params['dueInDays']);
  return days !== null
    ? t('teach.microAction.reminderSetIn', { title, days })
    : t('teach.microAction.reminderSet', { title });
}

function snoozeSummary(
  t: TFn,
  result: Record<string, unknown>,
  params: Readonly<Record<string, unknown>>,
): string {
  const days =
    asPositiveInt(result.days) ?? asPositiveInt(params['days']) ?? 1;
  return t('teach.microAction.reminderSnoozed', { days });
}

/**
 * Resolve the localized summary line for an executed micro-action.
 * `verb` selects the verb-specific template; `params` is the dispatched
 * payload, used as a fallback when the server echoes nothing back.
 */
export function buildMicroActionSummary(args: {
  readonly t: TFn;
  readonly verb: string;
  readonly result: MicroActionResult['result'];
  readonly params: Readonly<Record<string, unknown>>;
}): string {
  const { t, verb, params } = args;
  const result = isRecord(args.result) ? args.result : {};

  if (verb === 'set_reminder') return reminderSummary(t, result, params);
  if (verb === 'snooze_reminder') return snoozeSummary(t, result, params);

  // Any other SAFE verb that executes — prefer a server-echoed message,
  // else the generic completion line. The echoed message is server copy
  // already localized per the request's Accept-Language, so it is safe
  // to surface verbatim.
  return asString(result['message']) || t('teach.microAction.actionDone');
}
