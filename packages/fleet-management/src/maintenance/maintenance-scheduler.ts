/**
 * Maintenance scheduler.
 *
 *   - `seedMaintenanceTasks(vehicle, store)` — first-run helper that
 *     creates the standard task rows for a vehicle's fuel type.
 *   - `recordCompletion(taskId, completion, store)` — close one task
 *     and roll the next-due window forward by the standard interval.
 *   - `nextDueTasks(vehicleId, asOf, store)` — what is due in the
 *     scheduled / due / overdue states ordered by urgency.
 *   - `predictNextDueDate(...)` — extrapolates a date from the rolling
 *     daily km rate so dashboards can warn the owner before the actual
 *     odometer crosses the threshold.
 */

import { z } from 'zod';
import {
  type MaintenanceTask,
  type MaintenanceKind,
  type MaintenanceStatus,
  type MaintenanceCompletion,
  type Vehicle,
  type Kilometres,
  MAINTENANCE_KINDS,
} from '../types.js';
import { CrossTenantError } from '../vehicles/vehicle-registry.js';
import { defaultIntervalsFor, intervalFor } from './intervals.js';

export class MaintenanceTaskNotFoundError extends Error {
  constructor(id: string) {
    super(`MaintenanceTask not found: ${id}`);
    this.name = 'MaintenanceTaskNotFoundError';
  }
}

export interface MaintenanceStore {
  get(id: string): Promise<MaintenanceTask | null>;
  listByVehicle(tenantId: string, vehicleId: string): Promise<ReadonlyArray<MaintenanceTask>>;
  save(task: MaintenanceTask): Promise<MaintenanceTask>;
  delete(id: string): Promise<void>;
}

export const RecordCompletionSchema = z.object({
  completedAtKm: z.number().min(0),
  completedAtDate: z.string().min(8),
  vendor: z.string().min(1),
  costCents: z.number().int().min(0),
  notes: z.string().max(1000).optional(),
});

function nowIso(): string {
  return new Date().toISOString();
}

function daysFromNow(days: number, base: Date = new Date()): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let _taskCounter = 0;
function generateTaskId(vehicleId: string, kind: MaintenanceKind): string {
  _taskCounter += 1;
  const rand = Math.random().toString(36).slice(2, 6);
  return `mt_${vehicleId.slice(-6)}_${kind.slice(0, 3)}_${Date.now().toString(36)}_${_taskCounter}_${rand}`;
}

/**
 * Create the standard service rows for a vehicle. Idempotent —
 * existing rows are NOT overwritten.
 */
export async function seedMaintenanceTasks(
  vehicle: Vehicle,
  store: MaintenanceStore,
  options?: { readonly nowIso?: string },
): Promise<ReadonlyArray<MaintenanceTask>> {
  const existing = await store.listByVehicle(vehicle.tenantId, vehicle.id);
  const existingKinds = new Set(existing.map((t) => t.kind));
  const ts = options?.nowIso ?? nowIso();
  const intervals = defaultIntervalsFor(vehicle.fuelType);
  const created: MaintenanceTask[] = [];
  for (const interval of intervals) {
    if (existingKinds.has(interval.kind)) continue;
    const due: MaintenanceTask = {
      id: generateTaskId(vehicle.id, interval.kind),
      tenantId: vehicle.tenantId,
      vehicleId: vehicle.id,
      kind: interval.kind,
      nextDueAtKm: vehicle.currentOdometerKm + interval.intervalKm,
      nextDueAtDate: daysFromNow(interval.intervalDays, new Date(ts)),
      status: 'scheduled',
      createdAt: ts,
      updatedAt: ts,
    };
    const saved = await store.save(due);
    created.push(saved);
  }
  return created;
}

