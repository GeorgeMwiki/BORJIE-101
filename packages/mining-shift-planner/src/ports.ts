/**
 * Injected ports for the mining-shift-planner.
 *
 * Defaults are in-memory so the package is usable standalone in tests;
 * composition roots replace these with adapters into
 * `@borjie/workforce-orchestrator`, `@borjie/assignment-registry`, and
 * `@borjie/regulatory-tz-mining`.
 */

import type { ShiftAssignment, ShiftPlan } from './types.js';

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Persists a finalized shift plan into the assignment registry. */
export interface AssignmentSinkPort {
  publishAssignments(args: {
    readonly tenantId: string;
    readonly siteId: string;
    readonly assignments: ReadonlyArray<ShiftAssignment>;
  }): Promise<{ readonly publishedCount: number }>;
}

/** Reads OSHA-TZ rule overrides from regulatory-tz-mining (jurisdictional). */
export interface OshaRulebookPort {
  fetchOverrides(args: {
    readonly tenantId: string;
    readonly siteId: string;
  }): Promise<{
    readonly maxShiftHours?: number;
    readonly minRestHours?: number;
    readonly maxConsecutiveDays?: number;
    readonly undergroundMaxWeeklyHours?: number;
    readonly hazardRotationHours?: number;
    readonly heatStressTempC?: number;
  }>;
}

/**
 * In-memory AssignmentSinkPort — collects published assignments into
 * the provided buffer. Useful for tests + dry-run mode.
 *
 * LATER(wire): replace with `@borjie/assignment-registry`
 * createLifecycleManager() adapter. See KI-DEBT-001.
 */
export function createInMemoryAssignmentSink(
  buffer: ShiftPlan[] = [],
): AssignmentSinkPort {
  return {
    async publishAssignments({ tenantId, siteId, assignments }) {
      buffer.push({
        tenantId,
        siteId,
        shiftStartISO: assignments[0]?.startISO ?? new Date(0).toISOString(),
        shiftEndISO: assignments[0]?.endISO ?? new Date(0).toISOString(),
        shiftKind: 'morning',
        assignments: assignments.map((a) => ({ ...a })),
        unassignedTasks: [],
        rotationAlerts: [],
      });
      return { publishedCount: assignments.length };
    },
  };
}

/**
 * In-memory OshaRulebookPort — returns the empty override set.
 *
 * LATER(wire): swap for `@borjie/regulatory-tz-mining` jurisdictional
 * loader once the OSHA-TZ ruleset ships there (currently NEMC /
 * TUMEMADINI / BOT / TRA / GEPG only). See KI-DEBT-001.
 */
export function createInMemoryOshaRulebook(
  overrides: {
    maxShiftHours?: number;
    minRestHours?: number;
    maxConsecutiveDays?: number;
    undergroundMaxWeeklyHours?: number;
    hazardRotationHours?: number;
    heatStressTempC?: number;
  } = {},
): OshaRulebookPort {
  return {
    async fetchOverrides() {
      return overrides;
    },
  };
}
