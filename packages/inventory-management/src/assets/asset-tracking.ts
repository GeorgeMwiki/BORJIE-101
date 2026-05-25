/**
 * Asset lifecycle — serialised tracking for `isAsset=true` SKUs.
 *
 * Estate orgs install appliances (fridges, water heaters, HVAC, smoke
 * detectors, security cameras) into individual units and need a
 * lifelong record of:
 *   - which serial sits in which unit,
 *   - when it was installed and by whom,
 *   - every maintenance event,
 *   - warranty horizon,
 *   - decommission with reason (replacement / failure / theft).
 *
 * Two collections — `AssetSerial[]` (the current state per serial) +
 * `AssetEvent[]` (the immutable event log per serial). The serial
 * row is a folded projection of its events.
 */

import { z } from 'zod';
import {
  err,
  ok,
  type AssetEvent,
  type AssetSerial,
  type AssetSerialId,
  type AssetStatus,
  type LocationId,
  type MovementId,
  type Result,
  type SkuId,
  type StockMovement,
  type TenantId,
  type UnitId,
} from '../types.js';
import { appendMovement } from '../movements/stock-movements.js';

export const AssetRegisterDraftSchema = z.object({
  skuId: z.string().min(1),
  serialNumber: z.string().min(1).max(120),
  currentLocationId: z.string(),
  purchaseDate: z.string().optional(),
  purchaseCostCents: z.number().int().nonnegative().optional(),
  warrantyExpiresAt: z.string().optional(),
  photos: z.array(z.string()).optional(),
  notes: z.string().max(2000).optional(),
});

export type AssetRegisterDraft = z.infer<typeof AssetRegisterDraftSchema>;

/**
 * Register a new asset serial (e.g. after a goods-receipt of an
 * appliance). The serial starts `in_stock` at the given location.
 */
export function registerAsset(
  serials: ReadonlyArray<AssetSerial>,
  tenantId: TenantId,
  draft: AssetRegisterDraft,
  idGen: () => AssetSerialId,
): Result<{ readonly serial: AssetSerial; readonly serials: ReadonlyArray<AssetSerial> }, 'BAD_REQUEST' | 'DUPLICATE_SERIAL'> {
  const parsed = AssetRegisterDraftSchema.safeParse(draft);
  if (!parsed.success) return err('BAD_REQUEST', parsed.error.message);
  const dup = serials.find(
    (s) => s.tenantId === tenantId && s.skuId === parsed.data.skuId && s.serialNumber === parsed.data.serialNumber,
  );
  if (dup) {
    return err('DUPLICATE_SERIAL', `serial ${parsed.data.serialNumber} already registered for SKU ${parsed.data.skuId}`);
  }
  const serial: AssetSerial = {
    id: idGen(),
    tenantId,
    skuId: parsed.data.skuId,
    serialNumber: parsed.data.serialNumber,
    status: 'in_stock',
    currentLocationId: parsed.data.currentLocationId,
    installedInUnitId: null,
    ...(parsed.data.purchaseDate !== undefined && { purchaseDate: parsed.data.purchaseDate }),
    ...(parsed.data.purchaseCostCents !== undefined && { purchaseCostCents: parsed.data.purchaseCostCents }),
    ...(parsed.data.warrantyExpiresAt !== undefined && { warrantyExpiresAt: parsed.data.warrantyExpiresAt }),
    ...(parsed.data.photos !== undefined && { photos: parsed.data.photos }),
    ...(parsed.data.notes !== undefined && { notes: parsed.data.notes }),
  };
  return ok({ serial, serials: [...serials, serial] });
}

export const InstallAssetSchema = z.object({
  serialNumber: z.string().min(1),
  unitId: z.string().min(1),
  unitLocationId: z.string().min(1),
  installedByUserId: z.string().optional(),
  photos: z.array(z.string()).optional(),
  notes: z.string().max(2000).optional(),
});

export type InstallAssetInput = z.infer<typeof InstallAssetSchema>;

export interface InstallResult {
  readonly serial: AssetSerial;
  readonly serials: ReadonlyArray<AssetSerial>;
  readonly event: AssetEvent;
  readonly events: ReadonlyArray<AssetEvent>;
  readonly movement: StockMovement;
  readonly log: ReadonlyArray<StockMovement>;
}

