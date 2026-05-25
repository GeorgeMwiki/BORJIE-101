/**
 * Extracts the cron specification from an AOP. Returns `null` if the trigger
 * is not a cron trigger (event-driven or manual AOPs have no cron).
 */

import type { AOP, CronSpec } from '../types.js';

export function compileToCron(ast: AOP): CronSpec | null {
  if (ast.trigger.kind !== 'cron') return null;
  return {
    schedule: ast.trigger.schedule,
    timezone: ast.trigger.timezone,
    aopName: ast.name,
  };
}
