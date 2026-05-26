import { randomHex } from '../common/id-generator.js';
/**
 * Property domain service.
 *
 * Handles property and unit management for the BORJIE platform.
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
  type Property,
  type PropertyId,
  type PropertyType,
  type PropertyStatus,
  type OwnerId,
  type Address,
  type Unit,
  type UnitId,
  type UnitType,
  type UnitStatus,
  type Money,
  createProperty,
  createUnit,
  asPropertyId,
  asUnitId,
  ok,
  err,
  Block,
} from '@borjie/domain-models';
// Block namespace (exports asBlockId/createBlock/generateBlockCode/BlockId/BlockStatus)
// was split out of the top-level barrel in domain-models; re-alias the
// previously flat imports so the rest of this file keeps compiling without
// a broader refactor.
const { asBlockId, createBlock, generateBlockCode } = Block as unknown as {
  asBlockId: (id: string) => any;
  createBlock: (...args: any[]) => any;
  generateBlockCode: (propertyCode: string, sequence: number) => string;
};
type Block = ReturnType<typeof createBlock>;
type BlockId = ReturnType<typeof asBlockId>;
type BlockStatus = 'active' | 'inactive' | 'under_construction' | 'under_renovation' | 'demolished';
import type { EventBus } from '../common/events.js';
import { createEventEnvelope, generateEventId } from '../common/events.js';

// ============================================================================
// Error Types
// ============================================================================

export const PropertyServiceError = {
  PROPERTY_NOT_FOUND: 'PROPERTY_NOT_FOUND',
  PROPERTY_CODE_EXISTS: 'PROPERTY_CODE_EXISTS',
  UNIT_NOT_FOUND: 'UNIT_NOT_FOUND',
  UNIT_NUMBER_EXISTS: 'UNIT_NUMBER_EXISTS',
  UNIT_OCCUPIED: 'UNIT_OCCUPIED',
  INVALID_PROPERTY_DATA: 'INVALID_PROPERTY_DATA',
  INVALID_UNIT_DATA: 'INVALID_UNIT_DATA',
  CANNOT_DELETE_WITH_ACTIVE_LEASES: 'CANNOT_DELETE_WITH_ACTIVE_LEASES',
} as const;

export type PropertyServiceErrorCode = (typeof PropertyServiceError)[keyof typeof PropertyServiceError];

export interface PropertyServiceErrorResult {
  code: PropertyServiceErrorCode;
  message: string;
}

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface PropertyRepository {
  findById(id: PropertyId, tenantId: TenantId): Promise<Property | null>;
  findByCode(code: string, tenantId: TenantId): Promise<Property | null>;
  findMany(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Property>>;
  findByOwner(ownerId: OwnerId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Property>>;
  findByManager(managerId: UserId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Property>>;
  create(property: Property): Promise<Property>;
  update(property: Property): Promise<Property>;
  delete(id: PropertyId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  getNextSequence(tenantId: TenantId): Promise<number>;
}

export interface UnitRepository {
  findById(id: UnitId, tenantId: TenantId): Promise<Unit | null>;
  findByUnitNumber(unitNumber: string, propertyId: PropertyId, tenantId: TenantId): Promise<Unit | null>;
  findByProperty(propertyId: PropertyId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Unit>>;
  findByBlock(blockId: BlockId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Unit>>;
  findByStatus(status: UnitStatus, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Unit>>;
  findVacant(tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Unit>>;
  create(unit: Unit): Promise<Unit>;
  createMany(units: Unit[]): Promise<Unit[]>;
  update(unit: Unit): Promise<Unit>;
  updateMany(units: Unit[]): Promise<Unit[]>;
  delete(id: UnitId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  countByProperty(propertyId: PropertyId, tenantId: TenantId): Promise<{ total: number; occupied: number; vacant: number }>;
  countByBlock(blockId: BlockId, tenantId: TenantId): Promise<{ total: number; occupied: number; vacant: number }>;
}

export interface BlockRepository {
  findById(id: BlockId, tenantId: TenantId): Promise<Block | null>;
  findByBlockCode(blockCode: string, propertyId: PropertyId, tenantId: TenantId): Promise<Block | null>;
  findByProperty(propertyId: PropertyId, tenantId: TenantId, pagination?: PaginationParams): Promise<PaginatedResult<Block>>;
  create(block: Block): Promise<Block>;
  update(block: Block): Promise<Block>;
  delete(id: BlockId, tenantId: TenantId, deletedBy: UserId): Promise<void>;
  getNextSequence(propertyId: PropertyId, tenantId: TenantId): Promise<number>;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreatePropertyInput {
  name: string;
  code?: string;
  type: PropertyType;
  ownerId: OwnerId;
  address: Address;
  totalUnits?: number;
  yearBuilt?: number;
  totalArea?: number;
  amenities?: string[];
  description?: string;
  managerId?: UserId;
}

export interface UpdatePropertyInput {
  name?: string;
  status?: PropertyStatus;
  address?: Partial<Address>;
  totalUnits?: number;
  yearBuilt?: number;
  totalArea?: number;
  amenities?: string[];
  description?: string;
  managerId?: UserId | null;
}

export interface CreateUnitInput {
  unitNumber: string;
  floor: number;
  type: UnitType;
  bedrooms: number;
  bathrooms: number;
  monthlyRent: Money;
  depositAmount: Money;
  area?: number;
  amenities?: string[];
  description?: string;
}

export interface UpdateUnitInput {
  status?: UnitStatus;
  type?: UnitType;
  bedrooms?: number;
  bathrooms?: number;
  monthlyRent?: Money;
  depositAmount?: Money;
  area?: number;
  amenities?: string[];
  description?: string;
}

export interface CreateBlockInput {
  name: string;
  blockCode?: string;
  description?: string;
  floor?: number;
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
  floor: number;
  type: UnitType;
  bedrooms: number;
  bathrooms: number;
  monthlyRent: Money;
  depositAmount: Money;
  area?: number;
  amenities?: string[];
  blockId?: BlockId;
}

export interface BulkUpdateUnitStatusInput {
  unitIds: UnitId[];
  status: UnitStatus;
}

// ============================================================================
// Stats Types
// ============================================================================

export interface PropertyStats {
  propertyId: PropertyId;
  totalUnits: number;
  occupiedUnits: number;
  vacantUnits: number;
  occupancyRate: number;
  potentialMonthlyRevenue: Money;
  actualMonthlyRevenue: Money;
  revenueEfficiency: number;
}

export interface UnitAvailability {
  unitId: UnitId;
  propertyId: PropertyId;
  isAvailable: boolean;
  status: UnitStatus;
  currentLeaseId: string | null;
  leaseEndDate: string | null;
  availableFrom: string | null;
  monthlyRent: Money;
  depositAmount: Money;
}

export interface PropertyHealthScore {
  propertyId: PropertyId;
  overallScore: number; // 0-100
  occupancyScore: number; // 0-100 based on occupancy rate
  revenueScore: number; // 0-100 based on revenue efficiency
  maintenanceScore: number; // 0-100 based on open work orders
  complianceScore: number; // 0-100 based on inspection/compliance status
  factors: {
    occupancyRate: number;
    revenueEfficiency: number;
    vacantUnits: number;
    totalUnits: number;
    averageRent: number;
  };
  calculatedAt: string;
}

// ============================================================================
// Domain Events
// ============================================================================

export interface PropertyCreatedEvent {
  eventId: string;
  eventType: 'PropertyCreated';
  timestamp: string;
  tenantId: TenantId;
  correlationId: string;
  causationId: string | null;
  metadata: Record<string, unknown>;
  payload: {
    propertyId: PropertyId;
    name: string;
    code: string;
    type: PropertyType;
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
    unitId: UnitId;
    propertyId: PropertyId;
    unitNumber: string;
    type: UnitType;
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
    propertyId: PropertyId;
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
    propertyId: PropertyId;
    unitCount: number;
    unitIds: UnitId[];
  };
}

// ============================================================================
// Property Service Implementation
// ============================================================================

/**
 * Property and Unit management service.
 * Handles all CRUD operations and business logic for properties and units.
 */
