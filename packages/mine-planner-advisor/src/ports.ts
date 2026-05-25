/**
 * Injected ports for the mine-planner advisor.
 */

import type { PlanInput, ShiftPlan } from './types.js';

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface LmbmPlannerPort {
  fetchPlanInput(args: {
    readonly siteId: string;
    readonly planDateISO: string;
  }): Promise<PlanInput>;
  savePlan(args: {
    readonly siteId: string;
    readonly plan: ShiftPlan;
  }): Promise<{ readonly factId: string }>;
}

export const NOOP_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
