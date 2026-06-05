import { randomHex } from '../common/id-generator.js';
/**
 * Site domain service.
 *
 * Handles mining-site and unit (sub-tenement) management for the BORJIE
 * platform — sites group the blocks, operating units, and assets that make
 * up an owner's production footprint.
 */

import type {
  TenantId,
  UserId,
  PaginationParams,
  PaginatedResult,
  Result,
  ISOTimestamp,
} from '@borjie/domain-models';
import {
  type MiningSite,
  type MiningSiteId,
  type MiningSiteType,
  type MiningSiteStatus,
  type OwnerId,
  type Address,
  type MiningUnit,
  type MiningUnitId,
  type MiningUnitType,
  type MiningUnitStatus,
  type Money,
  createMiningSite,
  createMiningUnit,
  asMiningSiteId,
  asMiningUnitId,
  ok,
  err,
  Block,
} from '@borjie/domain-models';
// Block namespace (exports asBlockId/createBlock/generateBlockCode/BlockId/BlockStatus)
// was split out of the top-level barrel in domain-models; re-alias the
// previously flat imports so the rest of this file keeps compiling without
// a broader refactor.
type BlockId = string & { readonly __brand: 'BlockId' };
interface BlockShape {
  readonly id: BlockId;
  readonly tenantId: TenantId;
  readonly siteId: MiningSiteId;
  readonly blockCode: string;
  readonly name: string;
  readonly status: BlockStatus;
  [key: string]: unknown;
}
const { asBlockId, createBlock, generateBlockCode } = Block as unknown as {
  asBlockId: (id: string) => BlockId;
  createBlock: (..._args: unknown[]) => BlockShape;
  generateBlockCode: (siteCode: string, sequence: number) => string;
};
type Block = BlockShape;
type BlockStatus = 'active' | 'inactive' | 'under_construction' | 'under_renovation' | 'demolished';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// ============================================================================
// Error Types
// ============================================================================

export const SiteServiceError = {
  SITE_NOT_FOUND: 'SITE_NOT_FOUND',
  SITE_CODE_EXISTS: 'SITE_CODE_EXISTS',
  UNIT_NOT_FOUND: 'UNIT_NOT_FOUND',
  UNIT_NUMBER_EXISTS: 'UNIT_NUMBER_EXISTS',
  UNIT_IN_PRODUCTION: 'UNIT_IN_PRODUCTION',
  INVALID_SITE_DATA: 'INVALID_SITE_DATA',
  INVALID_UNIT_DATA: 'INVALID_UNIT_DATA',
  CANNOT_DELETE_WITH_ACTIVE_OFFTAKES: 'CANNOT_DELETE_WITH_ACTIVE_OFFTAKES',
} as const;

export type SiteServiceErrorCode = (typeof SiteServiceError)[keyof typeof SiteServiceError];

