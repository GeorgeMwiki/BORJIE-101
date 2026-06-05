/**
 * Mining-site domain models (public subpath barrel).
 *
 * Mining sites represent the physical estate locations managed on the
 * platform (pits, plants, alluvial blocks, tailings facilities). Units
 * are the operating subdivisions within a site. This barrel re-exports
 * the canonical `MiningSite` / `MiningUnit` / `Block` models and adds
 * the owner-account value model + input DTOs.
 */

import { BaseEntity, TenantScoped, Address, Money } from '../common';

// Canonical entity models (mining site / unit / block).
// `property` (site) and `block` each export their own
// calculate*UtilisationRate helpers, so block is namespaced to avoid a
// duplicate-symbol collision in this barrel.
export * from './property';
export * from './unit';
export * as Block from './block';

// ============================================================================
// Owner Account Entity
// ============================================================================

export interface OwnerAccount extends BaseEntity, TenantScoped {
  userId?: string; // Linked user for cockpit access
  name: string;
  type: OwnerType;
  contactInfo: OwnerContactInfo;
  bankDetails?: BankDetails;
  taxInfo?: TaxInfo;
  sites: string[]; // Mining-site IDs owned
  disbursementSettings: DisbursementSettings;
}

export type OwnerType = 'individual' | 'company' | 'cooperative' | 'trust';

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
  /** TRA Taxpayer Identification Number (TIN). */
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
// Input DTOs
// ============================================================================

export interface CreateMiningSiteInput {
  name: string;
  type: import('./property').MiningSiteType;
  address: Address;
  ownerId: string;
  managerId?: string;
  amenities?: string[];
}

export interface UpdateMiningSiteInput {
  name?: string;
  status?: import('./property').MiningSiteStatus;
  address?: Partial<Address>;
  managerId?: string;
  amenities?: string[];
}

export interface CreateMiningUnitInput {
  siteId: string;
  unitNumber: string;
  level?: number;
  type: import('./unit').MiningUnitType;
  oreGradeGramsPerTonne: number;
  recoveryPct: number;
  area?: number;
  operatingLevy: Money;
  bondAmount: Money;
  amenities?: string[];
}

export interface UpdateMiningUnitInput {
  unitNumber?: string;
  level?: number;
  type?: import('./unit').MiningUnitType;
  status?: import('./unit').MiningUnitStatus;
  oreGradeGramsPerTonne?: number;
  recoveryPct?: number;
  area?: number;
  operatingLevy?: Money;
  bondAmount?: Money;
  amenities?: string[];
}
