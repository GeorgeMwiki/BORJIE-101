/**
 * ETA estimation.
 *
 * Combines a base lead time from the logistics port with disruption
 * uplift + tonnage uplift (large shipments take longer to clear at
 * port). Returns a deterministic uncertainty band.
 */

import { RouteUnavailableError } from './errors.js';
import type { LogisticsPort } from './ports.js';
import {
  etaEstimateInputSchema,
  type EtaEstimate,
  type EtaEstimateInput,
} from './types.js';

const TONNAGE_UPLIFT_THRESHOLDS: ReadonlyArray<{ max: number; uplift: number }> = [
  { max: 100, uplift: 0 },
  { max: 1_000, uplift: 1 },
  { max: 10_000, uplift: 3 },
  { max: Infinity, uplift: 7 },
];

const SEVERITY_UPLIFT_DAYS = {
  low: 1,
  medium: 3,
  high: 7,
} as const;

const SEVERITY_UNCERTAINTY = {
  low: 0.1,
  medium: 0.2,
  high: 0.4,
} as const;

export async function estimateEtaFor(
  rawInput: EtaEstimateInput,
  logistics: LogisticsPort,
): Promise<EtaEstimate> {
  const input = etaEstimateInputSchema.parse(rawInput);
  const route = await logistics.fetchRoute({
    originMineId: input.originMineId,
    destPort: input.destPort,
  });

  if (!route) {
    throw new RouteUnavailableError(
      input.originMineId,
      input.destPort,
      'no waypoints registered',
    );
  }

  if (route.waypoints.length === 0) {
    throw new RouteUnavailableError(
      input.originMineId,
      input.destPort,
      'empty waypoint set',
    );
  }

  const tonnageUplift =
    TONNAGE_UPLIFT_THRESHOLDS.find((t) => input.tonnage <= t.max)?.uplift ?? 7;

  const disruptionUplift = route.disruptions.reduce(
    (sum, d) => sum + SEVERITY_UPLIFT_DAYS[d.severity],
    0,
  );

  const days = route.baseDays + tonnageUplift + disruptionUplift;

  // Uncertainty accumulates from disruption severities; baseline 5%.
  const baseUncertainty = 0.05;
  const disruptionUncertainty = route.disruptions.reduce(
    (acc, d) => acc + SEVERITY_UNCERTAINTY[d.severity],
    0,
  );
  const uncertainty = Math.min(
    1,
    Math.round((baseUncertainty + disruptionUncertainty) * 100) / 100,
  );

  return {
    originMineId: input.originMineId,
    destPort: input.destPort,
    days,
    uncertainty,
    route: [...route.waypoints],
    disruptionFlags: route.disruptions.map((d) => ({
      code: d.code,
      label: d.label,
      severity: d.severity,
    })),
  };
}
