/**
 * Daily performance scheduler (Wave PERF-1).
 *
 * Runs once per minute; fires per-employee at 06:00 local time
 * (default; tenant override permitted via `EmployeeScheduleConfig`).
 * Honours FOUNDER_LOCKED §1 quiet hours universal 18:00–06:00 — items
 * raised during quiet hours queue and fire at 06:00 local. The 06:00
 * fire time coincides with the end of quiet hours so the typical
 * path queues briefly through the boundary.
 *
 * Determinism is load-bearing: the same (clock, employees, templates,
 * measurements) tuple MUST produce the same dispatches.
 */

import {
  DEFAULT_FIRE_HOUR,
  DEFAULT_FIRE_MINUTE,
  QUIET_HOURS_END,
  QUIET_HOURS_START,
  type AuditChainPort,
  type EmployeeScorecard,
  type KpiMeasurementPort,
  type KpiTemplateRepository,
  type NudgeChannel,
  type OrgScopeResolver,
  type PerfNudge,
  type PerfNudgeRepository,
  type RecipientTier,
  type RoleKpiTemplate,
  type ScorecardRepository,
  type VoiceModeReader,
} from '../types.js';
import {
  computeScorecard,
  type ScoreDeps,
} from '../score/scorer.js';
import {
  renderTier,
} from '../tier/recipient-tier-renderer.js';
import {
  generateCoachNudge,
  type CoachNudgeGenerator,
  type CoachVoice,
} from '../nudge/coach-nudge.js';

export interface EmployeeRoster {
  /** Returns every employee user_id in scope for the tenant. */
  listEmployees(tenant_id: string): Promise<
    ReadonlyArray<{
      readonly user_id: string;
      readonly role: string;
      readonly timezone: string;
    }>
  >;
}

export interface EmployeeScheduleConfig {
  /** Hour-of-day (local) at which to fire. Default 6. */
  readonly fire_hour?: number;
  /** Minute-of-hour (local) at which to fire. Default 0. */
  readonly fire_minute?: number;
  /** Default channel for nudges. */
  readonly default_channel?: NudgeChannel;
}

export interface DailyPerfCronDeps {
  readonly roster: EmployeeRoster;
  readonly templates: KpiTemplateRepository;
  readonly scorecards: ScorecardRepository;
  readonly nudges: PerfNudgeRepository;
  readonly orgScope: OrgScopeResolver;
  readonly voice: VoiceModeReader;
  readonly measurementPort: KpiMeasurementPort;
  readonly audit: AuditChainPort;
  readonly nudgeGenerator?: CoachNudgeGenerator;
  readonly clock: () => Date;
  readonly hash: (payload: Readonly<Record<string, unknown>>) => string;
  readonly newId: () => string;
  readonly config?: EmployeeScheduleConfig;
}

export interface ScheduleTickResult {
  readonly fired: ReadonlyArray<{
    readonly employee_user_id: string;
    readonly scorecard_id: string;
    readonly nudges_emitted: number;
  }>;
  readonly skipped: ReadonlyArray<{
    readonly employee_user_id: string;
    readonly reason:
      | 'outside_fire_window'
      | 'already_processed'
      | 'no_template'
      | 'quiet_hours_queued';
  }>;
}

// ---------------------------------------------------------------------------
// Time utilities — local to this module (do NOT depend on user-followup's
// internal helpers; those live behind their package boundary and may change
// independently).
// ---------------------------------------------------------------------------

/** Parse `HH:MM` to minutes-since-midnight. */
function clockToMinutes(clockStr: string): number {
  const parts = clockStr.split(':');
  const hh = Number.parseInt(parts[0] ?? '0', 10);
  const mm = Number.parseInt(parts[1] ?? '0', 10);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return 0;
  return hh * 60 + mm;
}

/** Wrap-aware quiet-hours predicate. */
export function isInQuietHours(
  nowMinutes: number,
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
  }
  // Wrap-midnight window (e.g. 18:00 → 06:00).
  return nowMinutes >= startMinutes || nowMinutes < endMinutes;
}