export class PropertyService {
  constructor(
    private readonly propertyRepo: PropertyRepository,
    private readonly unitRepo: UnitRepository,
    private readonly eventBus: EventBus,
    private readonly blockRepo?: BlockRepository
  ) {}

  // ==================== Property Operations ====================

  /**
   * Create a new property.
   */
  async createProperty(
    tenantId: TenantId,
    input: CreatePropertyInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Property, PropertyServiceErrorResult>> {
    // Generate property code if not provided
    const code = input.code ?? await this.generatePropertyCode(tenantId);

    // Check code uniqueness
    const existing = await this.propertyRepo.findByCode(code, tenantId);
    if (existing) {
      return err({
        code: PropertyServiceError.PROPERTY_CODE_EXISTS,
        message: `Property with code ${code} already exists`,
      });
    }

    // Validate required fields
    if (!input.name || !input.type || !input.ownerId) {
      return err({
        code: PropertyServiceError.INVALID_PROPERTY_DATA,
        message: 'Name, type, and owner are required',
      });
    }

    const propertyId = asPropertyId(`prop_${Date.now()}_${randomHex(4)}`);

    const property = createProperty(propertyId, {
      tenantId,
      ownerId: input.ownerId,
      name: input.name,
      code,
      type: input.type,
      address: input.address,
      ...(input.totalUnits !== undefined ? { totalUnits: input.totalUnits } : {}),
      ...(input.yearBuilt !== undefined ? { yearBuilt: input.yearBuilt } : {}),
      ...(input.totalArea !== undefined ? { totalArea: input.totalArea } : {}),
      ...(input.amenities !== undefined ? { amenities: input.amenities } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
    }, createdBy);

    const savedProperty = await this.propertyRepo.create(property);

    // Publish event
    const event: PropertyCreatedEvent = {
      eventId: generateEventId(),
      eventType: 'PropertyCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      correlationId,
      causationId: null,
      metadata: {},
      payload: {
        propertyId: savedProperty.id,
        name: savedProperty.name,
        code: savedProperty.code,
        type: savedProperty.type,
        ownerId: savedProperty.ownerId,
      },
    };

    await this.eventBus.publish(createEventEnvelope(event, savedProperty.id, 'Property'));

    return ok(savedProperty);
  }

  /**
   * Get a property by ID.
   */
  async getProperty(propertyId: PropertyId, tenantId: TenantId): Promise<Property | null> {
    return this.propertyRepo.findById(propertyId, tenantId);
  }

  /**
   * Get a property by code.
   */
  async getPropertyByCode(code: string, tenantId: TenantId): Promise<Property | null> {
    return this.propertyRepo.findByCode(code, tenantId);
  }

  /**
   * List all properties for a tenant.
   */
  async listProperties(
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Property>> {
    return this.propertyRepo.findMany(tenantId, pagination);
  }

  /**
   * List properties by owner.
   */
  async listPropertiesByOwner(
    ownerId: OwnerId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Property>> {
    return this.propertyRepo.findByOwner(ownerId, tenantId, pagination);
  }

  /**
   * List properties by manager.
   */
  async listPropertiesByManager(
    managerId: UserId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Property>> {
    return this.propertyRepo.findByManager(managerId, tenantId, pagination);
  }

  /**
   * Update a property.
   */
  async updateProperty(
    propertyId: PropertyId,
    tenantId: TenantId,
    input: UpdatePropertyInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Property, PropertyServiceErrorResult>> {
    const property = await this.propertyRepo.findById(propertyId, tenantId);
    if (!property) {
      return err({
        code: PropertyServiceError.PROPERTY_NOT_FOUND,
        message: 'Property not found',
      });
    }

    const updatedProperty: Property = {
      ...property,
      name: input.name ?? property.name,
      status: input.status ?? property.status,
      address: input.address ? { ...property.address, ...input.address } : property.address,
      totalUnits: input.totalUnits ?? property.totalUnits,
      yearBuilt: input.yearBuilt ?? property.yearBuilt,
      totalArea: input.totalArea ?? property.totalArea,
      amenities: input.amenities ?? property.amenities,
      description: input.description ?? property.description,
      managerId: input.managerId !== undefined ? input.managerId : property.managerId,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    const savedProperty = await this.propertyRepo.update(updatedProperty);
    return ok(savedProperty);
  }

  /**
   * Delete a property (soft delete).
   */
  async deleteProperty(
    propertyId: PropertyId,
    tenantId: TenantId,
    deletedBy: UserId,
    correlationId: string
  ): Promise<Result<void, PropertyServiceErrorResult>> {
    const property = await this.propertyRepo.findById(propertyId, tenantId);
    if (!property) {
      return err({
        code: PropertyServiceError.PROPERTY_NOT_FOUND,
        message: 'Property not found',
      });
    }

    // Check for active leases - would need LeaseRepository
    // For now, just delete
    await this.propertyRepo.delete(propertyId, tenantId, deletedBy);
    return ok(undefined);
  }

  /**
   * Assign a manager to a property.
   */
  async assignManager(
    propertyId: PropertyId,
    tenantId: TenantId,
    managerId: UserId | null,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Property, PropertyServiceErrorResult>> {
    return this.updateProperty(
      propertyId,
      tenantId,
      { managerId },
      updatedBy,
      correlationId
    );
  }

  /**
   * Get property statistics including occupancy and unit counts.
   */
  async getPropertyStats(
    propertyId: PropertyId,
    tenantId: TenantId
  ): Promise<Result<PropertyStats, PropertyServiceErrorResult>> {
    const property = await this.propertyRepo.findById(propertyId, tenantId);
    if (!property) {
      return err({
        code: PropertyServiceError.PROPERTY_NOT_FOUND,
        message: 'Property not found',
      });
    }

    const counts = await this.unitRepo.countByProperty(propertyId, tenantId);
    const occupancyRate = counts.total > 0 
      ? Math.round((counts.occupied / counts.total) * 100) 
      : 0;

    // Get units for revenue calculation
    const units = await this.unitRepo.findByProperty(propertyId, tenantId);
    let potentialMonthlyRevenue = 0;
    let actualMonthlyRevenue = 0;

    for (const unit of units.items) {
      potentialMonthlyRevenue += unit.monthlyRent.amount;
      if (unit.status === 'occupied') {
        actualMonthlyRevenue += unit.monthlyRent.amount;
      }
    }

    const stats: PropertyStats = {
      propertyId,
      totalUnits: counts.total,
      occupiedUnits: counts.occupied,
      vacantUnits: counts.vacant,
      occupancyRate,
      potentialMonthlyRevenue: {
        amount: potentialMonthlyRevenue,
        currency: units.items[0]?.monthlyRent.currency ?? 'USD',
      } as Money,
      actualMonthlyRevenue: {
        amount: actualMonthlyRevenue,
        currency: units.items[0]?.monthlyRent.currency ?? 'USD',
      } as Money,
      revenueEfficiency: potentialMonthlyRevenue > 0 
        ? Math.round((actualMonthlyRevenue / potentialMonthlyRevenue) * 100)
        : 0,
    };

    return ok(stats);
  }

  // ==================== Unit Operations ====================

  /**
   * Create a new unit within a property.
   */
  async createUnit(
    propertyId: PropertyId,
    tenantId: TenantId,
    input: CreateUnitInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Unit, PropertyServiceErrorResult>> {
    // Verify property exists
    const property = await this.propertyRepo.findById(propertyId, tenantId);
    if (!property) {
      return err({
        code: PropertyServiceError.PROPERTY_NOT_FOUND,
        message: 'Property not found',
      });
    }

    // Check unit number uniqueness within property
    const existing = await this.unitRepo.findByUnitNumber(input.unitNumber, propertyId, tenantId);
    if (existing) {
      return err({
        code: PropertyServiceError.UNIT_NUMBER_EXISTS,
        message: `Unit ${input.unitNumber} already exists in this property`,
      });
    }

    // Validate required fields
    if (!input.unitNumber || !input.type || !input.monthlyRent) {
      return err({
        code: PropertyServiceError.INVALID_UNIT_DATA,
        message: 'Unit number, type, and monthly rent are required',
      });
    }

    const unitId = asUnitId(`unit_${Date.now()}_${randomHex(4)}`);

    const unit = createUnit(unitId, {
      tenantId,
      propertyId,
      unitNumber: input.unitNumber,
      floor: input.floor,
      type: input.type,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      monthlyRent: input.monthlyRent,
      depositAmount: input.depositAmount,
      ...(input.area !== undefined ? { area: input.area } : {}),
      ...(input.amenities !== undefined ? { amenities: input.amenities } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
    }, createdBy);

    const savedUnit = await this.unitRepo.create(unit);

    // Update property unit counts
    const counts = await this.unitRepo.countByProperty(propertyId, tenantId);
    await this.propertyRepo.update({
      ...property,
      totalUnits: counts.total,
      occupiedUnits: counts.occupied,
      vacantUnits: counts.vacant,
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
        propertyId,
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
  async getUnit(unitId: UnitId, tenantId: TenantId): Promise<Unit | null> {
    return this.unitRepo.findById(unitId, tenantId);
  }

  /**
   * List units by property.
   */
  async listUnitsByProperty(
    propertyId: PropertyId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Unit>> {
    return this.unitRepo.findByProperty(propertyId, tenantId, pagination);
  }

  /**
   * List vacant units across all properties.
   */
  async listVacantUnits(
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Unit>> {
    return this.unitRepo.findVacant(tenantId, pagination);
  }

  /**
   * Update a unit.
   */
  async updateUnit(
    unitId: UnitId,
    tenantId: TenantId,
    input: UpdateUnitInput,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Unit, PropertyServiceErrorResult>> {
    const unit = await this.unitRepo.findById(unitId, tenantId);
    if (!unit) {
      return err({
        code: PropertyServiceError.UNIT_NOT_FOUND,
        message: 'Unit not found',
      });
    }

    const updatedUnit: Unit = {
      ...unit,
      status: input.status ?? unit.status,
      type: input.type ?? unit.type,
      bedrooms: input.bedrooms ?? unit.bedrooms,
      bathrooms: input.bathrooms ?? unit.bathrooms,
      monthlyRent: input.monthlyRent ?? unit.monthlyRent,
      depositAmount: input.depositAmount ?? unit.depositAmount,
      area: input.area ?? unit.area,
      amenities: input.amenities ?? unit.amenities,
      description: input.description ?? unit.description,
      updatedAt: new Date().toISOString(),
      updatedBy,
    };

    const savedUnit = await this.unitRepo.update(updatedUnit);

    // Update property unit counts if status changed
    if (input.status) {
      const property = await this.propertyRepo.findById(unit.propertyId, tenantId);
      if (property) {
        const counts = await this.unitRepo.countByProperty(unit.propertyId, tenantId);
        await this.propertyRepo.update({
          ...property,
          occupiedUnits: counts.occupied,
          vacantUnits: counts.vacant,
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
    unitId: UnitId,
    tenantId: TenantId,
    status: UnitStatus,
    updatedBy: UserId,
    correlationId: string
  ): Promise<Result<Unit, PropertyServiceErrorResult>> {
    return this.updateUnit(unitId, tenantId, { status }, updatedBy, correlationId);
  }

  /**
   * Delete a unit (soft delete).
   */
  async deleteUnit(
    unitId: UnitId,
    tenantId: TenantId,
    deletedBy: UserId,
    correlationId: string
  ): Promise<Result<void, PropertyServiceErrorResult>> {
    const unit = await this.unitRepo.findById(unitId, tenantId);
    if (!unit) {
      return err({
        code: PropertyServiceError.UNIT_NOT_FOUND,
        message: 'Unit not found',
      });
    }

    // Check if unit is occupied
    if (unit.status === 'occupied') {
      return err({
        code: PropertyServiceError.UNIT_OCCUPIED,
        message: 'Cannot delete an occupied unit',
      });
    }

    await this.unitRepo.delete(unitId, tenantId, deletedBy);

    // Update property counts
    const property = await this.propertyRepo.findById(unit.propertyId, tenantId);
    if (property) {
      const counts = await this.unitRepo.countByProperty(unit.propertyId, tenantId);
      await this.propertyRepo.update({
        ...property,
        totalUnits: counts.total,
        occupiedUnits: counts.occupied,
        vacantUnits: counts.vacant,
        updatedAt: new Date().toISOString(),
        updatedBy: deletedBy,
      });
    }

    return ok(undefined);
  }

  // ==================== Block Operations ====================

  /**
   * Create a block within a property.
   */
  async createBlock(
    propertyId: PropertyId,
    tenantId: TenantId,
    input: CreateBlockInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Block, PropertyServiceErrorResult>> {
    if (!this.blockRepo) {
      return err({ code: PropertyServiceError.INVALID_PROPERTY_DATA, message: 'Block repository not configured' });
    }

    const property = await this.propertyRepo.findById(propertyId, tenantId);
    if (!property) {
      return err({ code: PropertyServiceError.PROPERTY_NOT_FOUND, message: 'Property not found' });
    }

    // Generate block code if not provided
    const sequence = await this.blockRepo.getNextSequence(propertyId, tenantId);
    const blockCode = input.blockCode ?? generateBlockCode(property.code, sequence);

    // Check uniqueness
    const existing = await this.blockRepo.findByBlockCode(blockCode, propertyId, tenantId);
    if (existing) {
      return err({ code: PropertyServiceError.PROPERTY_CODE_EXISTS, message: `Block code ${blockCode} already exists` });
    }

    const blockId = asBlockId(`blk_${Date.now()}_${randomHex(4)}`);
    const block = createBlock(blockId, {
      tenantId,
      propertyId,
      blockCode,
      name: input.name,
      description: input.description,
      floor: input.floor,
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
      payload: { blockId: savedBlock.id, propertyId, blockCode: savedBlock.blockCode, name: savedBlock.name },
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
   * List blocks by property.
   */
  async listBlocksByProperty(
    propertyId: PropertyId,
    tenantId: TenantId,
    pagination?: PaginationParams
  ): Promise<PaginatedResult<Block>> {
    if (!this.blockRepo) {
      return { items: [], total: 0, limit: pagination?.limit ?? 50, offset: pagination?.offset ?? 0, hasMore: false };
    }
    return this.blockRepo.findByProperty(propertyId, tenantId, pagination);
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
  ): Promise<Result<Block, PropertyServiceErrorResult>> {
    if (!this.blockRepo) {
      return err({ code: PropertyServiceError.INVALID_PROPERTY_DATA, message: 'Block repository not configured' });
    }

    const block = await this.blockRepo.findById(blockId, tenantId);
    if (!block) {
      return err({ code: PropertyServiceError.PROPERTY_NOT_FOUND, message: 'Block not found' });
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
  ): Promise<Result<void, PropertyServiceErrorResult>> {
    if (!this.blockRepo) {
      return err({ code: PropertyServiceError.INVALID_PROPERTY_DATA, message: 'Block repository not configured' });
    }

    const block = await this.blockRepo.findById(blockId, tenantId);
    if (!block) {
      return err({ code: PropertyServiceError.PROPERTY_NOT_FOUND, message: 'Block not found' });
    }

    // Check for occupied units in block
    const counts = await this.unitRepo.countByBlock(blockId, tenantId);
    if (counts.occupied > 0) {
      return err({
        code: PropertyServiceError.CANNOT_DELETE_WITH_ACTIVE_LEASES,
        message: 'Cannot delete block with occupied units',
      });
    }

    await this.blockRepo.delete(blockId, tenantId, deletedBy);
    return ok(undefined);
  }

  // ==================== Health Scoring ====================

  /**
   * Calculate a property health score (0-100) covering occupancy, revenue,
   * maintenance and compliance factors.
   */
  async calculatePropertyHealthScore(
    propertyId: PropertyId,
    tenantId: TenantId
  ): Promise<Result<PropertyHealthScore, PropertyServiceErrorResult>> {
    const property = await this.propertyRepo.findById(propertyId, tenantId);
    if (!property) {
      return err({ code: PropertyServiceError.PROPERTY_NOT_FOUND, message: 'Property not found' });
    }

    const counts = await this.unitRepo.countByProperty(propertyId, tenantId);
    const units = await this.unitRepo.findByProperty(propertyId, tenantId);

    const occupancyRate = counts.total > 0 ? (counts.occupied / counts.total) * 100 : 0;
    const occupancyScore = Math.min(100, Math.round(occupancyRate));

    // Revenue efficiency
    let potentialRevenue = 0;
    let actualRevenue = 0;
    for (const unit of units.items) {
      potentialRevenue += unit.monthlyRent.amount;
      if (unit.status === 'occupied') {
        actualRevenue += unit.monthlyRent.amount;
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
      occupancyScore * 0.35 +
      revenueScore * 0.30 +
      maintenanceScore * 0.20 +
      complianceScore * 0.15
    );

    const averageRent = counts.total > 0 ? Math.round(potentialRevenue / counts.total) : 0;

    const healthScore: PropertyHealthScore = {
      propertyId,
      overallScore,
      occupancyScore,
      revenueScore,
      maintenanceScore,
      complianceScore,
      factors: {
        occupancyRate: Math.round(occupancyRate * 10) / 10,
        revenueEfficiency: Math.round(revenueEfficiency * 10) / 10,
        vacantUnits: counts.vacant,
        totalUnits: counts.total,
        averageRent,
      },
      calculatedAt: new Date().toISOString(),
    };

    return ok(healthScore);
  }

  // ==================== Bulk Unit Operations ====================

  /**
   * Create multiple units at once for a property.
   * Generates sequential unit numbers using a prefix.
   */
  async bulkCreateUnits(
    propertyId: PropertyId,
    tenantId: TenantId,
    input: BulkCreateUnitInput,
    createdBy: UserId,
    correlationId: string
  ): Promise<Result<Unit[], PropertyServiceErrorResult>> {
    const property = await this.propertyRepo.findById(propertyId, tenantId);
    if (!property) {
      return err({ code: PropertyServiceError.PROPERTY_NOT_FOUND, message: 'Property not found' });
    }

    if (input.count <= 0 || input.count > 200) {
      return err({ code: PropertyServiceError.INVALID_UNIT_DATA, message: 'Count must be between 1 and 200' });
    }

    const units: Unit[] = [];
    for (let i = 0; i < input.count; i++) {
      const unitNumber = `${input.prefix}${String(input.startNumber + i).padStart(2, '0')}`;

      // Check uniqueness
      const existing = await this.unitRepo.findByUnitNumber(unitNumber, propertyId, tenantId);
      if (existing) {
        return err({
          code: PropertyServiceError.UNIT_NUMBER_EXISTS,
          message: `Unit ${unitNumber} already exists in this property`,
        });
      }

      const unitId = asUnitId(`unit_${Date.now()}_${randomHex(4)}_${i}`);
      const unit = createUnit(unitId, {
        tenantId,
        propertyId,
        unitNumber,
        floor: input.floor,
        type: input.type,
        bedrooms: input.bedrooms,
        bathrooms: input.bathrooms,
        monthlyRent: input.monthlyRent,
        depositAmount: input.depositAmount,
        ...(input.area !== undefined ? { area: input.area } : {}),
        ...(input.amenities !== undefined ? { amenities: input.amenities } : {}),
      }, createdBy);
      units.push(unit);
    }

    const savedUnits = await this.unitRepo.createMany(units);

    // Update property counts
    const counts = await this.unitRepo.countByProperty(propertyId, tenantId);
    await this.propertyRepo.update({
      ...property,
      totalUnits: counts.total,
      occupiedUnits: counts.occupied,
      vacantUnits: counts.vacant,
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
        propertyId,
        unitCount: savedUnits.length,
        unitIds: savedUnits.map(u => u.id),
      },
    };
    await this.eventBus.publish(createEventEnvelope(event, propertyId, 'Property'));

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
  ): Promise<Result<Unit[], PropertyServiceErrorResult>> {
    if (input.unitIds.length === 0) {
      return err({ code: PropertyServiceError.INVALID_UNIT_DATA, message: 'No unit IDs provided' });
    }
    if (input.unitIds.length > 200) {
      return err({ code: PropertyServiceError.INVALID_UNIT_DATA, message: 'Cannot update more than 200 units at once' });
    }

    const updatedUnits: Unit[] = [];
    const now = new Date().toISOString();
    const affectedProperties = new Set<PropertyId>();

    for (const unitId of input.unitIds) {
      const unit = await this.unitRepo.findById(unitId, tenantId);
      if (!unit) {
        return err({ code: PropertyServiceError.UNIT_NOT_FOUND, message: `Unit ${unitId} not found` });
      }

      if (input.status === 'vacant' && unit.status === 'occupied') {
        // Cannot bulk-vacate occupied units (requires lease termination)
        return err({
          code: PropertyServiceError.UNIT_OCCUPIED,
          message: `Cannot set occupied unit ${unit.unitNumber} to vacant. Terminate the lease first.`,
        });
      }

      updatedUnits.push({ ...unit, status: input.status, updatedAt: now, updatedBy });
      affectedProperties.add(unit.propertyId);
    }

    const savedUnits = await this.unitRepo.updateMany(updatedUnits);

    // Update property counts for all affected properties
    for (const propertyId of affectedProperties) {
      const property = await this.propertyRepo.findById(propertyId, tenantId);
      if (property) {
        const counts = await this.unitRepo.countByProperty(propertyId, tenantId);
        await this.propertyRepo.update({
          ...property,
          occupiedUnits: counts.occupied,
          vacantUnits: counts.vacant,
          updatedAt: now,
          updatedBy,
        });
      }
    }

    return ok(savedUnits);
  }

  // ==================== Helpers ====================

  private async generatePropertyCode(tenantId: TenantId): Promise<string> {
    const sequence = await this.propertyRepo.getNextSequence(tenantId);
    const year = new Date().getFullYear();
    return `PROP-${year}-${String(sequence).padStart(4, '0')}`;
  }
}