export interface SiteServiceErrorResult {
  code: SiteServiceErrorCode;
  message: string;
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface SiteRepository {
  findById(id: MiningSiteId, tenantId: TenantId): Promise<MiningSite | null>;
  findByCode(code: string, tenantId: TenantId): Promise<MiningSite | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<MiningSite>>;
  findByOwner(ownerId: OwnerId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<MiningSite>>;
  findByManager(managerId: UserId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<MiningSite>>;
  create(site: MiningSite): Promise<MiningSite>;
  update(site: MiningSite): Promise<MiningSite>;
  delete(id: MiningSiteId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  getNextSequence(tenantId: TenantId): Promise<number>;
}

export interface UnitRepository {
  findById(id: MiningUnitId, tenantId: TenantId): Promise<MiningUnit | null>;
  findByUnitNumber(unitNumber: string, siteId: MiningSiteId, tenantId: TenantId): Promise<MiningUnit | null>;
  findBySite(siteId: MiningSiteId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<MiningUnit>>;
  findByBlock(blockId: BlockId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<MiningUnit>>;
  findByStatus(status: MiningUnitStatus, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<MiningUnit>>;
  findIdle(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<MiningUnit>>;
  create(unit: MiningUnit): Promise<MiningUnit>;
  createMany(units: MiningUnit[]): Promise<MiningUnit[]>;
  update(unit: MiningUnit): Promise<MiningUnit>;
  updateMany(units: MiningUnit[]): Promise<MiningUnit[]>;
  delete(id: MiningUnitId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  countBySite(siteId: MiningSiteId, tenantId: TenantId): Promise<{ total: number; inProduction: number; idle: number }>;
  countByBlock(blockId: BlockId, tenantId: TenantId): Promise<{ total: number; inProduction: number; idle: number }>;
}

export interface BlockRepository {
  findById(id: BlockId, tenantId: TenantId): Promise<Block | null>;
  findByBlockCode(blockCode: string, siteId: MiningSiteId, tenantId: TenantId): Promise<Block | null>;
  findBySite(siteId: MiningSiteId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Block>>;
  create(block: Block): Promise<Block>;
  update(block: Block): Promise<Block>;
  delete(id: BlockId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  getNextSequence(siteId: MiningSiteId, tenantId: TenantId): Promise<number>;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateSiteInput {
  name: string;
  code?: string;
  type: MiningSiteType;
  ownerId: OwnerId;
  address: Address;
  totalUnits?: number;
  yearEstablished?: number;
  totalArea?: number;
  amenities?: string[];
  description?: string;
  managerId?: UserId;
}

export interface UpdateSiteInput {
  name?: string;
  status?: MiningSiteStatus;
  address?: Partial<Address>;
  totalUnits?: number;
  yearEstablished?: number;
  totalArea?: number;
  amenities?: string[];
  description?: string;
  managerId?: UserId | null;
}

export interface CreateUnitInput {
  unitNumber: string;
  level: number;
  type: MiningUnitType;
  oreGradeGramsPerTonne: number;
  recoveryPct: number;
  operatingLevy: Money;
  bondAmount: Money;
  area?: number;
  amenities?: string[];
  description?: string;
}

export interface UpdateUnitInput {
  status?: MiningUnitStatus;
  type?: MiningUnitType;
  oreGradeGramsPerTonne?: number;
  recoveryPct?: number;
  operatingLevy?: Money;
  bondAmount?: Money;
  area?: number;
  amenities?: string[];
  description?: string;
}

export interface CreateBlockInput {
  name: string;
  blockCode?: string;
  description?: string;
  level?: number;
  wing?: string;
  amenities?: string[];
  features?: Record<string, unknown>;
  hasElevator?: boolean;
  hasParking?: boolean;
  hasSecurity?: boolean;
  managerId?: string;
  sortOrder?: number;
}

export interface UpdateBlockInput {
  name?: string;
  description?: string;
  status?: BlockStatus;
  amenities?: string[];
  features?: Record<string, unknown>;
  hasElevator?: boolean;
  hasParking?: boolean;
  hasSecurity?: boolean;
  managerId?: string | null;
  sortOrder?: number;
}

export interface BulkCreateUnitInput {
  prefix: string;
  startNumber: number;
  count: number;
  level: number;
  type: MiningUnitType;
  oreGradeGramsPerTonne: number;
  recoveryPct: number;
  operatingLevy: Money;
  bondAmount: Money;
  area?: number;
  amenities?: string[];
  blockId?: BlockId;
}

export interface BulkUpdateUnitStatusInput {
  unitIds: MiningUnitId[];
  status: MiningUnitStatus;
}

// ============================================================================
// Stats Types
// ============================================================================

export interface SiteStats {
  siteId: MiningSiteId;
  totalUnits: number;
  unitsInProduction: number;
  idleUnits: number;
  utilisationRate: number;
  potentialMonthlyRevenue: Money;
  actualMonthlyRevenue: Money;
  revenueEfficiency: number;
}

export interface UnitAvailability {
  unitId: MiningUnitId;
  siteId: MiningSiteId;
  isAvailable: boolean;
  status: MiningUnitStatus;
  currentOfftakeId: string | null;
  offtakeEndDate: string | null;
  availableFrom: string | null;
  operatingLevy: Money;
  bondAmount: Money;
}

export interface SiteHealthScore {
  siteId: MiningSiteId;
  overallScore: number; // 0-100
  utilisationScore: number; // 0-100 based on production-utilisation rate
  revenueScore: number; // 0-100 based on revenue efficiency
  maintenanceScore: number; // 0-100 based on open work orders
  complianceScore: number; // 0-100 based on inspection/compliance status
  factors: {
    utilisationRate: number;
    revenueEfficiency: number;
    idleUnits: number;
    totalUnits: number;
    averageLevy: number;
  };
  calculatedAt: string;
}

// ============================================================================
// Domain Events
// ============================================================================

export interface SiteCreatedEvent {
  eventId: string;
  eventType: 'SiteCreated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    siteId: MiningSiteId;
    name: string;
    code: string;
    type: MiningSiteType;
    ownerId: OwnerId;
  };
}

export interface UnitCreatedEvent {
  eventId: string;
  eventType: 'UnitCreated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    unitId: MiningUnitId;
    siteId: MiningSiteId;
    unitNumber: string;
    type: MiningUnitType;
  };
}

export interface BlockCreatedEvent {
  eventId: string;
  eventType: 'BlockCreated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    blockId: BlockId;
    siteId: MiningSiteId;
    blockCode: string;
    name: string;
  };
}

export interface BulkUnitsCreatedEvent {
  eventId: string;
  eventType: 'BulkUnitsCreated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    siteId: MiningSiteId;
    unitCount: number;
    unitIds: MiningUnitId[];
  };
}

// ============================================================================
// Site Service Implementation
// ============================================================================

/**
 * Mining-site and unit management service.
 * Handles all CRUD operations and business logic for sites and units.
 */
export class SiteService {
  constructor(
    private readonly siteRepo: SiteRepository,
    private readonly unitRepo: UnitRepository,
    private readonly eventBus: EventBus,
    private readonly blockRepo?: BlockRepository
  ) {}

  // ==================== Site Operations ====================

  /**
   * Create a new mining site.
   */
  async createSite(
    tenantId: TenantId,
    input: CreateSiteInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<MiningSite, SiteServiceErrorResult>> {
    // Generate site code if not provided
    const code = input.code ?? await this.generateSiteCode(tenantId);

    // Check code uniqueness
    const existing = await this.siteRepo.findByCode(code, tenantId);
    if (existing) {
      return err({
        code: SiteServiceError.SITE_CODE_EXISTS,
        message: `Site with code ${code} already exists`,
      });
    }

    // Validate required fields
    if (!input.name || !input.type || !input.ownerId) {
      return err({
        code: SiteServiceError.INVALID_SITE_DATA,
        message: 'Name, type, and owner are required',
      });
    }

    const siteId = asMiningSiteId(`site_${Date.now()}_${randomHex(4)}`);

    const site = createMiningSite(siteId, {
      tenantId,
      ownerId: input.ownerId,
      name: input.name,
      code,
      type: input.type,
      address: input.address,
      ...(input.totalUnits !== undefined ? { totalUnits: input.totalUnits } : {}),
      ...(input.yearEstablished !== undefined ? { yearEstablished: input.yearEstablished } : {}),
      ...(input.totalArea !== undefined ? { totalArea: input.totalArea } : {}),
      ...(input.amenities !== undefined ? { amenities: input.amenities } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
    }, createdBy);

    const savedSite = await this.siteRepo.create(site);

    // Publish event
    const event: SiteCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'SiteCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        siteId: savedSite.id,
        name: savedSite.name,
        code: savedSite.code,
        type: savedSite.type,
        ownerId: savedSite.ownerId,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedSite.id, 'Site'));

    return ok(savedSite);
  }

  /**
   * Get a site by ID.
   */
  async getSite(siteId: MiningSiteId, tenantId: TenantId): Promise<MiningSite | null> {
    return this.siteRepo.findById(siteId, tenantId);
  }

  /**
   * Get a site by code.
   */
  async getSiteByCode(code: string, tenantId: TenantId): Promise<MiningSite | null> {
    return this.siteRepo.findByCode(code, tenantId);
  }

  /**
   * List all sites for a tenant.
   */
  async listSites(
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<MiningSite>> {
    return this.siteRepo.findMany(tenantId, pagination);
  }

  /**
   * List sites by owner.
   */
  async listSitesByOwner(
    ownerId: OwnerId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<MiningSite>> {
    return this.siteRepo.findByOwner(ownerId, tenantId, pagination);
  }

  /**
   * List sites by manager.
   */
  async listSitesByManager(
    managerId: UserId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<MiningSite>> {
    return this.siteRepo.findByManager(managerId, tenantId, pagination);
  }

  /**
   * Update a site.
   */
  async updateSite(
    siteId: MiningSiteId,
    tenantId: TenantId,
    input: UpdateSiteInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<MiningSite, SiteServiceErrorResult>> {
    const site = await this.siteRepo.findById(siteId, tenantId);
    if (!site) {
      return err({
        code: SiteServiceError.SITE_NOT_FOUND,
        message: 'Site not found',
      });
    }

    const updatedSite: MiningSite = {
      ...site,
      name: input.name ?? site.name,
      status: input.status ?? site.status,
      address: input.address ? { ...site.address, ...input.address } : site.address,
      totalUnits: input.totalUnits ?? site.totalUnits,
      yearEstablished: input.yearEstablished ?? site.yearEstablished,
      totalArea: input.totalArea ?? site.totalArea,
      amenities: input.amenities ?? site.amenities,
      description: input.description ?? site.description,
      managerId: input.managerId !== undefined ? input.managerId : site.managerId,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    const savedSite = await this.siteRepo.update(updatedSite);
    return ok(savedSite);
  }

  /**
   * Delete a site (soft delete).
   */
  async deleteSite(
    siteId: MiningSiteId,
    tenantId: TenantId,
    deletedBy: UserId,
    correlationId: string
  ): Promise<Result<void, SiteServiceErrorResult>> {
    const site = await this.siteRepo.findById(siteId, tenantId);
    if (!site) {
      return err({
        code: SiteServiceError.SITE_NOT_FOUND,
        message: 'Site not found',
      });
    }

    // Check for active offtakes - would need OfftakeRepository
    // For now, just delete
    await this.siteRepo.delete(siteId, tenantId, deletedBy);
    return ok(undefined);
  }

  /**
   * Assign a manager to a site.
   */
  async assignManager(
    siteId: MiningSiteId,
    tenantId: TenantId,
    managerId: UserId | null,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<MiningSite, SiteServiceErrorResult>> {
    return this.updateSite(
      siteId,
      tenantId,
      { managerId },
      updatedBy,
      correlationId
    );
  }

  /**
   * Get site statistics including production-utilisation and unit counts.
   */
  async getSiteStats(
    siteId: MiningSiteId,
    tenantId: TenantId
  ): Promise<Result<SiteStats, SiteServiceErrorResult>> {
    const site = await this.siteRepo.findById(siteId, tenantId);
    if (!site) {
      return err({
        code: SiteServiceError.SITE_NOT_FOUND,
        message: 'Site not found',
      });
    }

    const counts = await this.unitRepo.countBySite(siteId, tenantId);
    const utilisationRate = counts.total > 0
      ? Math.round((counts.inProduction / counts.total) * 100)
      : 0;

    // Get units for revenue calculation
    const units = await this.unitRepo.findBySite(siteId, tenantId);
    let potentialMonthlyRevenue = 0;
    let actualMonthlyRevenue = 0;

    for (const unit of units.items) {
      potentialMonthlyRevenue += unit.operatingLevy.amount;
      if (unit.status === 'in_production') {
        actualMonthlyRevenue += unit.operatingLevy.amount;
      }
    }

    const stats: SiteStats = {
      siteId,
      totalUnits: counts.total,
      unitsInProduction: counts.inProduction,
      idleUnits: counts.idle,
      utilisationRate,
      potentialMonthlyRevenue: {
        amount: potentialMonthlyRevenue,
        currency: units.items[0]?.operatingLevy.currency ?? 'USD',
      } as Money,
      actualMonthlyRevenue: {
        amount: actualMonthlyRevenue,
        currency: units.items[0]?.operatingLevy.currency ?? 'USD',
      } as Money,
      revenueEfficiency: potentialMonthlyRevenue > 0
        ? Math.round((actualMonthlyRevenue / potentialMonthlyRevenue) * 100)
        : 0,
    };

    return ok(stats);
  }

  // ==================== Unit Operations ====================

  /**
   * Create a new unit within a site.
   */
  async createUnit(
    siteId: MiningSiteId,
    tenantId: TenantId,
    input: CreateUnitInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<MiningUnit, SiteServiceErrorResult>> {
    // Verify site exists
    const site = await this.siteRepo.findById(siteId, tenantId);
    if (!site) {
      return err({
        code: SiteServiceError.SITE_NOT_FOUND,
        message: 'Site not found',
      });
    }

    // Check unit number uniqueness within site
    const existing = await this.unitRepo.findByUnitNumber(input.unitNumber, siteId, tenantId);
    if (existing) {
      return err({
        code: SiteServiceError.UNIT_NUMBER_EXISTS,
        message: `Unit ${input.unitNumber} already exists in this site`,
      });
    }

    // Validate required fields
    if (!input.unitNumber || !input.type || !input.operatingLevy) {
      return err({
        code: SiteServiceError.INVALID_UNIT_DATA,
        message: 'Unit number, type, and operating levy are required',
      });
    }

    const unitId = asMiningUnitId(`unit_${Date.now()}_${randomHex(4)}`);

    const unit = createMiningUnit(unitId, {
      tenantId,
      siteId,
      unitNumber: input.unitNumber,
      level: input.level,
      type: input.type,
      oreGradeGramsPerTonne: input.oreGradeGramsPerTonne,
      recoveryPct: input.recoveryPct,
      operatingLevy: input.operatingLevy,
      bondAmount: input.bondAmount,
      ...(input.area !== undefined ? { area: input.area } : {}),
      ...(input.amenities !== undefined ? { amenities: input.amenities } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    }, createdBy);

    const savedUnit = await this.unitRepo.create(unit);

    // Update site unit counts
    const counts = await this.unitRepo.countBySite(siteId, tenantId);
    await this.siteRepo.update({
      ...site,
      totalUnits: counts.total,
      activeUnits: counts.inProduction,
      idleUnits: counts.idle,
      updatedAt: new Date().toISOString(),
      updatedBy: createdBy,
    });

    // Publish event
    const event: UnitCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'UnitCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        unitId: savedUnit.id,
        siteId,
        unitNumber: savedUnit.unitNumber,
        type: savedUnit.type,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedUnit.id, 'Unit'));

    return ok(savedUnit);
  }

  /**
   * Get a unit by ID.
   */
  async getUnit(unitId: MiningUnitId, tenantId: TenantId): Promise<MiningUnit | null> {
    return this.unitRepo.findById(unitId, tenantId);
  }

  /**
   * List units by site.
   */
  async listUnitsBySite(
    siteId: MiningSiteId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<MiningUnit>> {
    return this.unitRepo.findBySite(siteId, tenantId, pagination);
  }

  /**
   * List idle units (spare capacity) across all sites.
   */
  async listIdleUnits(
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<MiningUnit>> {
    return this.unitRepo.findIdle(tenantId, pagination);
  }

  /**
   * Update a unit.
   */
  async updateUnit(
    unitId: MiningUnitId,
    tenantId: TenantId,
    input: UpdateUnitInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<MiningUnit, SiteServiceErrorResult>> {
    const unit = await this.unitRepo.findById(unitId, tenantId);
    if (!unit) {
      return err({
        code: SiteServiceError.UNIT_NOT_FOUND,
        message: 'Unit not found',
      });
    }

    const updatedUnit: MiningUnit = {
      ...unit,
      status: input.status ?? unit.status,
      type: input.type ?? unit.type,
      oreGradeGramsPerTonne: input.oreGradeGramsPerTonne ?? unit.oreGradeGramsPerTonne,
      recoveryPct: input.recoveryPct ?? unit.recoveryPct,
      operatingLevy: input.operatingLevy ?? unit.operatingLevy,
      bondAmount: input.bondAmount ?? unit.bondAmount,
      area: input.area ?? unit.area,
      amenities: input.amenities ?? unit.amenities,
      description: input.description ?? unit.description,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    const savedUnit = await this.unitRepo.update(updatedUnit);

    // Update site unit counts if status changed
    if (input.status) {
      const site = await this.siteRepo.findById(unit.siteId, tenantId);
      if (site) {
        const counts = await this.unitRepo.countBySite(unit.siteId, tenantId);
        await this.siteRepo.update({
          ...site,
          activeUnits: counts.inProduction,
          idleUnits: counts.idle,
          updatedAt: new Date().toISOString(),
          updatedBy,
        });
      }
    }

    return ok(savedUnit);
  }

  /**
   * Update unit status (convenience method).
   */
  async updateUnitStatus(
    unitId: MiningUnitId,
    tenantId: TenantId,
    status: MiningUnitStatus,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<MiningUnit, SiteServiceErrorResult>> {
    return this.updateUnit(unitId, tenantId, { status }, updatedBy, correlationId);
  }

  /**
   * Delete a unit (soft delete).
   */
  async deleteUnit(
    unitId: MiningUnitId,
    tenantId: TenantId,
    deletedBy: UserId,
    correlationId: string
  ): Promise<Result<void, SiteServiceErrorResult>> {
    const unit = await this.unitRepo.findById(unitId, tenantId);
    if (!unit) {
      return err({
        code: SiteServiceError.UNIT_NOT_FOUND,
        message: 'Unit not found',
      });
    }

    // Check if unit is in production
    if (unit.status === 'in_production') {
      return err({
        code: SiteServiceError.UNIT_IN_PRODUCTION,
        message: 'Cannot delete a unit that is in production',
      });
    }

    await this.unitRepo.delete(unitId, tenantId, deletedBy);

    // Update site counts
    const site = await this.siteRepo.findById(unit.siteId, tenantId);
    if (site) {
      const counts = await this.unitRepo.countBySite(unit.siteId, tenantId);
      await this.siteRepo.update({
        ...site,
        totalUnits: counts.total,
        activeUnits: counts.inProduction,
        idleUnits: counts.idle,
        updatedAt: new Date().toISOString(),
        updatedBy: deletedBy,
      });
    }

    return ok(undefined);
  }

  // ==================== Block Operations ====================

  /**
   * Create a block within a site.
   */
  async createBlock(
    siteId: MiningSiteId,
    tenantId: TenantId,
    input: CreateBlockInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Block, SiteServiceErrorResult>> {
    if (!this.blockRepo) {
      return err({ code: SiteServiceError.INVALID_SITE_DATA, message: 'Block repository not configured' });
    }

    const site = await this.siteRepo.findById(siteId, tenantId);
    if (!site) {
      return err({ code: SiteServiceError.SITE_NOT_FOUND, message: 'Site not found' });
    }

    // Generate block code if not provided
    const sequence = await this.blockRepo.getNextSequence(siteId, tenantId);
    const blockCode = input.blockCode ?? generateBlockCode(site.code, sequence);

    // Check uniqueness
    const existing = await this.blockRepo.findByBlockCode(blockCode, siteId, tenantId);
    if (existing) {
      return err({ code: SiteServiceError.SITE_CODE_EXISTS, message: `Block code ${blockCode} already exists` });
    }

    const blockId = asBlockId(`blk_${Date.now()}_${randomHex(4)}`);
    const block = createBlock(blockId, {
      tenantId,
      siteId,
      blockCode,
      name: input.name,
      description: input.description,
      level: input.level,
      wing: input.wing,
      amenities: input.amenities,
      features: input.features,
      hasElevator: input.hasElevator,
      hasParking: input.hasParking,
      hasSecurity: input.hasSecurity,
      managerId: input.managerId,
      sortOrder: input.sortOrder,
    }, createdBy);

    const savedBlock = await this.blockRepo.create(block);

    const event: BlockCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'BlockCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: { blockId: savedBlock.id, siteId, blockCode: savedBlock.blockCode, name: savedBlock.name },
    };
    await this.eventBus.publish(createEventEnvelope(event, savedBlock.id, 'Block'));

    return ok(savedBlock);
  }

  /**
   * Get a block by ID.
   */
  async getBlock(blockId: BlockId, tenantId: TenantId): Promise<Block | null> {
    if (!this.blockRepo) return null;
    return this.blockRepo.findById(blockId, tenantId);
  }

  /**
   * List blocks by site.
   */
  async listBlocksBySite(
    siteId: MiningSiteId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Block>> {
    if (!this.blockRepo) {
      return { items: [], total: 0, limit: pagination?.limit ?? 50, offset: pagination?.offset ?? 0, hasMore: false };
    }
    return this.blockRepo.findBySite(siteId, tenantId, pagination);
  }

  /**
   * Update a block.
   */
  async updateBlock(
    blockId: BlockId,
    tenantId: TenantId,
    input: UpdateBlockInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Block, SiteServiceErrorResult>> {
    if (!this.blockRepo) {
      return err({ code: SiteServiceError.INVALID_SITE_DATA, message: 'Block repository not configured' });
    }

    const block = await this.blockRepo.findById(blockId, tenantId);
    if (!block) {
      return err({ code: SiteServiceError.SITE_NOT_FOUND, message: 'Block not found' });
    }

    const updatedBlock: Block = {
      ...block,
      name: input.name ?? block.name,
      description: input.description !== undefined ? input.description ?? null : block.description,
      status: input.status ?? block.status,
      amenities: input.amenities ?? block.amenities,
      features: input.features ?? block.features,
      hasElevator: input.hasElevator ?? block.hasElevator,
      hasParking: input.hasParking ?? block.hasParking,
      hasSecurity: input.hasSecurity ?? block.hasSecurity,
      managerId: input.managerId !== undefined ? (input.managerId ?? null) : block.managerId,
      sortOrder: input.sortOrder ?? block.sortOrder,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    const savedBlock = await this.blockRepo.update(updatedBlock);
    return ok(savedBlock);
  }

  /**
   * Delete a block (soft delete).
   */
  async deleteBlock(
    blockId: BlockId,
    tenantId: TenantId,
    deletedBy: UserId,
    correlationId: string
  ): Promise<Result<void, SiteServiceErrorResult>> {
    if (!this.blockRepo) {
      return err({ code: SiteServiceError.INVALID_SITE_DATA, message: 'Block repository not configured' });
    }

    const block = await this.blockRepo.findById(blockId, tenantId);
    if (!block) {
      return err({ code: SiteServiceError.SITE_NOT_FOUND, message: 'Block not found' });
    }

    // Check for in-production units in block
    const counts = await this.unitRepo.countByBlock(blockId, tenantId);
    if (counts.inProduction > 0) {
      return err({
        code: SiteServiceError.CANNOT_DELETE_WITH_ACTIVE_OFFTAKES,
        message: 'Cannot delete block with units in production',
      });
    }

    await this.blockRepo.delete(blockId, tenantId, deletedBy);
    return ok(undefined);
  }

  // ==================== Health Scoring ====================

  /**
   * Calculate a site health score (0-100) covering utilisation, revenue,
   * maintenance and compliance factors.
   */
  async calculateSiteHealthScore(
    siteId: MiningSiteId,
    tenantId: TenantId
  ): Promise<Result<SiteHealthScore, SiteServiceErrorResult>> {
    const site = await this.siteRepo.findById(siteId, tenantId);
    if (!site) {
      return err({ code: SiteServiceError.SITE_NOT_FOUND, message: 'Site not found' });
    }

    const counts = await this.unitRepo.countBySite(siteId, tenantId);
    const units = await this.unitRepo.findBySite(siteId, tenantId);

    const utilisationRate = counts.total > 0 ? (counts.inProduction / counts.total) * 100 : 0;
    const utilisationScore = Math.min(100, Math.round(utilisationRate));

    // Revenue efficiency
    let potentialRevenue = 0;
    let actualRevenue = 0;
    for (const unit of units.items) {
      potentialRevenue += unit.operatingLevy.amount;
      if (unit.status === 'in_production') {
        actualRevenue += unit.operatingLevy.amount;
      }
    }
    const revenueEfficiency = potentialRevenue > 0 ? (actualRevenue / potentialRevenue) * 100 : 0;
    const revenueScore = Math.min(100, Math.round(revenueEfficiency));

    // Maintenance score: based on units under maintenance (lower is worse)
    const underMaintenance = units.items.filter(u => u.status === 'under_maintenance').length;
    const maintenanceRatio = counts.total > 0 ? (underMaintenance / counts.total) : 0;
    const maintenanceScore = Math.max(0, Math.round(100 - maintenanceRatio * 500));

    // Compliance score: base from inspection status
    const overdue = units.items.filter(u => {
      if (!u.nextInspectionDue) return false;
      return new Date(u.nextInspectionDue) < new Date();
    }).length;
    const complianceRatio = counts.total > 0 ? (overdue / counts.total) : 0;
    const complianceScore = Math.max(0, Math.round(100 - complianceRatio * 300));

    // Weighted overall score
    const overallScore = Math.round(
      utilisationScore * 0.35 +
      revenueScore * 0.30 +
      maintenanceScore * 0.20 +
      complianceScore * 0.15
    );

    const averageLevy = counts.total > 0 ? Math.round(potentialRevenue / counts.total) : 0;

    const healthScore: SiteHealthScore = {
      siteId,
      overallScore,
      utilisationScore,
      revenueScore,
      maintenanceScore,
      complianceScore,
      factors: {
        utilisationRate: Math.round(utilisationRate * 10) / 10,
        revenueEfficiency: Math.round(revenueEfficiency * 10) / 10,
        idleUnits: counts.idle,
        totalUnits: counts.total,
        averageLevy,
      },
      calculatedAt: new Date().toISOString(),
    };

    return ok(healthScore);
  }

  // ==================== Bulk Unit Operations ====================

  /**
   * Create multiple units at once for a site.
   * Generates sequential unit numbers using a prefix.
   */
  async bulkCreateUnits(
    siteId: MiningSiteId,
    tenantId: TenantId,
    input: BulkCreateUnitInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<MiningUnit[], SiteServiceErrorResult>> {
    const site = await this.siteRepo.findById(siteId, tenantId);
    if (!site) {
      return err({ code: SiteServiceError.SITE_NOT_FOUND, message: 'Site not found' });
    }

    if (input.count <= 0 || input.count > 200) {
      return err({ code: SiteServiceError.INVALID_UNIT_DATA, message: 'Count must be between 1 and 200' });
    }

    const units: MiningUnit[] = [];
    for (let i = 0; i < input.count; i++) {
      const unitNumber = `${input.prefix}${String(input.startNumber + i).padStart(2, '0')}`;

      // Check uniqueness
      const existing = await this.unitRepo.findByUnitNumber(unitNumber, siteId, tenantId);
      if (existing) {
        return err({
          code: SiteServiceError.UNIT_NUMBER_EXISTS,
          message: `Unit ${unitNumber} already exists in this site`,
        });
      }

      const unitId = asMiningUnitId(`unit_${Date.now()}_${randomHex(4)}_${i}`);
      const unit = createMiningUnit(unitId, {
        tenantId,
        siteId,
        unitNumber,
        level: input.level,
        type: input.type,
        oreGradeGramsPerTonne: input.oreGradeGramsPerTonne,
        recoveryPct: input.recoveryPct,
        operatingLevy: input.operatingLevy,
        bondAmount: input.bondAmount,
        ...(input.area !== undefined ? { area: input.area } : {}),
        ...(input.amenities !== undefined ? { amenities: input.amenities } : {}),
      }, createdBy);
      units.push(unit);
    }

    const savedUnits = await this.unitRepo.createMany(units);

    // Update site counts
    const counts = await this.unitRepo.countBySite(siteId, tenantId);
    await this.siteRepo.update({
      ...site,
      totalUnits: counts.total,
      activeUnits: counts.inProduction,
      idleUnits: counts.idle,
      updatedAt: new Date().toISOString(),
      updatedBy: createdBy,
    });

    // Publish bulk event
    const event: BulkUnitsCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'BulkUnitsCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        siteId,
        unitCount: savedUnits.length,
        unitIds: savedUnits.map(u => u.id),
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, siteId, 'Site'));

    return ok(savedUnits);
  }

  /**
   * Bulk update the status of multiple units at once.
   */
  async bulkUpdateUnitStatus(
    tenantId: TenantId,
    input: BulkUpdateUnitStatusInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<MiningUnit[], SiteServiceErrorResult>> {
    if (input.unitIds.length === 0) {
      return err({ code: SiteServiceError.INVALID_UNIT_DATA, message: 'No unit IDs provided' });
    }
    if (input.unitIds.length > 200) {
      return err({ code: SiteServiceError.INVALID_UNIT_DATA, message: 'Cannot update more than 200 units at once' });
    }

    const updatedUnits: MiningUnit[] = [];
    const now = new Date().toISOString();
    const affectedSites = new Set<MiningSiteId>();

    for (const unitId of input.unitIds) {
      const unit = await this.unitRepo.findById(unitId, tenantId);
      if (!unit) {
        return err({ code: SiteServiceError.UNIT_NOT_FOUND, message: `Unit ${unitId} not found` });
      }

      if (input.status === 'idle' && unit.status === 'in_production') {
        // Cannot bulk-idle units that are in production (requires winding down the offtake)
        return err({
          code: SiteServiceError.UNIT_IN_PRODUCTION,
          message: `Cannot set in-production unit ${unit.unitNumber} to idle. Wind down the offtake first.`,
        });
      }

      updatedUnits.push({ ...unit, status: input.status, updatedAt: now, updatedBy });
      affectedSites.add(unit.siteId);
    }

    const savedUnits = await this.unitRepo.updateMany(updatedUnits);

    // Update site counts for all affected sites
    for (const siteId of affectedSites) {
      const site = await this.siteRepo.findById(siteId, tenantId);
      if (site) {
        const counts = await this.unitRepo.countBySite(siteId, tenantId);
        await this.siteRepo.update({
          ...site,
          activeUnits: counts.inProduction,
          idleUnits: counts.idle,
          updatedAt: now,
          updatedBy,
        });
      }
    }

    return ok(savedUnits);
  }

  // ==================== Helpers ====================

  private async generateSiteCode(tenantId: TenantId): Promise<string> {
    const sequence = await this.siteRepo.getNextSequence(tenantId);
    const year = new Date().getFullYear();
    return `SITE-${year}-${String(sequence).padStart(4, '0')}`;
  }
}
