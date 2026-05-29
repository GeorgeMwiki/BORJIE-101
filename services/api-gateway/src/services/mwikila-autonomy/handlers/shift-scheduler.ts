/**
 * Mr. Mwikila handler — shift scheduler.
 *
 * Looks at the next 7 days × workforce × site capacity → drafts a
 * schedule. Default tier is T2 (act-with-reversal). The owner can
 * reverse within 24h.
 *
 * Pure-logic shape: ports for workforce / sites / existing schedule
 * are injected so vitest drives every branch deterministically.
 */

import type { MwikilaHandler, MwikilaHandlerProposal } from '../handler-runtime.js';

export interface WorkforceMember {
  readonly id: string;
  readonly fullName: string;
  readonly availabilityDays: ReadonlyArray<number>; // 0=Sun..6=Sat
}

export interface SiteCapacity {
  readonly siteId: string;
  readonly siteName: string;
  readonly minWorkersPerShift: number;
  readonly maxWorkersPerShift: number;
}

export interface ShiftSchedulerPorts {
  listActiveWorkforce(args: {
    readonly tenantId: string;
  }): Promise<ReadonlyArray<WorkforceMember>>;
  listSiteCapacity(args: {
    readonly tenantId: string;
  }): Promise<ReadonlyArray<SiteCapacity>>;
  /**
   * Returns true when a schedule already covers any day in the
   * window. The handler skips when true so the autonomous draft does
   * not collide with a manually-authored schedule.
   */
  hasOverlappingSchedule(args: {
    readonly tenantId: string;
    readonly fromIso: string;
    readonly toIso: string;
  }): Promise<boolean>;
}

export interface ShiftSchedulerOptions {
  readonly horizonDays?: number;
}

const DEFAULT_HORIZON = 7;

export function buildShiftScheduleProposal(
  members: ReadonlyArray<WorkforceMember>,
  sites: ReadonlyArray<SiteCapacity>,
  fromIso: string,
  horizonDays: number,
): MwikilaHandlerProposal | null {
  if (members.length === 0 || sites.length === 0) return null;

  // Build a per-day per-site assignment. Round-robin members through
  // sites with availability filtering. Deterministic for tests.
  const assignments: Array<{
    readonly day: string;
    readonly siteId: string;
    readonly memberIds: ReadonlyArray<string>;
  }> = [];

  const from = new Date(fromIso);
  for (let d = 0; d < horizonDays; d += 1) {
    const day = new Date(from.getTime() + d * 86_400_000);
    const dayIso = day.toISOString().slice(0, 10);
    const weekday = day.getUTCDay();
    const available = members.filter((m) =>
      m.availabilityDays.includes(weekday),
    );
    if (available.length === 0) continue;
    for (let s = 0; s < sites.length; s += 1) {
      const site = sites[s];
      const want = Math.min(
        site.maxWorkersPerShift,
        Math.max(site.minWorkersPerShift, 1),
      );
      const memberIds: string[] = [];
      for (let i = 0; i < want; i += 1) {
        const m = available[(d * sites.length + s + i) % available.length];
        memberIds.push(m.id);
      }
      assignments.push({ day: dayIso, siteId: site.siteId, memberIds });
    }
  }

  if (assignments.length === 0) return null;

  return {
    actionKind: 'shifts.weekly_schedule_draft',
    category: 'shifts',
    summary: `Drafted ${horizonDays}-day shift schedule across ${sites.length} sites (${members.length} workers).`,
    summarySw: `Ratiba ya zamu ya siku ${horizonDays} imetayarishwa kwenye maeneo ${sites.length} (wafanyakazi ${members.length}).`,
    rationale:
      `Round-robin assignment within each worker's availabilityDays, ` +
      `respecting per-site min/max worker counts. Deterministic so the ` +
      `owner can replay and revert if needed.`,
    payload: {
      windowStartIso: fromIso,
      horizonDays,
      assignments,
    },
    amountTzs: 0,
    currency: 'TZS',
  };
}

export function createShiftSchedulerHandler(
  ports: ShiftSchedulerPorts,
  opts: ShiftSchedulerOptions = {},
): MwikilaHandler {
  const horizon = opts.horizonDays ?? DEFAULT_HORIZON;
  return Object.freeze({
    actionKind: 'shifts.weekly_schedule_draft',
    category: 'shifts',
    async propose({ tenantId, now }) {
      const fromIso = now.toISOString();
      const toIso = new Date(
        now.getTime() + horizon * 86_400_000,
      ).toISOString();
      const overlap = await ports.hasOverlappingSchedule({
        tenantId,
        fromIso,
        toIso,
      });
      if (overlap) return null;
      const [members, sites] = await Promise.all([
        ports.listActiveWorkforce({ tenantId }),
        ports.listSiteCapacity({ tenantId }),
      ]);
      return buildShiftScheduleProposal(members, sites, fromIso, horizon);
    },
  });
}
