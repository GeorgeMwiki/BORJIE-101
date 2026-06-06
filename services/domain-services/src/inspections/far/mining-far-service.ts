/**
 * Mining FAR (Field Asset Register) Service — REAL mining-domain
 * service over the real `PostgresSiteFarRepository` (tables `assets` +
 * `maintenance_events`). NO stubs, NO canned data, NO Math.random.
 *
 * The Field Asset Register is the per-site register of physical mining
 * fixed assets (equipment, structures, vehicles on a mining site) plus
 * their scheduled inspection / maintenance cadence and the
 * chronological log of inspection / service events.
 *
 * Public surface (mining-native; the `/far` route binds to these):
 *   - addAsset            → register a site fixed asset
 *   - scheduleInspection  → open a scheduled inspection/service event
 *   - logInspection       → record an inspection/service outcome + (opt)
 *                           transition the asset status
 *   - getInspectionHistory→ list maintenance/inspection events for an asset
 *   - getAsset            → fetch one asset (repo read passthrough)
 *   - findDueInspections  → list due scheduled events (scheduler read)
 *
 * Every method threads `tenantId` to the repo, which binds
 * `app.current_tenant_id` (RLS FORCE-enabled) — we never disable RLS
 * nor double-filter. All methods return a `Result` envelope
 * (`{ success, data | error }`) so the route's status-mapping branches
 * resolve cleanly. Inputs are validated with zod; nothing is mutated.
 *
 * Types, inputs, error codes, and the money/cadence helpers live in
 * `./mining-far-types.ts` to keep this file under the size cap.
 */

import { z } from 'zod';
import { ok, err, type Result } from '@borjie/domain-models';
import type { TenantId } from '@borjie/domain-models';
import { prefixedId } from '../../common/id-generator.js';
import type {
  SiteFarRepository,
  SiteAsset,
  MaintenanceLogEntry,
  AssetStatus,
} from '../../site/site-far-types.js';
import {
  ASSET_KINDS,
  ASSET_STATUSES,
  MAINTENANCE_KINDS,
} from '../../site/site-far-types.js';
import {
  FAR_INSPECTION_FREQUENCIES,
  INSPECTION_OUTCOMES,
  MiningFarErrorCode,
  NOOP_FAR_LOGGER,
  addDaysIso,
  frequencyDays,
  outcomeToEventStatus,
  toLogEntryView,
  type AddAssetInput,
  type FarLogEntryView,
  type FarLogger,
  type LogInspectionInput,
  type MiningFarErrorResult,
  type ScheduleInspectionInput,
} from './mining-far-types.js';

// ---------------------------------------------------------------------------
// Construction-time validation schemas (defence-in-depth; the repo also
// validates, but the service rejects malformed input early with a clean
// INVALID_INPUT envelope rather than letting a ZodError escape).
// ---------------------------------------------------------------------------

