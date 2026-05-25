/**
 * Chat-surface helpers — turn a SkillRegistryEntry (or a list of them) into
 * the strings the MD speaks back.
 *
 * Examples:
 *
 *   summariseEntry(entry)  → "Weekly brief — runs every Monday at 7am EAT.
 *                             Last ran yesterday: opened. Reply 'show' to see it."
 *
 *   summariseList(entries) → "You have 3 skills set up: ..."
 *
 * Pure: same input → same string.
 */

import type { SkillRegistryEntry } from '../types.js';

/**
 * Compose a one-line status summary suitable for chat. Designed to fit
 * inside a single message bubble.
 */
export function summariseEntry(entry: SkillRegistryEntry): string {
  const status = describeLifecycle(entry);
  const lastRun = describeLastRun(entry);
  const cadence = describeCadence(entry);

  // Examples:
  //   "Weekly brief is active (every Monday at 7am EAT) — last ran Mon: completed."
  //   "Lease-renewal-60d is paused — last ran 3d ago: failed."
  return `${entry.summary} ${status}${cadence}${lastRun}`.trim();
}

/**
 * Compose a multi-line list summary for "show me my skills".
 */
export function summariseList(entries: ReadonlyArray<SkillRegistryEntry>): string {
  if (entries.length === 0) return 'You have no skills set up yet.';
  const lines = entries.map((e, i) => `${i + 1}. ${summariseEntry(e)}`);
  const header = `You have ${entries.length} skill${entries.length === 1 ? '' : 's'} set up:`;
  return `${header}\n${lines.join('\n')}`;
}

function describeLifecycle(entry: SkillRegistryEntry): string {
  switch (entry.lifecycle) {
    case 'active':
      return 'is active';
    case 'paused':
      return 'is paused';
    case 'draft':
      return 'is a draft (not yet confirmed)';
    case 'deleted':
      return 'has been deleted';
  }
}

function describeCadence(entry: SkillRegistryEntry): string {
  if (!entry.cronHandle) return '';
  // The cron handle is encoded as `cron:<aopName>:<schedule>`. We extract the
  // schedule and prettify just enough for chat.
  const match = entry.cronHandle.match(/^cron:[^:]+:(.+)$/);
  if (!match) return '';
  return ` (${match[1]})`;
}

function describeLastRun(entry: SkillRegistryEntry): string {
  if (!entry.lastRun) return entry.lifecycle === 'active' ? ' — has not run yet.' : '.';
  switch (entry.lastRun.outcome) {
    case 'completed':
      return ` — last ran ${entry.lastRun.at}: completed.`;
    case 'failed':
      return ` — last ran ${entry.lastRun.at}: FAILED${entry.lastRun.note ? ` (${entry.lastRun.note})` : ''}.`;
    case 'in-progress':
      return ` — currently running (started ${entry.lastRun.at}).`;
  }
}

/**
 * Build the chat acknowledgement for a pause / resume / delete action.
 * Mirrors the confirmation prose used at creation time.
 */
export function buildLifecycleAck(args: {
  readonly action: 'paused' | 'resumed' | 'deleted';
  readonly entry: SkillRegistryEntry;
}): string {
  switch (args.action) {
    case 'paused':
      return `Paused "${args.entry.summary}". Reply 'resume' to re-arm it.`;
    case 'resumed':
      return `Resumed "${args.entry.summary}". It is active again.`;
    case 'deleted':
      return `Deleted "${args.entry.summary}". It will not run again.`;
  }
}
