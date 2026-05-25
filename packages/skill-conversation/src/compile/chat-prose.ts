/**
 * Compose the chat-surface confirmation/rejection prose.
 *
 * These functions are deliberately string-builders rather than templating
 * engines — they're tiny, fully testable, and never include internal IDs
 * (which would leak abstraction).
 */

import type { AOP } from '@borjie/aop-compiler';
import type { SkillScope, ValidationError } from '../types.js';

/**
 * Plain-English first-run summary. Designed to read like a human assistant
 * reporting back: "Done. First brief Monday 7am EAT. Reply 'pause' to stop."
 */
export function buildChatConfirmation(args: {
  readonly ast: AOP;
  readonly scope: SkillScope;
  readonly nextRunHint: string | null;
}): string {
  const noun = args.scope === 'owner-customer' ? 'your skill' : 'the platform skill';
  const summary = args.ast.description ?? args.ast.name;
  const next = args.nextRunHint ? ` First run: ${args.nextRunHint}.` : '';
  const lifecycleHint =
    args.ast.trigger.kind === 'cron'
      ? "Reply 'pause' any time to stop, 'show' to see the latest run."
      : args.ast.trigger.kind === 'event'
        ? "It will run when the trigger event fires. Reply 'pause' to disarm."
        : "It is ready to run on demand.";
  return `Done. I set up ${noun}: ${summary}.${next} ${lifecycleHint}`;
}

/**
 * Owner-facing rejection prose. Maps validation error codes to short,
 * owner-friendly sentences. Never leaks step ids — the owner doesn't care.
 */
export function buildChatRejection(args: {
  readonly stage:
    | 'intent-rejected'
    | 'autonomy-rejected'
    | 'aop-parse-failed'
    | 'aop-validation-failed'
    | 'destructive-blocked';
  readonly errors: ReadonlyArray<ValidationError>;
}): string {
  switch (args.stage) {
    case 'intent-rejected':
      return "I don't think that's a recurring or conditional task — try rephrasing it as 'every Monday' or 'when X happens'.";
    case 'autonomy-rejected':
      return `I can't set that up: your autonomy cap blocks it. ${firstReason(args.errors)}`.trim();
    case 'aop-parse-failed':
      return `I couldn't understand the schedule or steps. ${firstReason(args.errors)} Try simpler phrasing — e.g. 'every Monday at 7am, send me the weekly brief'.`.trim();
    case 'aop-validation-failed':
      return `That recipe has a structural problem. ${firstReason(args.errors)}`.trim();
    case 'destructive-blocked':
      return `That recipe would run a destructive action without my checking with you first. ${firstReason(args.errors)} I'll need an explicit approval step before any irreversible action.`.trim();
  }
}

function firstReason(errors: ReadonlyArray<ValidationError>): string {
  if (errors.length === 0) return '';
  const first = errors[0]!;
  // Drop internal path noise. Just keep the human message.
  return first.message.endsWith('.') ? first.message : `${first.message}.`;
}

/**
 * For the cron trigger, produce a one-line, human-readable next-run hint
 * like "Monday 7am EAT". Deliberately rough — exact timezone math is the
 * scheduler's job; this is just chat polish.
 */
export function summariseNextRun(ast: AOP): string | null {
  if (ast.trigger.kind !== 'cron') return null;
  return prettifyCron(ast.trigger.schedule, ast.trigger.timezone ?? 'UTC');
}

/**
 * Heuristic cron prettifier. Handles the common owner-grade patterns we
 * emit from NL ("0 9 25 * *", "0 7 * * 1", etc.). Falls back to the raw
 * expression for everything else.
 */
function prettifyCron(expr: string, tz: string): string {
  const m = expr.trim().match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)$/);
  if (!m) return `${expr} (${tz})`;

  const [, minute, hour, dom, _month, dow] = m;
  const time = formatTime(hour ?? '0', minute ?? '0');

  // weekly: "0 7 * * 1" → "every Monday at 7am EAT"
  if (dom === '*' && dow !== '*') {
    const day = DAY_NAMES[Number(dow)] ?? `day ${dow}`;
    return `every ${day} at ${time} ${tz}`;
  }
  // monthly: "0 9 25 * *"
  if (dow === '*' && dom !== '*') {
    return `on day ${dom} of each month at ${time} ${tz}`;
  }
  return `at ${time} ${tz} (${expr})`;
}

const DAY_NAMES: ReadonlyArray<string> = Object.freeze([
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]);

function formatTime(h: string, m: string): string {
  const hour = Number(h);
  const minute = Number(m);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return `${h}:${m}`;
  }
  const meridiem = hour < 12 ? 'am' : 'pm';
  const display = hour === 0 ? 12 : hour <= 12 ? hour : hour - 12;
  return minute === 0 ? `${display}${meridiem}` : `${display}:${minute.toString().padStart(2, '0')}${meridiem}`;
}
