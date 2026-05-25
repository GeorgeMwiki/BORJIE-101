/**
 * Vendor domain model
 * External service providers for maintenance
 */

import type { Brand, TenantId, UserId, EntityMetadata, SoftDeletable, ISOTimestamp } from '../common/types';
import type { Money } from '../common/money';
import type { WorkOrderCategory } from './work-order';

export type VendorId = Brand<string, 'VendorId'>;

export function asVendorId(id: string): VendorId {
  return id as VendorId;
}

/** Vendor status */
export type VendorStatus = 'active' | 'inactive' | 'pending_approval' | 'suspended';

/** Vendor type */
export type VendorType = 'individual' | 'company';

/** Vendor contact */
export interface VendorContact {
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly isPrimary: boolean;
}

/** Vendor service area */
export interface ServiceArea {
  readonly categories: readonly WorkOrderCategory[];
  readonly hourlyRate: Money | null;
  readonly callOutFee: Money | null;
}

/** Vendor rating summary */
export interface VendorRating {
  readonly averageRating: number;
  readonly totalRatings: number;
  readonly completedJobs: number;
  readonly onTimePercentage: number;
}

/**
 * Vendor entity
 */
export interface Vendor extends EntityMetadata, SoftDeletable {
  readonly id: VendorId;
  readonly tenantId: TenantId;
  readonly vendorNumber: string; // e.g., "VND-2024-0001"
  readonly name: string;
  readonly type: VendorType;
  readonly status: VendorStatus;
  readonly taxId: string | null;
  readonly registrationNumber: string | null;
  readonly contacts: readonly VendorContact[];
  readonly address: string | null;
  readonly serviceAreas: ServiceArea;
  readonly insuranceExpiry: ISOTimestamp | null;
  readonly licenseExpiry: ISOTimestamp | null;
  readonly rating: VendorRating;
  readonly notes: string | null;
  readonly paymentTerms: string | null; // e.g., "Net 30"
  readonly preferredPaymentMethod: 'mpesa' | 'bank_transfer' | 'cheque' | null;
  readonly bankDetails: BankDetails | null;
}

/** Bank details for payment */
export interface BankDetails {
  readonly bankName: string;
  readonly accountName: string;
  readonly accountNumber: string;
  readonly branchCode: string | null;
}

/** Create a new vendor */
export function createVendor(
  id: VendorId,
  data: {
    tenantId: TenantId;
    vendorNumber: string;
    name: string;
    type: VendorType;
    contacts: VendorContact[];
    serviceCategories: WorkOrderCategory[];
    address?: string;
    taxId?: string;
    registrationNumber?: string;
    insuranceExpiry?: ISOTimestamp;
    licenseExpiry?: ISOTimestamp;
    paymentTerms?: string;
  },
  createdBy: UserId
): Vendor {
  const now = new Date().toISOString();

  return {
    id,
    tenantId: data.tenantId,
    vendorNumber: data.vendorNumber,
    name: data.name,
    type: data.type,
    status: 'pending_approval',
    taxId: data.taxId ?? null,
    registrationNumber: data.registrationNumber ?? null,
    contacts: data.contacts,
    address: data.address ?? null,
    serviceAreas: {
      categories: data.serviceCategories,
      hourlyRate: null,
      callOutFee: null,
    },
    insuranceExpiry: data.insuranceExpiry ?? null,
    licenseExpiry: data.licenseExpiry ?? null,
    rating: {
      averageRating: 0,
      totalRatings: 0,
      completedJobs: 0,
      onTimePercentage: 0,
    },
    notes: null,
    paymentTerms: data.paymentTerms ?? null,
    preferredPaymentMethod: null,
    bankDetails: null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    updatedBy: createdBy,
    deletedAt: null,
    deletedBy: null,
  };
}

/** Approve vendor */
export function approveVendor(
  vendor: Vendor,
  updatedBy: UserId
): Vendor {
  return {
    ...vendor,
    status: 'active',
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Update vendor rating after job completion */
export function updateVendorRating(
  vendor: Vendor,
  jobRating: number,
  wasOnTime: boolean,
  updatedBy: UserId
): Vendor {
  const oldTotal = vendor.rating.averageRating * vendor.rating.totalRatings;
  const newTotal = vendor.rating.totalRatings + 1;
  const newAverage = (oldTotal + jobRating) / newTotal;
  
  const completedJobs = vendor.rating.completedJobs + 1;
  const onTimeJobs = Math.round((vendor.rating.onTimePercentage / 100) * vendor.rating.completedJobs) + (wasOnTime ? 1 : 0);
  const newOnTimePercentage = (onTimeJobs / completedJobs) * 100;

  return {
    ...vendor,
    rating: {
      averageRating: Math.round(newAverage * 10) / 10,
      totalRatings: newTotal,
      completedJobs,
      onTimePercentage: Math.round(newOnTimePercentage),
    },
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
}

/** Check if vendor documents are expiring */
export function areDocumentsExpiring(vendor: Vendor, withinDays: number = 30): boolean {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() + withinDays);

  if (vendor.insuranceExpiry && new Date(vendor.insuranceExpiry) <= threshold) {
    return true;
  }

  if (vendor.licenseExpiry && new Date(vendor.licenseExpiry) <= threshold) {
    return true;
  }

  return false;
}

/** Check if vendor can handle category */
export function canHandleCategory(vendor: Vendor, category: WorkOrderCategory): boolean {
  return vendor.serviceAreas.categories.includes(category);
}

/** Generate vendor number */
export function generateVendorNumber(year: number, sequence: number): string {
  return `VND-${year}-${String(sequence).padStart(4, '0')}`;
}
