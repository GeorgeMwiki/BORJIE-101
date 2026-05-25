/**
 * MaintenanceQueueSim — M/M/c queue with vendor no-show.
 *
 * Tickets arrive as a Poisson process. Each vendor independently
 * accepts (with prob 1 - noShow). Service times exponential.
 * Computes expected mean wait + tail wait per ticket.
 */

import { mulberry32, samplePoisson } from '../../util/rng.js';

export interface MaintenanceTicket {
  readonly id: string;
  readonly arrivedAtMs: number;
  readonly servedAtMs: number | null;
  readonly noShowCount: number;
}

export interface MaintenanceQueueInputs {
  readonly arrivalRatePerDay: number;
  readonly serviceRatePerDay: number;
  readonly vendorCount: number;
  readonly vendorNoShowRate: number;
  readonly horizonDays: number;
  readonly seed: number;
}

export interface MaintenanceQueueResult {
  readonly tickets: ReadonlyArray<MaintenanceTicket>;
  readonly meanWaitDays: number;
  readonly p95WaitDays: number;
  readonly serviceLevel: number; // share served before horizon
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function simulateMaintenanceQueue(
  inputs: MaintenanceQueueInputs,
): MaintenanceQueueResult {
  const rng = mulberry32(inputs.seed);
  const tickets: MaintenanceTicket[] = [];

  // Generate arrivals day-by-day
  for (let day = 0; day < inputs.horizonDays; day += 1) {
    const arrivals = samplePoisson(rng, inputs.arrivalRatePerDay);
    for (let i = 0; i < arrivals; i += 1) {
      const offset = rng() * DAY_MS;
      tickets.push({
        id: `t-${day}-${i}`,
        arrivedAtMs: day * DAY_MS + offset,
        servedAtMs: null,
        noShowCount: 0,
      });
    }
  }

  tickets.sort((a, b) => a.arrivedAtMs - b.arrivedAtMs);

  // Vendor calendars (next-available time per vendor)
  const vendorAvail: number[] = Array(Math.max(1, inputs.vendorCount)).fill(0);
  const meanServiceDays = 1 / Math.max(1e-6, inputs.serviceRatePerDay);

  const served: MaintenanceTicket[] = [];
  for (const tk of tickets) {
    let assigned = false;
    let noShows = 0;
    let attemptStart = tk.arrivedAtMs;
    while (!assigned) {
      // Choose earliest-available vendor
      let bestIdx = 0;
      for (let i = 1; i < vendorAvail.length; i += 1) {
        if ((vendorAvail[i] ?? 0) < (vendorAvail[bestIdx] ?? 0)) bestIdx = i;
      }
      const earliest = Math.max(vendorAvail[bestIdx] ?? 0, attemptStart);
      // No-show check
      if (rng() < inputs.vendorNoShowRate) {
        noShows += 1;
        // Vendor blocked but didn't actually serve; ticket bumps to next day
        vendorAvail[bestIdx] = earliest + DAY_MS;
        attemptStart = earliest + DAY_MS;
        if (noShows > 5) break; // safety
        continue;
      }
      // Service time exponential
      const u = Math.max(rng(), 1e-9);
      const svcMs = -Math.log(u) * meanServiceDays * DAY_MS;
      const finish = earliest + svcMs;
      vendorAvail[bestIdx] = finish;
      served.push({
        id: tk.id,
        arrivedAtMs: tk.arrivedAtMs,
        servedAtMs: finish,
        noShowCount: noShows,
      });
      assigned = true;
    }
  }

  const waits = served
    .filter((t): t is MaintenanceTicket & { servedAtMs: number } => t.servedAtMs !== null)
    .map((t) => (t.servedAtMs - t.arrivedAtMs) / DAY_MS);
  waits.sort((a, b) => a - b);
  const meanWait =
    waits.reduce((s, w) => s + w, 0) / Math.max(1, waits.length);
  const p95 = waits[Math.floor(waits.length * 0.95)] ?? meanWait;
  const horizonMs = inputs.horizonDays * DAY_MS;
  const completed = served.filter(
    (t) => t.servedAtMs !== null && t.servedAtMs <= horizonMs,
  ).length;
  const serviceLevel = served.length === 0 ? 1 : completed / served.length;

  return {
    tickets: served,
    meanWaitDays: meanWait,
    p95WaitDays: p95,
    serviceLevel,
  };
}
