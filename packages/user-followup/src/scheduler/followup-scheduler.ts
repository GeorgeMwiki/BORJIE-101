/**
 * Follow-up scheduler — pulls candidates, respects preferences +
 * quiet hours, dispatches via channel adapters, marks final state.
 *
 * Pure given an injected clock + repos + dispatchers. Determinism
 * is load-bearing: §10 of the spec requires that the same
 * (clock, prefs, candidates) tuple produce the same dispatches.
 */

import {
  DEFAULT_CHANNEL,
  DEFAULT_MAX_PER_DAY,
  DEFAULT_QUIET_HOURS_END,
  DEFAULT_QUIET_HOURS_START,
  type AuditChainPort,
  type ChannelDispatcher,
  type DispatchResult,
  type FollowupCandidate,
  type FollowupCandidateRepository,
  type FollowupChannel,
  type FollowupPreferences,
  type FollowupPreferencesRepository,
} from '../types.js';

export interface SchedulerDeps {
  readonly candidateRepo: FollowupCandidateRepository;
  readonly prefsRepo: FollowupPreferencesRepository;
  readonly dispatchers: ReadonlyMap<FollowupChannel, ChannelDispatcher>;
  readonly audit: AuditChainPort;
  readonly clock: () => Date;
}

export interface SchedulerTickResult {
  readonly dispatched: ReadonlyArray<DispatchSummary>;
  readonly suppressed: ReadonlyArray<SuppressionRecord>;
}

export interface DispatchSummary {
  readonly candidate_id: string;
  readonly user_id: string;
  readonly channel: FollowupChannel;
  readonly result: DispatchResult;
}

export interface SuppressionRecord {
  readonly candidate_id: string;
  readonly user_id: string;
  readonly reason:
    | 'quiet_hours'
    | 'channel_disallowed'
    | 'daily_cap'
    | 'no_dispatcher';
}

/**
 * Parse an `HH:MM:SS` clock string to a minutes-since-midnight integer.
 */
export function clockToMinutes(clockStr: string): number {
  const [hh, mm] = clockStr.split(':').map((p) => Number.parseInt(p, 10));
  if (hh === undefined || mm === undefined) return 0;
  if (Number.isNaN(hh) || Number.isNaN(mm)) return 0;
  return hh * 60 + mm;
}

/**
 * Test if `now` (in the user's local clock minutes-since-midnight)
 * sits inside the quiet-hours window. The window may wrap midnight
 * (e.g. 22:00 → 07:00).
 */
export function isInQuietHours(
  nowMinutes: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Wrap-midnight window (e.g. 22:00 → 07:00).
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

/**
 * Convert a `Date` to minutes-since-midnight in the named IANA
 * timezone. Uses Intl.DateTimeFormat (Node ≥ 18). If the tz is
 * unknown, falls back to UTC.
 */
export function nowMinutesInTimezone(now: Date, timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const hh = Number.parseInt(
      parts.find((p) => p.type === 'hour')?.value ?? '0',
      10,
    );
    const mm = Number.parseInt(
      parts.find((p) => p.type === 'minute')?.value ?? '0',
      10,
    );
    return hh * 60 + mm;
  } catch {
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/**
 * Build a default prefs row when the user has none yet. Spec §6:
 * the defaults are conservative — 22:00→07:00 quiet hours, max 5
 * per day, in-app only.
 */
export function defaultPreferencesFor(
  tenant_id: string,
  user_id: string,
): FollowupPreferences {
  return {
    tenant_id,
    user_id,
    allowed_channels: [DEFAULT_CHANNEL],
    quiet_hours_start: DEFAULT_QUIET_HOURS_START,
    quiet_hours_end: DEFAULT_QUIET_HOURS_END,
    max_per_day: DEFAULT_MAX_PER_DAY,
    timezone: 'UTC',
  };
}

/**
 * Pick the dispatchable channel for a candidate. Spec §6: if the
 * candidate's preferred channel is disallowed, fall back to
 * `email`, then `inapp`. If nothing matches, return `null`.
 */
export function resolveChannel(
  candidate: FollowupCandidate,
  prefs: FollowupPreferences,
): FollowupChannel | null {
  const allowed = new Set(prefs.allowed_channels);
  if (allowed.has(candidate.channel)) return candidate.channel;
  if (allowed.has('email')) return 'email';
  if (allowed.has('inapp')) return 'inapp';
  return null;
}

/**
 * Single scheduler tick. Reads everything due, applies suppression
 * rules, dispatches through the matching channel adapter, marks
 * each row `sent` (or leaves `pending` on dispatch error).
 */
export async function runSchedulerOnce(
  deps: SchedulerDeps,
  tenant_id: string,
): Promise<SchedulerTickResult> {
  const now = deps.clock();
  const due = await deps.candidateRepo.listDue(tenant_id, now);

  const dispatched: DispatchSummary[] = [];
  const suppressed: SuppressionRecord[] = [];

  for (const candidate of due) {
    const prefs =
      (await deps.prefsRepo.get(tenant_id, candidate.user_id)) ??
      defaultPreferencesFor(tenant_id, candidate.user_id);

    // 1. Quiet hours — non-critical only.
    if (!candidate.critical) {
      const nowMinutes = nowMinutesInTimezone(now, prefs.timezone);
      const startMinutes = clockToMinutes(prefs.quiet_hours_start);
      const endMinutes = clockToMinutes(prefs.quiet_hours_end);
      if (isInQuietHours(nowMinutes, startMinutes, endMinutes)) {
        suppressed.push({
          candidate_id: candidate.id,
          user_id: candidate.user_id,
          reason: 'quiet_hours',
        });
        continue;
      }
    }

    // 2. Channel routing.
    const channel = resolveChannel(candidate, prefs);
    if (channel === null) {
      suppressed.push({
        candidate_id: candidate.id,
        user_id: candidate.user_id,
        reason: 'channel_disallowed',
      });
      continue;
    }

    // 3. Daily cap — non-critical only.
    if (!candidate.critical) {
      const sentToday = await deps.candidateRepo.countSentToday(
        tenant_id,
        candidate.user_id,
        now,
      );
      if (sentToday >= prefs.max_per_day) {
        suppressed.push({
          candidate_id: candidate.id,
          user_id: candidate.user_id,
          reason: 'daily_cap',
        });
        continue;
      }
    }

    // 4. Dispatch via the resolved channel.
    const dispatcher = deps.dispatchers.get(channel);
    if (!dispatcher) {
      suppressed.push({
        candidate_id: candidate.id,
        user_id: candidate.user_id,
        reason: 'no_dispatcher',
      });
      continue;
    }

    const result = await dispatcher.dispatch({ ...candidate, channel });
    if (result.delivered) {
      const auditHash = await deps.audit.append({
        kind: 'followup_dispatched',
        candidate_id: candidate.id,
        tenant_id,
        user_id: candidate.user_id,
        channel,
        source: candidate.source,
        priority: candidate.priority,
        dispatched_at: result.delivered_at,
      });
      await deps.candidateRepo.markSent(
        candidate.id,
        new Date(result.delivered_at),
        auditHash,
      );
    }
    dispatched.push({
      candidate_id: candidate.id,
      user_id: candidate.user_id,
      channel,
      result,
    });
  }

  return { dispatched, suppressed };
}
