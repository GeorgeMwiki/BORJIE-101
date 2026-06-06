/**
 * /api/v1/mining/fleet-ops — REAL fleet TCO + utilization, computed by the
 * `@borjie/fleet-management` package over the tenant's EXISTING mining
 * tables. Distinct from `/mining/fleet` (units / match-factor, prior wave) —
 * that surface does a health/balance roll-up; this one runs the package's
 * genuine cost-of-ownership compute (`computeVehicleTco`,
 * `computeFleetUtilization`).
 *
 * DATA SOURCING (no new tables — computes from real rows):
 *   - vehicles      ← `assets` rows whose `kind` is a road vehicle
 *                     (truck | vehicle | pickup | van). Mapped to the
 *                     package `Vehicle` shape.
 *   - fuel cost     ← `fuel_logs.total_cost_tzs` (minor-units agnostic:
 *                     stored numeric, converted to integer cents 1:1 — the
 *                     package treats the figure as the tenant's reporting
 *                     unit, no currency literal is introduced here).
 *   - maintenance   ← `maintenance_events.cost_tzs` for COMPLETED events.
 *
 * HONESTY (no fabricated engineering figure): the `assets` schema carries
 * NO trip ledger, so the package's distance-dependent outputs
 * (`costPerKmCents`, `distanceKm`, utilization productive-hours) cannot be
 * derived. We pass an empty trips array, so `distanceKm = 0` and
 * `costPerKmCents = 0`, and FLAG that a real trip/odometer source is
 * required for the per-km + utilization figures. We never invent a distance.
 *
 * MONEY NEUTRALITY (CLAUDE.md): no currency literal in any code path. The
 * package sums integer minor-units; the FE renders with
 * `formatCurrency(amount, currencyCode)` using the tenant's reporting
 * currency resolved client-side.
 *
 * RLS: `databaseMiddleware` binds `app.current_tenant_id`; `assets`,
 * `fuel_logs`, `maintenance_events` are FORCE-RLS. Handlers also pass the
 * explicit tenant predicate other mining routes keep (defence in depth).
 */

import { Hono } from 'hono';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';

import {
  assets,
  fuelLogs,
  maintenanceEvents,
} from '@borjie/database';
import {
  createFleetManagement,
  computeVehicleTco,
  type FuelEntry,
  type MaintenanceTask,
  type Vehicle,
} from '@borjie/fleet-management';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-fleet-ops');

/** `assets.kind` values that map to a road vehicle the package understands. */
const VEHICLE_ASSET_KINDS = ['truck', 'vehicle', 'pickup', 'van'] as const;

/**
 * Map an `assets.kind` to the package `VehicleType`. The package's TCO
 * compute does not branch on type, so an unknown kind safely falls back to
 * `truck` (the dominant mining-fleet class) without affecting the figure.
 */
function mapVehicleType(kind: string): Vehicle['type'] {
  switch (kind) {
    case 'pickup':
      return 'pickup';
    case 'van':
      return 'van';
    case 'truck':
      return 'truck';
    default:
      return 'truck';
  }
}

/** Drizzle returns numeric columns as strings; parse to a finite number. */
function toNum(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Convert a stored numeric money figure to integer minor-units (cents). */
function toCents(value: unknown): number {
  return Math.round(toNum(value) * 100);
}

const PeriodQuerySchema = z.object({
  periodStart: z.string().datetime().optional(),
  periodEnd: z.string().datetime().optional(),
  /** Annualised straight-line depreciation per vehicle, in minor-units. */
  annualDepreciationCents: z.coerce.number().int().min(0).max(1_000_000_000).optional(),
});

/** Default reporting window: trailing 90 days ending now. */
function defaultPeriod(): { periodStart: string; periodEnd: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 90 * 24 * 3_600_000);
  return { periodStart: start.toISOString(), periodEnd: end.toISOString() };
}

export const miningFleetOpsRouter = new Hono();
miningFleetOpsRouter.use('*', authMiddleware);
miningFleetOpsRouter.use('*', databaseMiddleware);

