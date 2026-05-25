/**
 * Property domain models.
 *
 * Properties represent real estate assets managed on the platform.
 * Units are the rentable subdivisions within properties.
 */

import { BaseEntity, TenantScoped, Address, Money } from '../common';

// ============================================================================
// Property Entity
// ============================================================================

export interface Property extends BaseEntity, TenantScoped {
  name: string;
  type: PropertyType;
  status: PropertyStatus;
  address: Address;
  ownerId: string; // Reference to owner account
  managerId?: string; // Reference to assigned manager
  totalUnits: number;
  occupiedUnits: number;
  amenities: string[];
  images: PropertyImage[];
  metadata?: Record<string, unknown>;
}

export type PropertyType =
  | 'residential_apartment'
  | 'residential_house'
  | 'commercial_office'
  | 'commercial_retail'
  | 'mixed_use'
  | 'industrial';

export type PropertyStatus = 'active' | 'inactive' | 'under_renovation' | 'sold';

export interface PropertyImage {
  id: string;
  url: string;
  caption?: string;
  isPrimary: boolean;
  uploadedAt: Date;
}

// ============================================================================
// Unit Entity
// ============================================================================

export interface Unit extends BaseEntity, TenantScoped {
  propertyId: string;
  unitNumber: string;
  floor?: number;
  type: UnitType;
  status: UnitStatus;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  rentAmount: Money;
  depositAmount: Money;
  amenities: string[];
  images: PropertyImage[];
  currentLeaseId?: string;
  metadata?: Record<string, unknown>;
}

export type UnitType =
  | 'studio'
  | 'one_bedroom'
  | 'two_bedroom'
  | 'three_bedroom'
  | 'penthouse'
  | 'office_space'
  | 'retail_shop'
  | 'warehouse';

export type UnitStatus = 'available' | 'occupied' | 'reserved' | 'maintenance' | 'unavailable';

// ============================================================================
// Owner Account Entity
// ============================================================================

export interface OwnerAccount extends BaseEntity, TenantScoped {
  userId?: string; // Linked user for portal access
  name: string;
  type: OwnerType;
  contactInfo: OwnerContactInfo;
  bankDetails?: BankDetails;
  taxInfo?: TaxInfo;
  properties: string[]; // Property IDs owned
  disbursementSettings: DisbursementSettings;
}

export type OwnerType = 'individual' | 'company' | 'trust';

export interface OwnerContactInfo {
  primaryEmail: string;
  primaryPhone: string;
  alternativeEmail?: string;
  alternativePhone?: string;
  address?: Address;
}

export interface BankDetails {
  accountName: string;
  bankName: string;
  accountNumber: string;
  branchCode?: string;
  swiftCode?: string;
}

export interface TaxInfo {
  taxId: string;
  vatRegistered: boolean;
  vatNumber?: string;
}

export interface DisbursementSettings {
  frequency: 'monthly' | 'bi_weekly' | 'weekly';
  dayOfMonth?: number;
  minimumAmount?: Money;
  autoDisburse: boolean;
}

// ============================================================================
// DTOs
// ============================================================================

export interface CreatePropertyInput {
  name: string;
  type: PropertyType;
  address: Address;
  ownerId: string;
  managerId?: string;
  amenities?: string[];
}

export interface UpdatePropertyInput {
  name?: string;
  status?: PropertyStatus;
  address?: Partial<Address>;
  managerId?: string;
  amenities?: string[];
}

export interface CreateUnitInput {
  propertyId: string;
  unitNumber: string;
  floor?: number;
  type: UnitType;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  rentAmount: Money;
  depositAmount: Money;
  amenities?: string[];
}

export interface UpdateUnitInput {
  unitNumber?: string;
  floor?: number;
  type?: UnitType;
  status?: UnitStatus;
  bedrooms?: number;
  bathrooms?: number;
  squareMeters?: number;
  rentAmount?: Money;
  depositAmount?: Money;
  amenities?: string[];
}
