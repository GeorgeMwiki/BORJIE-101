/**
 * Driver scorecard — safety score, fuel economy, on-time arrival,
 * jobs completed. Pure function; takes events + trips + fuel entries
 * and produces a single envelope per (driver, period).
 *
 * Safety score formula:
 *   start at 100
 *   - speeding event: -5 (info) / -10 (warn) / -25 (critical)
 *   - harsh braking: -3 / -6 / -15
 *   - collision: -50 (no severity gradient — always severe)
 *   floor at 0.
 */

import {
  type DriverScorecard,
  type IsoDate,
  type Trip,
  type FuelEntry,
  type TelematicsEvent,
  type SafetyEvent,
  type Kilometres,
} from '../types.js';
import { computeFuelEconomy } from '../fuel/fuel-tracker.js';

export interface DriverScorecardInputs {
  readonly driverId: string;
  readonly periodStart: IsoDate;
  readonly periodEnd: IsoDate;
  readonly trips: ReadonlyArray<Trip>;
  readonly fuelEntries: ReadonlyArray<FuelEntry>;
  readonly safetyEvents: ReadonlyArray<SafetyEvent | TelematicsEvent>;
  readonly onTimeWindowMinutes?: number;
  readonly scheduledArrivals?: ReadonlyArray<{ readonly tripId: string; readonly scheduledAt: string }>;
}

function classifyTelematicsKind(kind: TelematicsEvent['kind']): 'speeding' | 'harsh_braking' | 'collision' | 'idle' | 'other' {
  if (kind === 'speeding') return 'speeding';
  if (kind === 'harsh_braking') return 'harsh_braking';
  if (kind === 'collision') return 'collision';
  if (kind === 'idle') return 'idle';
  return 'other';
}

function eventBucket(e: SafetyEvent | TelematicsEvent): { readonly kind: 'speeding' | 'harsh_braking' | 'collision' | 'idle' | 'other'; readonly severity: 'info' | 'warn' | 'critical' } {
  if ('severity' in e) {
    const k = e.kind === 'geofence_exit'
      ? 'other'
      : e.kind === 'collision'
        ? 'collision'
        : e.kind;
    return { kind: k as 'speeding' | 'harsh_braking' | 'collision' | 'idle' | 'other', severity: e.severity };
  }
  return { kind: classifyTelematicsKind(e.kind), severity: 'warn' };
}

export function computeDriverScorecard(inputs: DriverScorecardInputs): DriverScorecard {
  const trips = inputs.trips.filter(
    (t) => t.driverId === inputs.driverId
      && t.startedAt >= inputs.periodStart
      && t.startedAt <= inputs.periodEnd,
  );
  const distanceKm: Kilometres = trips
    .filter((t) => t.status === 'closed')
    .reduce((s, t) => s + (t.distanceKm ?? 0), 0);

  const fuelEntries = inputs.fuelEntries.filter(
    (e) => e.driverId === inputs.driverId
      && e.recordedAt >= inputs.periodStart
      && e.recordedAt <= inputs.periodEnd,
  );
  let economy = 0;
  // Compute per-vehicle and average across vehicles the driver used
  const vehicleIds = [...new Set(fuelEntries.map((e) => e.vehicleId))];
  const economies = vehicleIds.map((vid) => computeFuelEconomy(fuelEntries, vid).litresPer100Km).filter((n) => n > 0);
  if (economies.length > 0) {
    economy = economies.reduce((s, n) => s + n, 0) / economies.length;
  }

  let speeding = 0;
  let harshBraking = 0;
  let collisions = 0;
  let safetyDelta = 0;
  for (const e of inputs.safetyEvents) {
    const ts = ('occurredAt' in e ? e.occurredAt : (e as SafetyEvent).occurredAt);
    if (!ts || ts < inputs.periodStart || ts > inputs.periodEnd) continue;
    const b = eventBucket(e);
    if (b.kind === 'speeding') {
      speeding += 1;
      safetyDelta -= b.severity === 'critical' ? 25 : b.severity === 'warn' ? 10 : 5;
    } else if (b.kind === 'harsh_braking') {
      harshBraking += 1;
      safetyDelta -= b.severity === 'critical' ? 15 : b.severity === 'warn' ? 6 : 3;
    } else if (b.kind === 'collision') {
      collisions += 1;
      safetyDelta -= 50;
    }
  }
  const safetyScore = Math.max(0, Math.min(100, 100 + safetyDelta));

  let onTimeArrivalPct = 0;
  if (inputs.scheduledArrivals?.length) {
    const window = inputs.onTimeWindowMinutes ?? 10;
    const matched = inputs.scheduledArrivals.filter((s) => {
      const trip = trips.find((t) => t.id === s.tripId);
      if (!trip?.endedAt) return false;
      const scheduledMs = Date.parse(s.scheduledAt);
      const actualMs = Date.parse(trip.endedAt);
      if (!Number.isFinite(scheduledMs) || !Number.isFinite(actualMs)) return false;
      return Math.abs(actualMs - scheduledMs) <= window * 60_000;
    });
    onTimeArrivalPct = inputs.scheduledArrivals.length > 0
      ? (matched.length / inputs.scheduledArrivals.length) * 100
      : 0;
  }

  // Idle hours from telematics events
  const idleHours = inputs.safetyEvents.filter((e) => {
    const k = eventBucket(e).kind;
    return k === 'idle';
  }).length * 0.25; // assume each idle event is a 15-min report

  return {
    driverId: inputs.driverId,
    periodStart: inputs.periodStart,
    periodEnd: inputs.periodEnd,
    safetyScore,
    fuelEconomyLPer100Km: economy,
    onTimeArrivalPct,
    jobsCompleted: trips.filter((t) => t.status === 'closed').length,
    distanceKm,
    idleHours,
    events: { speeding, harshBraking, collisions },
  };
}