/**
 * Install a serialised asset into a unit. Emits THREE artefacts:
 *
 *  1. updated `AssetSerial` row (status → 'installed', installedInUnitId set),
 *  2. `AssetEvent` of type 'installed' for the per-asset history,
 *  3. `StockMovement` of reason 'install' so warehouse stock decrements
 *     and the unit's stock-on-hand increments by 1.
 *
 * This is the single entry point for "install fridge in unit" — keeps
 * the warehouse balance, the unit's appliance inventory, and the
 * asset history all in sync atomically.
 */
export function installAsset(
  serials: ReadonlyArray<AssetSerial>,
  events: ReadonlyArray<AssetEvent>,
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  input: InstallAssetInput,
  idGen: { readonly event: () => string; readonly movement: () => MovementId },
  now: string,
): Result<InstallResult, 'BAD_REQUEST' | 'NOT_FOUND' | 'INVALID_STATUS'> {
  const parsed = InstallAssetSchema.safeParse(input);
  if (!parsed.success) return err('BAD_REQUEST', parsed.error.message);
  const idx = serials.findIndex(
    (s) => s.tenantId === tenantId && s.serialNumber === parsed.data.serialNumber,
  );
  if (idx < 0) return err('NOT_FOUND', `serial ${parsed.data.serialNumber} not registered`);
  const current = serials[idx]!;
  if (current.status !== 'in_stock' && current.status !== 'in_repair') {
    return err('INVALID_STATUS', `cannot install — serial status is ${current.status}`);
  }
  if (!current.currentLocationId) {
    return err('INVALID_STATUS', 'serial has no source location');
  }
  const updated: AssetSerial = {
    ...current,
    status: 'installed',
    currentLocationId: parsed.data.unitLocationId,
    installedInUnitId: parsed.data.unitId,
    installedAt: now,
    ...(parsed.data.installedByUserId !== undefined && { installedByUserId: parsed.data.installedByUserId }),
    ...(parsed.data.photos !== undefined && { photos: parsed.data.photos }),
  };
  const nextSerials = [...serials.slice(0, idx), updated, ...serials.slice(idx + 1)];
  const event: AssetEvent = {
    id: idGen.event(),
    assetSerialId: current.id,
    eventType: 'installed',
    occurredAt: now,
    unitId: parsed.data.unitId,
    ...(parsed.data.installedByUserId !== undefined && { actorUserId: parsed.data.installedByUserId }),
    ...(parsed.data.notes !== undefined && { notes: parsed.data.notes }),
  };
  const moveResult = appendMovement(
    log,
    tenantId,
    {
      skuId: current.skuId,
      fromLocationId: current.currentLocationId,
      toLocationId: parsed.data.unitLocationId,
      quantity: 1,
      reason: 'install',
      assetSerialId: current.id,
      ...(parsed.data.installedByUserId !== undefined && { actorUserId: parsed.data.installedByUserId }),
      reference: `unit:${parsed.data.unitId}`,
    },
    idGen.movement,
    now,
  );
  if (!moveResult.ok) return err('BAD_REQUEST', moveResult.error.message);
  return ok({
    serial: updated,
    serials: nextSerials,
    event,
    events: [...events, event],
    movement: moveResult.value.movement,
    log: moveResult.value.log,
  });
}

export const MaintenanceLogSchema = z.object({
  serialNumber: z.string().min(1),
  reference: z.string().max(200).optional(),
  actorUserId: z.string().optional(),
  notes: z.string().max(2000).optional(),
  movedToRepair: z.boolean().optional(),
});

export type MaintenanceLogInput = z.infer<typeof MaintenanceLogSchema>;

/**
 * Append a maintenance event to an asset's history. Optionally flips
 * status to 'in_repair' (e.g. when sent off-site for service).
 */
export function logAssetMaintenance(
  serials: ReadonlyArray<AssetSerial>,
  events: ReadonlyArray<AssetEvent>,
  tenantId: TenantId,
  input: MaintenanceLogInput,
  idGen: () => string,
  now: string,
): Result<{ readonly serial: AssetSerial; readonly serials: ReadonlyArray<AssetSerial>; readonly event: AssetEvent; readonly events: ReadonlyArray<AssetEvent> }, 'NOT_FOUND' | 'BAD_REQUEST'> {
  const parsed = MaintenanceLogSchema.safeParse(input);
  if (!parsed.success) return err('BAD_REQUEST', parsed.error.message);
  const idx = serials.findIndex(
    (s) => s.tenantId === tenantId && s.serialNumber === parsed.data.serialNumber,
  );
  if (idx < 0) return err('NOT_FOUND', `serial ${parsed.data.serialNumber} not found`);
  const current = serials[idx]!;
  const event: AssetEvent = {
    id: idGen(),
    assetSerialId: current.id,
    eventType: 'maintenance',
    occurredAt: now,
    ...(parsed.data.actorUserId !== undefined && { actorUserId: parsed.data.actorUserId }),
    ...(parsed.data.reference !== undefined && { reference: parsed.data.reference }),
    ...(parsed.data.notes !== undefined && { notes: parsed.data.notes }),
  };
  const updated: AssetSerial = parsed.data.movedToRepair
    ? { ...current, status: 'in_repair' }
    : current;
  const nextSerials = parsed.data.movedToRepair
    ? [...serials.slice(0, idx), updated, ...serials.slice(idx + 1)]
    : serials;
  return ok({ serial: updated, serials: nextSerials, event, events: [...events, event] });
}

