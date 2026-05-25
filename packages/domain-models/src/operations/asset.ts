/**
 * Asset domain model
 * Represents physical assets within properties and units
 */

import { z } from 'zod';
import type {
  TenantId,
  UserId,
  PropertyId,
  UnitId,
  EntityMetadata,
  ISOTimestamp,
  Brand,
} from '../common/types';
import {
  AssetStatus,
  AssetStatusSchema,
  AssetCondition,
  AssetConditionSchema,
} from '../common/enums';

// ============================================================================
// Type Aliases
// ============================================================================

export type AssetId = Brand<string, 'AssetId'>;

export function asAssetId(id: string): AssetId {
  return id as AssetId;
}

// ============================================================================
// Enums and Schemas
// ============================================================================

export const AssetCategorySchema = z.enum([
  'hvac',
  'plumbing',
  'electrical',
  'appliance',
  'furniture',
  'structural',
  'safety',
  'technology',
  'landscaping',
  'security',
  'other',
]);
export type AssetCategory = z.infer<typeof AssetCategorySchema>;

export const DepreciationMethodSchema = z.enum([
  'straight_line',
  'declining_balance',
  'sum_of_years',
  'units_of_production',
  'none',
]);
export type DepreciationMethod = z.infer<typeof DepreciationMethodSchema>;

// ============================================================================
// Nested Schemas
// ============================================================================

export const AssetSpecificationSchema = z.object({
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  serialNumber: z.string().optional(),
  dimensions: z.object({
    width: z.number().optional(),
    height: z.number().optional(),
    depth: z.number().optional(),
    unit: z.string().default('cm'),
  }).optional(),
  weight: z.object({
    value: z.number(),
    unit: z.string().default('kg'),
  }).optional(),
  color: z.string().optional(),
  material: z.string().optional(),
  capacity: z.string().optional(),
  powerRating: z.string().optional(),
  energyRating: z.string().optional(),
  additionalSpecs: z.record(z.string(), z.unknown()).default({}),
});
export type AssetSpecification = z.infer<typeof AssetSpecificationSchema>;

export const MaintenanceScheduleSchema = z.object({
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'semi_annually', 'annually']),
  lastMaintenanceDate: z.string().datetime().nullable(),
  nextMaintenanceDate: z.string().datetime().nullable(),
  maintenanceNotes: z.string().optional(),
  assignedVendorId: z.string().optional(),
});
export type MaintenanceSchedule = z.infer<typeof MaintenanceScheduleSchema>;

export const MaintenanceRecordSchema = z.object({
  date: z.string().datetime(),
  type: z.enum(['preventive', 'corrective', 'inspection']),
  description: z.string(),
  performedBy: z.string(),
  vendorId: z.string().optional(),
  workOrderId: z.string().optional(),
  cost: z.number().optional(),
  currency: z.string().default('USD'),
  notes: z.string().optional(),
});
export type MaintenanceRecord = z.infer<typeof MaintenanceRecordSchema>;