const addAssetSchema = z.object({
  tenantId: z.string().min(1),
  companyId: z.string().min(1),
  kind: z.enum(ASSET_KINDS),
  currentSiteId: z.string().min(1).nullable().optional(),
  make: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  year: z.number().int().min(1900).max(2100).nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  owned: z.boolean().optional(),
  currentOperatorUserId: z.string().min(1).nullable().optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

const scheduleInspectionSchema = z.object({
  tenantId: z.string().min(1),
  assetId: z.string().min(1),
  frequency: z.enum(FAR_INSPECTION_FREQUENCIES),
  kind: z.enum(MAINTENANCE_KINDS).optional(),
  assignedToUserId: z.string().min(1).nullable().optional(),
  firstDueAt: z.string().datetime().nullable().optional(),
  summary: z.string().max(4000).nullable().optional(),
  evidenceIds: z.array(z.string().min(1)).optional(),
});

const logInspectionSchema = z.object({
  tenantId: z.string().min(1),
  assetId: z.string().min(1),
  outcome: z.enum(INSPECTION_OUTCOMES),
  kind: z.enum(MAINTENANCE_KINDS).optional(),
  performedByUserId: z.string().min(1).nullable().optional(),
  summary: z.string().max(4000).nullable().optional(),
  downtimeHours: z.number().nonnegative().nullable().optional(),
  costAmount: z.number().nonnegative().nullable().optional(),
  costCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  partsUsed: z.array(z.record(z.string(), z.unknown())).optional(),
  performedAt: z.string().datetime().nullable().optional(),
  evidenceIds: z.array(z.string().min(1)).optional(),
  assetStatusAfter: z.enum(ASSET_STATUSES).nullable().optional(),
});

// ---------------------------------------------------------------------------
// Service dependencies
// ---------------------------------------------------------------------------

export interface MiningFarServiceDeps {
  /** The real mining repo (PostgresSiteFarRepository) — RLS-bound db. */
  readonly repo: SiteFarRepository;
  /** Pino-shaped logger; defaults to a no-op (no console.* ever). */
  readonly logger?: FarLogger;
  /** Crypto-random id factory; injectable for tests. */
  readonly idFactory?: (prefix: string) => string;
  /** Clock; injectable for deterministic tests. */
  readonly now?: () => Date;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MiningFarService {
  private readonly repo: SiteFarRepository;
  private readonly logger: FarLogger;
  private readonly idFactory: (prefix: string) => string;
  private readonly clock: () => Date;

  constructor(deps: MiningFarServiceDeps) {
    this.repo = deps.repo;
    this.logger = deps.logger ?? NOOP_FAR_LOGGER;
    this.idFactory = deps.idFactory ?? ((prefix: string) => prefixedId(prefix));
    this.clock = deps.now ?? (() => new Date());
  }

  // -- Writes ---------------------------------------------------------------

  /** Register a new site fixed asset on the Field Asset Register. */
  async addAsset(
    input: AddAssetInput,
  ): Promise<Result<SiteAsset, MiningFarErrorResult>> {
    const parsed = addAssetSchema.safeParse(input);
    if (!parsed.success) {
      return invalid(parsed.error.message);
    }
    const v = parsed.data;
    const asset = await this.repo.registerAsset(v.tenantId as TenantId, {
      id: this.idFactory('asset'),
      companyId: v.companyId,
      kind: v.kind,
      make: v.make ?? null,
      model: v.model ?? null,
      year: v.year ?? null,
      serialNumber: v.serialNumber ?? null,
      owned: v.owned ?? true,
      currentSiteId: v.currentSiteId ?? null,
      currentOperatorUserId: v.currentOperatorUserId ?? null,
      status: v.status ?? 'operational',
      attributes: v.attributes ?? {},
    });
    this.logger.info(
      { assetId: asset.id, kind: asset.kind },
      'far.asset.registered',
    );
    return ok(asset);
  }

  /**
   * Open a scheduled inspection / maintenance event for an asset. The
   * event is persisted with status `open` and a `scheduledFor` derived
   * from the cadence (or the explicit `firstDueAt`). The scheduler
   * route (`/assignments/due`) later surfaces it via findDueInspections.
   */
  async scheduleInspection(
    input: ScheduleInspectionInput,
  ): Promise<Result<MaintenanceLogEntry, MiningFarErrorResult>> {
    const parsed = scheduleInspectionSchema.safeParse(input);
    if (!parsed.success) {
      return invalid(parsed.error.message);
    }
    const v = parsed.data;
    const tenantId = v.tenantId as TenantId;

    const asset = await this.repo.findAssetById(tenantId, v.assetId);
    if (!asset) {
      return err({
        code: MiningFarErrorCode.ASSET_NOT_FOUND,
        message: `Asset ${v.assetId} not found`,
      });
    }

    const scheduledFor = this.deriveFirstDue(v.frequency, v.firstDueAt ?? null);
    const event = await this.repo.logMaintenanceEvent(tenantId, {
      id: this.idFactory('mevt'),
      assetId: v.assetId,
      kind: v.kind ?? 'inspection',
      status: 'open',
      summary: v.summary ?? null,
      downtimeHours: null,
      costTzs: null,
      partsUsed: [],
      performedByUserId: v.assignedToUserId ?? null,
      scheduledFor,
      startedAt: null,
      completedAt: null,
      evidenceIds: v.evidenceIds ?? [],
    });
    this.logger.info(
      { assetId: v.assetId, eventId: event.id, scheduledFor },
      'far.inspection.scheduled',
    );
    return ok(event);
  }

  /**
   * Record the outcome of an inspection / service visit against an
   * asset and, when the outcome implies it, transition the asset's
   * status. A `skipped` outcome records a cancelled event; everything
   * else records a completed one.
   */
  async logInspection(
    input: LogInspectionInput,
  ): Promise<Result<MaintenanceLogEntry, MiningFarErrorResult>> {
    const parsed = logInspectionSchema.safeParse(input);
    if (!parsed.success) {
      return invalid(parsed.error.message);
    }
    const v = parsed.data;
    const tenantId = v.tenantId as TenantId;

    const asset = await this.repo.findAssetById(tenantId, v.assetId);
    if (!asset) {
      return err({
        code: MiningFarErrorCode.ASSET_NOT_FOUND,
        message: `Asset ${v.assetId} not found`,
      });
    }

    const performedAt = v.performedAt ?? this.clock().toISOString();
    const event = await this.repo.logMaintenanceEvent(tenantId, {
      id: this.idFactory('mevt'),
      assetId: v.assetId,
      kind: v.kind ?? 'inspection',
      status: outcomeToEventStatus(v.outcome),
      summary: v.summary ?? null,
      downtimeHours: v.downtimeHours ?? null,
      costTzs: v.costAmount ?? null,
      partsUsed: v.partsUsed ?? [],
      performedByUserId: v.performedByUserId ?? null,
      scheduledFor: null,
      startedAt: performedAt,
      completedAt: v.outcome === 'skipped' ? null : performedAt,
      evidenceIds: v.evidenceIds ?? [],
    });

    await this.maybeTransitionAsset(tenantId, asset, v.assetStatusAfter ?? null);

    this.logger.info(
      { assetId: v.assetId, eventId: event.id, outcome: v.outcome },
      'far.inspection.logged',
    );
    return ok(event);
  }

  // -- Reads ----------------------------------------------------------------

  /**
   * List the maintenance / inspection history for an asset, each entry
   * carrying a currency-aware cost render (null when no cost / no code).
   * `currencyCode` is the tenant/user ISO-4217 code threaded by the
   * caller — never defaulted here.
   */
  async getInspectionHistory(
    tenantId: string,
    assetId: string,
    currencyCode?: string | null,
  ): Promise<Result<readonly FarLogEntryView[], MiningFarErrorResult>> {
    if (!assetId) {
      return invalid('assetId is required');
    }
    const rows = await this.repo.listMaintenanceByAsset(
      tenantId as TenantId,
      assetId,
    );
    const views = rows.map((row) => toLogEntryView(row, currencyCode));
    return ok(views);
  }

  /** Fetch a single asset (repo read passthrough). */
  async getAsset(tenantId: string, assetId: string): Promise<SiteAsset | null> {
    return this.repo.findAssetById(tenantId as TenantId, assetId);
  }

  /** List due scheduled inspections/services up to `cutoffIso`. */
  async findDueInspections(
    tenantId: string | null,
    cutoffIso: string,
  ): Promise<readonly MaintenanceLogEntry[]> {
    return this.repo.findDueScheduledMaintenance(
      tenantId as TenantId | null,
      cutoffIso,
    );
  }

  // -- Private helpers ------------------------------------------------------

  /**
   * Derive the first scheduled instant (ISO string) from the cadence or
   * the explicit value. The repo's `logMaintenanceEvent` wraps this in a
   * `Date`, so we hand it an ISO string (or null for one-off cadences).
   */
  private deriveFirstDue(
    frequency: (typeof FAR_INSPECTION_FREQUENCIES)[number],
    explicit: string | null,
  ): string | null {
    if (explicit) {
      return explicit;
    }
    const days = frequencyDays(frequency);
    if (days === null) {
      return null;
    }
    return addDaysIso(this.clock().toISOString(), days);
  }

  /** Transition the asset status only when a (different) one is given. */
  private async maybeTransitionAsset(
    tenantId: TenantId,
    asset: SiteAsset,
    next: AssetStatus | null,
  ): Promise<void> {
    if (!next || next === asset.status) {
      return;
    }
    await this.repo.updateAssetStatus(tenantId, asset.id, next);
    this.logger.info(
      { assetId: asset.id, from: asset.status, to: next },
      'far.asset.status_changed',
    );
  }
}

/** INVALID_INPUT helper — keeps the call sites one line. */
function invalid(message: string): Result<never, MiningFarErrorResult> {
  return err({ code: MiningFarErrorCode.INVALID_INPUT, message });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Construct a {@link MiningFarService} from its dependencies. */
export function createMiningFarService(
  deps: MiningFarServiceDeps,
): MiningFarService {
  return new MiningFarService(deps);
}