export const RemoveAssetSchema = z.object({
  serialNumber: z.string().min(1),
  reason: z.enum(['replacement', 'failure', 'theft', 'transfer', 'decommission']),
  destinationLocationId: z.string().optional(),
  actorUserId: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

export type RemoveAssetInput = z.infer<typeof RemoveAssetSchema>;

export interface RemoveResult {
  readonly serial: AssetSerial;
  readonly serials: ReadonlyArray<AssetSerial>;
  readonly event: AssetEvent;
  readonly events: ReadonlyArray<AssetEvent>;
  readonly movement: StockMovement | null;
  readonly log: ReadonlyArray<StockMovement>;
}

/**
 * Remove an asset from a unit. The destination depends on the reason:
 *   - replacement, transfer → moves back to warehouse / destination location,
 *   - failure → status 'in_repair', stays at unit until shipped,
 *   - decommission → status 'decommissioned', no further movements,
 *   - theft → status 'lost', stock-loss movement emitted.
 */
export function removeAsset(
  serials: ReadonlyArray<AssetSerial>,
  events: ReadonlyArray<AssetEvent>,
  log: ReadonlyArray<StockMovement>,
  tenantId: TenantId,
  input: RemoveAssetInput,
  idGen: { readonly event: () => string; readonly movement: () => MovementId },
  now: string,
): Result<RemoveResult, 'BAD_REQUEST' | 'NOT_FOUND' | 'INVALID_STATUS'> {
  const parsed = RemoveAssetSchema.safeParse(input);
  if (!parsed.success) return err('BAD_REQUEST', parsed.error.message);
  const idx = serials.findIndex(
    (s) => s.tenantId === tenantId && s.serialNumber === parsed.data.serialNumber,
  );
  if (idx < 0) return err('NOT_FOUND', `serial ${parsed.data.serialNumber} not found`);
  const current = serials[idx]!;
  if (current.status !== 'installed' && current.status !== 'in_repair') {
    return err('INVALID_STATUS', `cannot remove — status is ${current.status}`);
  }
  let nextStatus: AssetStatus;
  let movementReason: 'transfer' | 'uninstall' | 'loss' | null;
  let destination: LocationId | null;
  switch (parsed.data.reason) {
    case 'replacement':
    case 'transfer':
      nextStatus = 'in_stock';
      movementReason = 'transfer';
      destination = parsed.data.destinationLocationId ?? null;
      if (!destination) return err('BAD_REQUEST', 'transfer requires destinationLocationId');
      break;
    case 'failure':
      nextStatus = 'in_repair';
      movementReason = 'uninstall';
      destination = parsed.data.destinationLocationId ?? current.currentLocationId;
      break;
    case 'decommission':
      nextStatus = 'decommissioned';
      movementReason = 'uninstall';
      destination = parsed.data.destinationLocationId ?? null;
      break;
    case 'theft':
      nextStatus = 'lost';
      movementReason = 'loss';
      destination = null;
      break;
  }
  const updated: AssetSerial = {
    ...current,
    status: nextStatus,
    currentLocationId: destination,
    installedInUnitId: null,
    ...(parsed.data.notes !== undefined && { notes: parsed.data.notes }),
  };
  const nextSerials = [...serials.slice(0, idx), updated, ...serials.slice(idx + 1)];
  const event: AssetEvent = {
    id: idGen.event(),
    assetSerialId: current.id,
    eventType:
      parsed.data.reason === 'transfer' || parsed.data.reason === 'replacement'
        ? 'transferred'
        : parsed.data.reason === 'decommission'
          ? 'decommissioned'
          : 'removed',
    occurredAt: now,
    ...(parsed.data.actorUserId !== undefined && { actorUserId: parsed.data.actorUserId }),
    ...(parsed.data.notes !== undefined && { notes: parsed.data.notes }),
  };
  let movement: StockMovement | null = null;
  let nextLog = log;
  if (movementReason && current.currentLocationId) {
    const moveResult = appendMovement(
      log,
      tenantId,
      movementReason === 'loss'
        ? {
            skuId: current.skuId,
            fromLocationId: current.currentLocationId,
            toLocationId: null,
            quantity: 1,
            reason: 'loss',
            assetSerialId: current.id,
            ...(parsed.data.actorUserId !== undefined && { actorUserId: parsed.data.actorUserId }),
            notes: `theft of asset ${current.serialNumber}`,
          }
        : movementReason === 'transfer' && destination
          ? {
              skuId: current.skuId,
              fromLocationId: current.currentLocationId,
              toLocationId: destination,
              quantity: 1,
              reason: 'transfer',
              assetSerialId: current.id,
              ...(parsed.data.actorUserId !== undefined && { actorUserId: parsed.data.actorUserId }),
            }
          : {
              skuId: current.skuId,
              fromLocationId: current.currentLocationId,
              toLocationId: destination,
              quantity: 1,
              reason: 'uninstall',
              assetSerialId: current.id,
              ...(parsed.data.actorUserId !== undefined && { actorUserId: parsed.data.actorUserId }),
            },
      idGen.movement,
      now,
    );
    if (!moveResult.ok) return err('BAD_REQUEST', moveResult.error.message);
    movement = moveResult.value.movement;
    nextLog = moveResult.value.log;
  }
  return ok({
    serial: updated,
    serials: nextSerials,
    event,
    events: [...events, event],
    movement,
    log: nextLog,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Read paths
// ─────────────────────────────────────────────────────────────────────

export function assetHistory(
  events: ReadonlyArray<AssetEvent>,
  assetSerialId: AssetSerialId,
): ReadonlyArray<AssetEvent> {
  return events.filter((e) => e.assetSerialId === assetSerialId)
    .slice()
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
}

export function findAssetBySerial(
  serials: ReadonlyArray<AssetSerial>,
  tenantId: TenantId,
  serialNumber: string,
): AssetSerial | null {
  return serials.find((s) => s.tenantId === tenantId && s.serialNumber === serialNumber) ?? null;
}

export function applianceInventoryForUnit(
  serials: ReadonlyArray<AssetSerial>,
  tenantId: TenantId,
  unitId: UnitId,
): ReadonlyArray<AssetSerial> {
  return serials.filter((s) => s.tenantId === tenantId && s.installedInUnitId === unitId && s.status === 'installed');
}

/**
 * Warranty alerts — serials whose warranty expires within `daysAhead`.
 */
export function warrantyAlerts(
  serials: ReadonlyArray<AssetSerial>,
  tenantId: TenantId,
  now: string,
  daysAhead: number,
): ReadonlyArray<AssetSerial> {
  const nowMs = Date.parse(now);
  const horizonMs = nowMs + daysAhead * 86_400_000;
  return serials.filter((s) => {
    if (s.tenantId !== tenantId) return false;
    if (s.status === 'decommissioned' || s.status === 'lost') return false;
    if (!s.warrantyExpiresAt) return false;
    const exp = Date.parse(s.warrantyExpiresAt);
    return Number.isFinite(exp) && exp <= horizonMs;
  });
}

/**
 * Filter events to maintenance only — convenient for the asset
 * detail page's "Maintenance log" tab.
 */
export function assetMaintenanceLog(
  events: ReadonlyArray<AssetEvent>,
  assetSerialId: AssetSerialId,
): ReadonlyArray<AssetEvent> {
  return assetHistory(events, assetSerialId).filter((e) => e.eventType === 'maintenance');
}

/**
 * Aggregated asset summary for a SKU — useful for dashboards.
 */
export function assetSummaryForSku(
  serials: ReadonlyArray<AssetSerial>,
  tenantId: TenantId,
  skuId: SkuId,
): {
  readonly total: number;
  readonly byStatus: Readonly<Record<AssetStatus, number>>;
} {
  const scoped = serials.filter((s) => s.tenantId === tenantId && s.skuId === skuId);
  const byStatus: Record<AssetStatus, number> = {
    in_stock: 0,
    installed: 0,
    in_repair: 0,
    decommissioned: 0,
    lost: 0,
  };
  for (const s of scoped) byStatus[s.status] += 1;
  return { total: scoped.length, byStatus };
}