/** Return (hour, minute) in the given IANA timezone. */
export function timeOfDayInTimezone(
  now: Date,
  timezone: string,
): { readonly hour: number; readonly minute: number } {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const hourStr =
      parts.find((p) => p.type === 'hour')?.value ?? '0';
    const minStr = parts.find((p) => p.type === 'minute')?.value ?? '0';
    let hour = Number.parseInt(hourStr, 10);
    if (Number.isNaN(hour)) hour = 0;
    // Intl with hour12:false sometimes returns "24" instead of "00".
    if (hour === 24) hour = 0;
    let minute = Number.parseInt(minStr, 10);
    if (Number.isNaN(minute)) minute = 0;
    return { hour, minute };
  } catch {
    return { hour: now.getUTCHours(), minute: now.getUTCMinutes() };
  }
}

/** ISO local-date string `YYYY-MM-DD` in the given timezone. */
export function dateStringInTimezone(now: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
    const m = parts.find((p) => p.type === 'month')?.value ?? '01';
    const d = parts.find((p) => p.type === 'day')?.value ?? '01';
    return `${y}-${m}-${d}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Return the previous day's date string in the given timezone. */
export function previousDateStringInTimezone(
  now: Date,
  timezone: string,
): string {
  const today = dateStringInTimezone(now, timezone);
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

const QUIET_START_MIN = clockToMinutes(QUIET_HOURS_START);
const QUIET_END_MIN = clockToMinutes(QUIET_HOURS_END);

interface FireOnceArgs {
  readonly employee: {
    readonly user_id: string;
    readonly role: string;
    readonly timezone: string;
  };
  readonly tenant_id: string;
  readonly date: string;
  readonly template: RoleKpiTemplate;
  readonly deps: DailyPerfCronDeps;
  readonly defaultChannel: NudgeChannel;
}

async function fireOnceForEmployee(args: FireOnceArgs): Promise<{
  readonly scorecard_id: string;
  readonly nudges_emitted: number;
}> {
  const { employee, tenant_id, date, template, deps, defaultChannel } = args;
  const prior = await deps.scorecards.latestPrior(
    tenant_id,
    employee.user_id,
    date,
  );
  const scoreDeps: ScoreDeps = {
    measurementPort: deps.measurementPort,
    now: deps.clock,
    hash: deps.hash,
    newId: deps.newId,
  };
  const card: EmployeeScorecard = await computeScorecard(
    {
      tenant_id,
      employee_user_id: employee.user_id,
      role: employee.role,
      date,
      template,
      prior,
    },
    scoreDeps,
  );
  await deps.scorecards.insert(card);
  // Determine subject voice mode.
  const subjectVoice: CoachVoice = await deps.voice.readMode(
    tenant_id,
    employee.user_id,
  );
  // Render the subject-tier full text. We use the canned generator
  // unless the host supplied an LLM generator override.
  const fullBody = deps.nudgeGenerator
    ? await deps.nudgeGenerator.generate({
        scorecard: card,
        template,
        voice: subjectVoice,
      })
    : generateCoachNudge({
        scorecard: card,
        template,
        voice: subjectVoice,
      });
  const supervisorUserId = await deps.orgScope.resolveDirectSupervisor(
    tenant_id,
    employee.user_id,
  );
  const ownerUserId = await deps.orgScope.resolveOwner(tenant_id);
  const recipients: Array<{
    readonly tier: RecipientTier;
    readonly user_id: string;
  }> = [{ tier: 'subject', user_id: employee.user_id }];
  if (supervisorUserId !== null && supervisorUserId !== employee.user_id) {
    recipients.push({ tier: 'supervisor', user_id: supervisorUserId });
  }
  if (
    ownerUserId !== null &&
    ownerUserId !== employee.user_id &&
    ownerUserId !== supervisorUserId
  ) {
    recipients.push({ tier: 'owner', user_id: ownerUserId });
  }
  // Fetch tenant-wide scorecards for the owner aggregate.
  const tenantCards = await deps.scorecards.listForDate(tenant_id, date);
  let nudges = 0;
  for (const rec of recipients) {
    const view = renderTier({
      scorecard: card,
      tier: rec.tier,
      fullBody,
      tenantScorecardsForDate: tenantCards,
    });
    const id = deps.newId();
    const created_at = deps.clock().toISOString();
    const auditHash = deps.hash({
      kind: 'perf_nudge',
      scorecard_id: card.id,
      recipient_user_id: rec.user_id,
      recipient_tier: rec.tier,
      content_length: view.body.length,
      created_at,
    });
    const ownerBody =
      rec.tier === 'owner' && view.aggregate
        ? `Aggregate: ${view.aggregate.n_employees} employees, mean score ${view.aggregate.mean_score.toFixed(2)}, ${view.aggregate.n_below_target} below target, ${view.aggregate.n_exceeded} exceeded.`
        : view.body;
    const nudge: PerfNudge = {
      id,
      tenant_id,
      scorecard_id: card.id,
      recipient_user_id: rec.user_id,
      recipient_tier: rec.tier,
      content: ownerBody,
      channel: defaultChannel,
      sent_at: null,
      audit_hash: auditHash,
      created_at,
    };
    await deps.nudges.insert(nudge);
    await deps.audit.append({
      kind: 'perf_nudge_emitted',
      nudge_id: id,
      tenant_id,
      recipient_tier: rec.tier,
    });
    nudges += 1;
  }
  return { scorecard_id: card.id, nudges_emitted: nudges };
}

/**
 * Run one scheduler tick for the given tenant. The caller invokes
 * this once per minute from a host cron or worker loop.
 */
export async function runDailyPerfCronOnce(
  tenant_id: string,
  deps: DailyPerfCronDeps,
): Promise<ScheduleTickResult> {
  const fireHour = deps.config?.fire_hour ?? DEFAULT_FIRE_HOUR;
  const fireMinute = deps.config?.fire_minute ?? DEFAULT_FIRE_MINUTE;
  const defaultChannel: NudgeChannel =
    deps.config?.default_channel ?? 'inapp';
  const now = deps.clock();
  const employees = await deps.roster.listEmployees(tenant_id);
  const fired: Array<{
    readonly employee_user_id: string;
    readonly scorecard_id: string;
    readonly nudges_emitted: number;
  }> = [];
  const skipped: Array<{
    readonly employee_user_id: string;
    readonly reason:
      | 'outside_fire_window'
      | 'already_processed'
      | 'no_template'
      | 'quiet_hours_queued';
  }> = [];
  for (const employee of employees) {
    const tod = timeOfDayInTimezone(now, employee.timezone);
    const inFireWindow =
      tod.hour === fireHour &&
      Math.abs(tod.minute - fireMinute) <= 1;
    const localMinutes = tod.hour * 60 + tod.minute;
    const inQuiet = isInQuietHours(localMinutes, QUIET_START_MIN, QUIET_END_MIN);
    if (!inFireWindow) {
      // 06:00 is the boundary of the 18:00→06:00 quiet window. We
      // skip non-fire windows entirely; an explicit quiet-hours
      // queuing event is emitted when the host calls this scheduler
      // during the quiet portion of the day.
      if (inQuiet) {
        skipped.push({
          employee_user_id: employee.user_id,
          reason: 'quiet_hours_queued',
        });
      } else {
        skipped.push({
          employee_user_id: employee.user_id,
          reason: 'outside_fire_window',
        });
      }
      continue;
    }
    const date = previousDateStringInTimezone(now, employee.timezone);
    const existing = await deps.scorecards.findByDate(
      tenant_id,
      employee.user_id,
      date,
    );
    if (existing) {
      skipped.push({
        employee_user_id: employee.user_id,
        reason: 'already_processed',
      });
      continue;
    }
    const template =
      (await deps.templates.get(tenant_id, employee.role)) ??
      (await deps.templates.get('__seed__', employee.role));
    if (!template) {
      skipped.push({
        employee_user_id: employee.user_id,
        reason: 'no_template',
      });
      continue;
    }
    const outcome = await fireOnceForEmployee({
      employee,
      tenant_id,
      date,
      template,
      deps,
      defaultChannel,
    });
    fired.push({
      employee_user_id: employee.user_id,
      ...outcome,
    });
  }
  return { fired, skipped };
}