export const WarrantyInfoSchema = z.object({
  provider: z.string(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  coverageType: z.string(),
  termsUrl: z.string().url().optional(),
  claimContact: z.string().optional(),
  notes: z.string().optional(),
});
export type WarrantyInfo = z.infer<typeof WarrantyInfoSchema>;

// ============================================================================
// Asset Zod Schema
// ============================================================================

export const AssetSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  propertyId: z.string(),
  unitId: z.string().nullable(),
  
  // Identification
  assetCode: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  
  // Classification
  category: AssetCategorySchema,
  subcategory: z.string().nullable(),
  
  // Status
  status: AssetStatusSchema,
  condition: AssetConditionSchema,
  conditionNotes: z.string().nullable(),
  lastConditionAssessment: z.string().datetime().nullable(),
  
  // Location
  location: z.string().nullable(),
  floor: z.string().nullable(),
  room: z.string().nullable(),
  
  // Specifications
  specifications: AssetSpecificationSchema.nullable(),
  
  // Purchase Information
  purchaseDate: z.string().datetime().nullable(),
  purchasePrice: z.number().nullable(),
  purchaseCurrency: z.string().default('USD'),
  supplier: z.string().nullable(),
  purchaseOrderNumber: z.string().nullable(),
  receiptUrl: z.string().url().nullable(),
  
  // Lifecycle
  installationDate: z.string().datetime().nullable(),
  expectedLifeYears: z.number().nullable(),
  endOfLifeDate: z.string().datetime().nullable(),
  
  // Depreciation
  currentValue: z.number().nullable(),
  depreciationMethod: DepreciationMethodSchema.nullable(),
  salvageValue: z.number().nullable(),
  
  // Maintenance
  maintenanceSchedule: MaintenanceScheduleSchema.nullable(),
  maintenanceHistory: z.array(MaintenanceRecordSchema).default([]),
  
  // Warranty
  warranty: WarrantyInfoSchema.nullable(),
  
  // Documentation
  photos: z.array(z.string()).default([]),
  documents: z.array(z.object({
    name: z.string(),
    url: z.string().url(),
    type: z.string(),
    uploadedAt: z.string().datetime(),
  })).default([]),
  
  // Tracking
  qrCode: z.string().nullable(),
  barcode: z.string().nullable(),
  rfidTag: z.string().nullable(),
  
  // Disposal
  disposedAt: z.string().datetime().nullable(),
  disposalMethod: z.string().nullable(),
  disposalReason: z.string().nullable(),
  disposalPrice: z.number().nullable(),
  disposedBy: z.string().nullable(),
  
  // Notes
  notes: z.string().nullable(),
  
  // Metadata
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export type AssetData = z.infer<typeof AssetSchema>;

// ============================================================================
// Asset Interface
// ============================================================================

export interface Asset extends EntityMetadata {
  readonly id: AssetId;
  readonly tenantId: TenantId;
  readonly propertyId: PropertyId;
  readonly unitId: UnitId | null;
  
  readonly assetCode: string;
  readonly name: string;
  readonly description: string | null;
  
  readonly category: AssetCategory;
  readonly subcategory: string | null;
  
  readonly status: AssetStatus;
  readonly condition: AssetCondition;
  readonly conditionNotes: string | null;
  readonly lastConditionAssessment: ISOTimestamp | null;
  
  readonly location: string | null;
  readonly floor: string | null;
  readonly room: string | null;
  
  readonly specifications: AssetSpecification | null;
  
  readonly purchaseDate: ISOTimestamp | null;
  readonly purchasePrice: number | null;
  readonly purchaseCurrency: string;
  readonly supplier: string | null;
  readonly purchaseOrderNumber: string | null;
  readonly receiptUrl: string | null;
  
  readonly installationDate: ISOTimestamp | null;
  readonly expectedLifeYears: number | null;
  readonly endOfLifeDate: ISOTimestamp | null;
  
  readonly currentValue: number | null;
  readonly depreciationMethod: DepreciationMethod | null;
  readonly salvageValue: number | null;
  
  readonly maintenanceSchedule: MaintenanceSchedule | null;
  readonly maintenanceHistory: readonly MaintenanceRecord[];
  
  readonly warranty: WarrantyInfo | null;
  
  readonly photos: readonly string[];
  readonly documents: readonly {
    name: string;
    url: string;
    type: string;
    uploadedAt: ISOTimestamp;
  }[];
  
  readonly qrCode: string | null;
  readonly barcode: string | null;
  readonly rfidTag: string | null;
  
  readonly disposedAt: ISOTimestamp | null;
  readonly disposalMethod: string | null;
  readonly disposalReason: string | null;
  readonly disposalPrice: number | null;
  readonly disposedBy: UserId | null;
  
  readonly notes: string | null;
  
  readonly metadata: Record<string, unknown>;
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createAsset(
  id: AssetId,
  data: {
    tenantId: TenantId;
    propertyId: PropertyId;
    assetCode: string;
    name: string;
    category: AssetCategory;
    unitId?: UnitId;
    description?: string;
    subcategory?: string;
    condition?: AssetCondition;
    location?: string;
    floor?: string;
    room?: string;
    specifications?: AssetSpecification;
    purchaseDate?: Date;
    purchasePrice?: number;
    purchaseCurrency?: string;
    supplier?: string;
    warranty?: WarrantyInfo;
  },
  createdBy: UserId
): Asset {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    propertyId: data.propertyId,
    unitId: data.unitId ?? null,
    
    assetCode: data.assetCode,
    name: data.name,
    description: data.description ?? null,
    
    category: data.category,
    subcategory: data.subcategory ?? null,
    
    status: 'active',
    condition: data.condition ?? 'good',
    conditionNotes: null,
    lastConditionAssessment: now,
    
    location: data.location ?? null,
    floor: data.floor ?? null,
    room: data.room ?? null,
    
    specifications: data.specifications ?? null,
    
    purchaseDate: data.purchaseDate?.toISOString() ?? null,
    purchasePrice: data.purchasePrice ?? null,
    purchaseCurrency: data.purchaseCurrency ?? 'USD',
    supplier: data.supplier ?? null,
    purchaseOrderNumber: null,
    receiptUrl: null,
    
    installationDate: null,
    expectedLifeYears: null,
    endOfLifeDate: null,
    
    currentValue: data.purchasePrice ?? null,
    depreciationMethod: null,
    salvageValue: null,
    
    maintenanceSchedule: null,
    maintenanceHistory: [],
    
    warranty: data.warranty ?? null,
    
    photos: [],
    documents: [],
    
    qrCode: null,
    barcode: null,
    rfidTag: null,
    
    disposedAt: null,
    disposalMethod: null,
    disposalReason: null,
    disposalPrice: null,
    disposedBy: null,
    
    notes: null,
    
    metadata: {},
    
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
  };
}

// ============================================================================
// Business Logic Functions
// ============================================================================

export function updateCondition(
  asset: Asset,
  condition: AssetCondition,
  notes: string | undefined,
  updatedBy: UserId
): Asset {
  const now = new Date().toISOString();
  return {
    ...asset,
    condition,
    conditionNotes: notes ?? asset.conditionNotes,
    lastConditionAssessment: now,
    updatedAt: now,
    updatedBy,
  };
}

export function addMaintenanceRecord(
  asset: Asset,
  record: MaintenanceRecord,
  updatedBy: UserId
): Asset {
  const now = new Date().toISOString();
  const newHistory = [...asset.maintenanceHistory, record];
  
  // Update schedule if exists
  const updatedSchedule = asset.maintenanceSchedule
    ? {
        ...asset.maintenanceSchedule,
        lastMaintenanceDate: record.date,
        nextMaintenanceDate: calculateNextMaintenanceDate(
          new Date(record.date),
          asset.maintenanceSchedule.frequency
        ).toISOString(),
      }
    : null;

  return {
    ...asset,
    maintenanceHistory: newHistory,
    maintenanceSchedule: updatedSchedule,
    updatedAt: now,
    updatedBy,
  };
}

export function setMaintenanceSchedule(
  asset: Asset,
  schedule: MaintenanceSchedule,
  updatedBy: UserId
): Asset {
  const now = new Date().toISOString();
  return {
    ...asset,
    maintenanceSchedule: schedule,
    updatedAt: now,
    updatedBy,
  };
}

export function calculateNextMaintenanceDate(lastDate: Date, frequency: MaintenanceSchedule['frequency']): Date {
  const next = new Date(lastDate);
  switch (frequency) {
    case 'daily':
      next.setDate(next.getDate() + 1);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + 1);
      break;
    case 'quarterly':
      next.setMonth(next.getMonth() + 3);
      break;
    case 'semi_annually':
      next.setMonth(next.getMonth() + 6);
      break;
    case 'annually':
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}

export function retireAsset(
  asset: Asset,
  reason: string | undefined,
  updatedBy: UserId
): Asset {
  if (asset.status === 'disposed') {
    throw new Error('Asset is already disposed');
  }
  const now = new Date().toISOString();
  return {
    ...asset,
    status: 'retired',
    notes: reason ? `Retired: ${reason}` : asset.notes,
    updatedAt: now,
    updatedBy,
  };
}

export function disposeAsset(
  asset: Asset,
  data: {
    method: string;
    reason: string;
    price?: number;
  },
  disposedBy: UserId
): Asset {
  const now = new Date().toISOString();
  return {
    ...asset,
    status: 'disposed',
    disposedAt: now,
    disposalMethod: data.method,
    disposalReason: data.reason,
    disposalPrice: data.price ?? null,
    disposedBy,
    updatedAt: now,
    updatedBy: disposedBy,
  };
}

export function isMaintenanceDue(asset: Asset): boolean {
  if (!asset.maintenanceSchedule?.nextMaintenanceDate) return false;
  return new Date(asset.maintenanceSchedule.nextMaintenanceDate) <= new Date();
}

export function isWarrantyValid(asset: Asset): boolean {
  if (!asset.warranty) return false;
  return new Date(asset.warranty.endDate) > new Date();
}

export function calculateDepreciation(asset: Asset): number | null {
  if (!asset.purchasePrice || !asset.depreciationMethod || !asset.purchaseDate) {
    return null;
  }
  
  const purchaseDate = new Date(asset.purchaseDate);
  const yearsOwned = (Date.now() - purchaseDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  const lifeYears = asset.expectedLifeYears ?? 10;
  const salvage = asset.salvageValue ?? 0;
  
  if (asset.depreciationMethod === 'straight_line') {
    const annualDepreciation = (asset.purchasePrice - salvage) / lifeYears;
    return Math.max(salvage, asset.purchasePrice - (annualDepreciation * yearsOwned));
  }
  
  // For other methods, return null (would need more complex calculation)
  return null;
}

export function addPhoto(
  asset: Asset,
  photoUrl: string,
  updatedBy: UserId
): Asset {
  const now = new Date().toISOString();
  return {
    ...asset,
    photos: [...asset.photos, photoUrl],
    updatedAt: now,
    updatedBy,
  };
}

export function generateAssetCode(
  propertyCode: string,
  category: AssetCategory,
  sequenceNumber: number
): string {
  const categoryPrefix = category.slice(0, 3).toUpperCase();
  const paddedSequence = sequenceNumber.toString().padStart(4, '0');
  return `${propertyCode}-${categoryPrefix}-${paddedSequence}`;
}