export async function recordCompletion(
  taskId: string,
  tenantId: string,
  completion: MaintenanceCompletion,
  store: MaintenanceStore,
  fuelTypeForRoll?: import('../types.js').FuelType,
): Promise<MaintenanceTask> {
  const parsed = RecordCompletionSchema.parse(completion);
  const task = await store.get(taskId);
  if (!task) throw new MaintenanceTaskNotFoundError(taskId);
  if (task.tenantId !== tenantId) throw new CrossTenantError('maintenance_task', taskId);

  // Roll the next-due window forward.
  let nextKm: Kilometres | undefined;
  let nextDate: string | undefined;
  if (fuelTypeForRoll) {
    const interval = intervalFor(fuelTypeForRoll, task.kind);
    if (interval) {
      nextKm = parsed.completedAtKm + interval.intervalKm;
      nextDate = daysFromNow(interval.intervalDays, new Date(parsed.completedAtDate));
    }
  }

  const next: MaintenanceTask = {
    ...task,
    lastCompletedAtKm: parsed.completedAtKm,
    lastCompletedAtDate: parsed.completedAtDate,
    vendor: parsed.vendor,
    costCents: parsed.costCents,
    status: 'completed',
    ...(parsed.notes ? { notes: parsed.notes } : {}),
    ...(nextKm !== undefined ? { nextDueAtKm: nextKm } : {}),
    ...(nextDate ? { nextDueAtDate: nextDate } : {}),
    updatedAt: nowIso(),
  };
  return store.save(next);
}

/** Tasks the dashboard should highlight ordered by urgency. */
export async function nextDueTasks(
  tenantId: string,
  vehicleId: string,
  currentOdometerKm: Kilometres,
  asOfIso: string,
  store: MaintenanceStore,
  options?: { readonly limit?: number },
): Promise<ReadonlyArray<MaintenanceTask>> {
  const all = await store.listByVehicle(tenantId, vehicleId);
  const live = all.filter((t) => t.status !== 'cancelled');
  const today = asOfIso.slice(0, 10);

  const withStatus = live.map((t) => {
    let status: MaintenanceStatus = t.status;
    if (t.status !== 'completed') {
      const overdueKm = t.nextDueAtKm !== undefined && currentOdometerKm > t.nextDueAtKm;
      const overdueDate = t.nextDueAtDate !== undefined && today > t.nextDueAtDate;
      const dueKm = t.nextDueAtKm !== undefined && currentOdometerKm >= t.nextDueAtKm * 0.95;
      const dueDate = t.nextDueAtDate !== undefined && today >= dateMinusDays(t.nextDueAtDate, 14);
      if (overdueKm || overdueDate) status = 'overdue';
      else if (dueKm || dueDate) status = 'due';
      else status = 'scheduled';
    }
    return { ...t, status };
  });

  const rank = (s: MaintenanceStatus): number =>
    s === 'overdue' ? 0 : s === 'due' ? 1 : s === 'scheduled' ? 2 : 3;
  const sorted = withStatus
    .filter((t) => t.status !== 'completed')
    .sort((a, b) => {
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      const ka = a.nextDueAtKm ?? Number.MAX_SAFE_INTEGER;
      const kb = b.nextDueAtKm ?? Number.MAX_SAFE_INTEGER;
      return ka - kb;
    });
  return options?.limit ? sorted.slice(0, options.limit) : sorted;
}

function dateMinusDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Predict the calendar date when the vehicle will hit `nextDueAtKm`
 * given the rolling daily km rate. Returns null if the input gives no
 * useful signal (zero distance / zero days).
 */
export function predictNextDueDate(input: {
  readonly currentOdometerKm: Kilometres;
  readonly nextDueAtKm: Kilometres;
  readonly distanceLastNDaysKm: Kilometres;
  readonly nDays: number;
  readonly asOfIso: string;
}): string | null {
  if (input.distanceLastNDaysKm <= 0 || input.nDays <= 0) return null;
  const dailyRate = input.distanceLastNDaysKm / input.nDays;
  if (dailyRate <= 0) return null;
  const remainingKm = input.nextDueAtKm - input.currentOdometerKm;
  if (remainingKm <= 0) return input.asOfIso.slice(0, 10);
  const daysAhead = Math.ceil(remainingKm / dailyRate);
  const d = new Date(input.asOfIso);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

export function createInMemoryMaintenanceStore(): MaintenanceStore {
  const byId = new Map<string, MaintenanceTask>();
  return {
    async get(id) {
      return byId.get(id) ?? null;
    },
    async listByVehicle(tenantId, vehicleId) {
      return [...byId.values()].filter(
        (t) => t.tenantId === tenantId && t.vehicleId === vehicleId,
      );
    },
    async save(task) {
      byId.set(task.id, task);
      return task;
    },
    async delete(id) {
      byId.delete(id);
    },
  };
}

export { MAINTENANCE_KINDS };