// ---------------------------------------------------------------------------
// GET /tco — per-vehicle + fleet-total cost of ownership for the period.
// ---------------------------------------------------------------------------
miningFleetOpsRouter.get('/tco', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) {
    return c.json(
      { success: false as const, error: { code: 'FLEET_OPS_DB_UNAVAILABLE' } },
      503,
    );
  }
  const tenantId = auth.tenantId;

  const parsed = PeriodQuerySchema.safeParse({
    periodStart: c.req.query('periodStart'),
    periodEnd: c.req.query('periodEnd'),
    annualDepreciationCents: c.req.query('annualDepreciationCents'),
  });
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameters' },
      },
      400,
    );
  }
  const fallback = defaultPeriod();
  const periodStart = parsed.data.periodStart ?? fallback.periodStart;
  const periodEnd = parsed.data.periodEnd ?? fallback.periodEnd;
  const annualDepreciationCents = parsed.data.annualDepreciationCents ?? 0;

  try {
    // Construct the fleet-management façade. Stores default to in-memory
    // (unused here — we feed the pure TCO compute directly from real rows),
    // but constructing the façade exercises the real package wiring.
    const fleet = createFleetManagement();

    const vehicleRows = await db
      .select({
        id: assets.id,
        kind: assets.kind,
        make: assets.make,
        model: assets.model,
        year: assets.year,
        status: assets.status,
        currentSiteId: assets.currentSiteId,
        createdAt: assets.createdAt,
        updatedAt: assets.updatedAt,
      })
      .from(assets)
      .where(
        and(
          eq(assets.tenantId, tenantId),
          inArray(assets.kind, [...VEHICLE_ASSET_KINDS]),
        ),
      )
      .limit(500);

    if (vehicleRows.length === 0) {
      return c.json(
        {
          success: true as const,
          data: {
            periodStart,
            periodEnd,
            vehicles: [] as const,
            fleetTotals: {
              vehicleCount: 0,
              fuelCostCents: 0,
              maintenanceCostCents: 0,
              depreciationCents: 0,
              totalCents: 0,
            },
            flags: trustFlags(),
            basis: 'fleet_management.computeVehicleTco' as const,
          },
        },
        200,
      );
    }

    const vehicleIds = vehicleRows.map((r) => String(r.id));

    // Real fuel + maintenance facts for the window, scoped to these vehicles.
    const [fuelRows, maintRows] = await Promise.all([
      db
        .select({
          id: fuelLogs.id,
          assetId: fuelLogs.assetId,
          totalCostTzs: fuelLogs.totalCostTzs,
          litres: fuelLogs.litres,
          fuelKind: fuelLogs.fuelKind,
          logDate: fuelLogs.logDate,
        })
        .from(fuelLogs)
        .where(
          and(
            eq(fuelLogs.tenantId, tenantId),
            inArray(fuelLogs.assetId, vehicleIds),
            gte(fuelLogs.logDate, periodStart.slice(0, 10)),
            lte(fuelLogs.logDate, periodEnd.slice(0, 10)),
          ),
        )
        .limit(5000),
      db
        .select({
          id: maintenanceEvents.id,
          assetId: maintenanceEvents.assetId,
          status: maintenanceEvents.status,
          costTzs: maintenanceEvents.costTzs,
          completedAt: maintenanceEvents.completedAt,
        })
        .from(maintenanceEvents)
        .where(
          and(
            eq(maintenanceEvents.tenantId, tenantId),
            inArray(maintenanceEvents.assetId, vehicleIds),
          ),
        )
        .limit(5000),
    ]);

    // Map DB rows → package input shapes. FuelEntry/MaintenanceTask carry
    // only the fields the TCO compute reads; the rest take safe neutral
    // values (the package filters by vehicleId + period internally).
    const fuelEntries: ReadonlyArray<FuelEntry> = fuelRows.map((f) => ({
      id: String(f.id),
      tenantId,
      vehicleId: String(f.assetId),
      driverId: '',
      fuelType: normalizeFuelType(f.fuelKind),
      litres: toNum(f.litres),
      costCents: toCents(f.totalCostTzs),
      odometerKm: 0,
      vendor: '',
      recordedAt: `${String(f.logDate)}T00:00:00.000Z`,
    }));

    const maintenanceTasks: ReadonlyArray<MaintenanceTask> = maintRows.map((m) => ({
      id: String(m.id),
      tenantId,
      vehicleId: String(m.assetId),
      kind: 'inspection',
      status: m.status === 'completed' ? 'completed' : 'scheduled',
      costCents: toCents(m.costTzs),
      lastCompletedAtDate: m.completedAt
        ? new Date(m.completedAt as unknown as string).toISOString().slice(0, 10)
        : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));

    const vehicles = vehicleRows.map((r) => {
      const vehicle: Vehicle = {
        id: String(r.id),
        tenantId,
        orgId: '',
        plate: '',
        vin: '',
        make: String(r.make ?? ''),
        model: String(r.model ?? ''),
        year: r.year !== null ? Number(r.year) : 0,
        type: mapVehicleType(String(r.kind)),
        fuelType: 'diesel',
        passengerCapacity: 0,
        payloadKg: 0,
        currentOdometerKm: 0,
        status: r.status === 'operational' ? 'active' : 'maintenance',
        createdAt: new Date(r.createdAt as unknown as string).toISOString(),
        updatedAt: new Date(r.updatedAt as unknown as string).toISOString(),
      };

      // REAL package compute. Trips are absent in the schema → empty array,
      // so distanceKm + costPerKmCents are 0 (flagged below), but fuel +
      // maintenance + depreciation are genuine.
      const tco = computeVehicleTco({
        vehicle,
        periodStart,
        periodEnd,
        fuelEntries,
        maintenanceTasks,
        trips: [],
        insuranceCents: 0,
        annualDepreciationCents,
      });

      return {
        vehicleId: tco.vehicleId,
        label:
          [vehicle.make, vehicle.model].filter(Boolean).join(' ').trim() ||
          tco.vehicleId,
        type: vehicle.type,
        siteId: r.currentSiteId ? String(r.currentSiteId) : null,
        fuelCostCents: tco.fuelCostCents,
        maintenanceCostCents: tco.maintenanceCostCents,
        depreciationCents: tco.depreciationCents,
        totalCents: tco.totalCents,
        distanceKm: tco.distanceKm,
        costPerKmCents: tco.costPerKmCents,
      };
    });

    const fleetTotals = vehicles.reduce(
      (acc, v) => ({
        vehicleCount: acc.vehicleCount + 1,
        fuelCostCents: acc.fuelCostCents + v.fuelCostCents,
        maintenanceCostCents: acc.maintenanceCostCents + v.maintenanceCostCents,
        depreciationCents: acc.depreciationCents + v.depreciationCents,
        totalCents: acc.totalCents + v.totalCents,
      }),
      {
        vehicleCount: 0,
        fuelCostCents: 0,
        maintenanceCostCents: 0,
        depreciationCents: 0,
        totalCents: 0,
      },
    );

    return c.json(
      {
        success: true as const,
        data: {
          periodStart,
          periodEnd,
          vehicles,
          fleetTotals,
          flags: trustFlags(),
          basis: 'fleet_management.computeVehicleTco' as const,
          provider: fleet.routing.name,
        },
      },
      200,
    );
  } catch (err) {
    moduleLogger.error({ err, tenantId }, 'fleet_ops_tco_failed');
    return c.json(
      { success: false as const, error: { code: 'FLEET_OPS_TCO_FAILED' } },
      500,
    );
  }
});

/** Honesty flags surfaced on every TCO payload. */
function trustFlags(): ReadonlyArray<string> {
  return [
    'FLAG: distanceKm and costPerKmCents are 0 because the assets schema ' +
      'carries no trip/odometer ledger. Stand up a trips source to unlock ' +
      'the per-km figure and fleet utilization — no distance is invented.',
    'FLAG: depreciation is 0 unless annualDepreciationCents is supplied; ' +
      'insurance + fines are not modelled in the mining asset tables.',
    'FLAG: vehicles are assets with kind in ' +
      `[${VEHICLE_ASSET_KINDS.join(', ')}].`,
  ];
}

/** Map `fuel_logs.fuel_kind` to the package FuelType (best-effort). */
function normalizeFuelType(kind: unknown): FuelEntry['fuelType'] {
  const k = String(kind ?? 'diesel');
  if (k === 'petrol') return 'petrol';
  if (k === 'diesel') return 'diesel';
  return 'diesel';
}

export default miningFleetOpsRouter;
