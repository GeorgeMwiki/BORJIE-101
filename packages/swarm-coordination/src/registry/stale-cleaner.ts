/**
 * Stale-agent cleaner.
 *
 * Wave 18HH. A cron-driven worker that scans `active_agents` for rows
 * whose heartbeat is older than the stale threshold and flips them to
 * `crashed`. Pure function — caller decides scheduling.
 *
 * Returns the IDs of cleared agents so the wave-resilience-manager
 * (Wave 18DD) can enqueue revival attempts. No revival is initiated
 * from inside this module; the caller wires that side-effect.
 */

import { SWARM_CONSTANTS } from '../types.js';
import type { ActiveAgentsRepository } from '../types.js';

export interface StaleCleanerResult {
  readonly clearedIds: ReadonlyArray<string>;
  readonly scannedCount: number;
}

export interface StaleCleanerDeps {
  readonly repository: ActiveAgentsRepository;
  readonly now: () => Date;
  /** Override the default 2-minute stale threshold (ms). */
  readonly staleThresholdMs?: number;
}

export async function runStaleCleaner(
  deps: StaleCleanerDeps,
): Promise<StaleCleanerResult> {
  const threshold =
    deps.staleThresholdMs ?? SWARM_CONSTANTS.STALE_THRESHOLD_MS;
  const cutoff = new Date(deps.now().getTime() - threshold);
  const stale = await deps.repository.listStaleRunning(cutoff);

  const clearedIds: string[] = [];
  for (const row of stale) {
    await deps.repository.deregister(row.tenantId, row.id, 'crashed');
    clearedIds.push(row.id);
  }

  return Object.freeze({
    clearedIds,
    scannedCount: stale.length,
  });
}
