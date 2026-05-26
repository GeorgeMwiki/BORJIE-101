/**
 * Daily briefing cron — fires at 06:00 owner-local time per tenant.
 *
 * Implementation strategy:
 *
 *   - One PROCESS-LEVEL minute-cadence cron scans the tenant list and
 *     fires the daily-briefing for every tenant whose local clock has
 *     just rolled into the configured hour (06:00 by default).
 *   - We compare against tenant timezone (sourced from
 *     tenants.settings.timezone, falling back to
 *     DEFAULT_TENANT_TZ) using Intl.DateTimeFormat — no external
 *     timezone library needed.
 *   - A 24-hour idempotency window per (tenantId, date) prevents
 *     double-firing if the cron tick overlaps the briefing run.
 *
 * Operationally simple, fully testable, no per-tenant cron stack.
 *
 * @module research-orchestrator/cron/daily-briefing-cron
 */

import cron from 'node-cron';
import { runDailyBriefing } from '../modes/daily-briefing.js';
import type { BriefingTenant, OrchestratorLogger } from '../types.js';
import type { ModeRunDeps } from '../modes/shared.js';

export interface BriefingTenantLister {
  /** List active tenants the briefing should fire for. */
  listActiveTenants(): Promise<ReadonlyArray<BriefingTenant>>;
}

export interface DailyBriefingCronOptions {
  readonly deps: ModeRunDeps;
  readonly tenants: BriefingTenantLister;
  /** Hour 0..23 in the tenant's local timezone. Default 6. */
  readonly hour: number;
  /** Minute 0..59 in the tenant's local timezone. Default 0. */
  readonly minute: number;
  readonly logger?: OrchestratorLogger;
  /** Override the wall-clock for tests. */
  readonly now?: () => Date;
}

export interface DailyBriefingCronHandle {
  stop(): void;
  /** Invoke the sweep once. Exposed for tests + the one-shot run mode. */
  runOnce(now?: Date): Promise<{ readonly tenantsFired: number }>;
}

const SWEEP_CRON = '* * * * *'; // every minute — cheap, idempotent

export function startDailyBriefingCron(
  options: DailyBriefingCronOptions,
): DailyBriefingCronHandle {
  // Per-tenant last-fire date (YYYY-MM-DD in tenant TZ). In-memory is
  // fine — a fresh container will fall through to the briefing table's
  // PK + uniqueness on (tenant, date) for the durable guard.
  const lastFiredDate = new Map<string, string>();
  const nowFn = options.now ?? (() => new Date());

  async function sweep(): Promise<{ tenantsFired: number }> {
    const tenants = await safeList(options);
    let tenantsFired = 0;

    for (const tenant of tenants) {
      const local = tenantLocalParts(nowFn(), tenant.timezone);
      const isFireMinute =
        local.hour === options.hour && local.minute === options.minute;
      if (!isFireMinute) continue;

      const lastDate = lastFiredDate.get(tenant.tenantId);
      if (lastDate === local.date) continue;

      try {
        await runDailyBriefing(
          { tenantId: tenant.tenantId },
          options.deps,
          options.logger,
        );
        lastFiredDate.set(tenant.tenantId, local.date);
        tenantsFired += 1;
      } catch (error) {
        options.logger?.warn(
          {
            tenant_id: tenant.tenantId,
            err: error instanceof Error ? error.message : String(error),
          },
          'daily-briefing-cron: tenant run failed',
        );
      }
    }

    if (tenantsFired > 0) {
      options.logger?.info(
        { tenants_fired: tenantsFired },
        'daily-briefing-cron: sweep complete',
      );
    }
    return { tenantsFired };
  }

  const task = cron.schedule(SWEEP_CRON, () => {
    sweep().catch((err: unknown) => {
      options.logger?.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'daily-briefing-cron: sweep failed',
      );
    });
  });

  return {
    stop() {
      task.stop();
    },
    async runOnce() {
      return sweep();
    },
  };
}

async function safeList(
  options: DailyBriefingCronOptions,
): Promise<ReadonlyArray<BriefingTenant>> {
  try {
    return await options.tenants.listActiveTenants();
  } catch (error) {
    options.logger?.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'daily-briefing-cron: tenant lister failed',
    );
    return [];
  }
}

interface LocalParts {
  readonly date: string; // YYYY-MM-DD
  readonly hour: number; // 0..23
  readonly minute: number; // 0..59
}

/**
 * Convert a UTC instant to the tenant-local Y-M-D + h:m. Uses
 * Intl.DateTimeFormat so no external tz library is required.
 */
export function tenantLocalParts(now: Date, timezone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (kind: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === kind)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0; // some locales surface 24 instead of 0
  const minute = Number(get('minute'));
  return {
    date: `${year}-${month}-${day}`,
    hour,
    minute,
  };
}
