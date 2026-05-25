/**
 * Lease domain models.
 *
 * Leases represent rental agreements between tenants (customers) and property owners.
 * They define the terms, duration, and obligations of the rental relationship.
 */

// Export the detailed Occupancy model with Zod schemas
export * from './occupancy';

import { BaseEntity, TenantScoped, DateRange, Money, ContactInfo, Address } from '../common';

// ============================================================================
// Customer Account Entity
// ============================================================================

export interface CustomerAccount extends BaseEntity, TenantScoped {
  userId?: string; // Linked user for app access
  firstName: string;
  lastName: string;
  idType: IdentificationType;
  idNumber: string;
  dateOfBirth?: Date;
  contactInfo: ContactInfo;
  emergencyContact?: EmergencyContact;
  employmentInfo?: EmploymentInfo;
  documents: CustomerDocument[];
  status: CustomerStatus;
}

export type IdentificationType = 'national_id' | 'passport' | 'drivers_license' | 'company_registration';

export type CustomerStatus = 'active' | 'inactive' | 'blacklisted';

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
}

export interface EmploymentInfo {
  employer: string;
  position: string;
  monthlyIncome?: Money;
  employerPhone?: string;
  employerAddress?: Address;
}

export interface CustomerDocument {
  id: string;
  type: DocumentType;
  name: string;
  url: string;
  uploadedAt: Date;
  verifiedAt?: Date;
  verifiedBy?: string;
}

export type DocumentType =
  | 'id_copy'
  | 'proof_of_income'
  | 'employment_letter'
  | 'bank_statement'
  | 'reference_letter'
  | 'other';

// ============================================================================
// Lease Entity
// ============================================================================

export interface Lease extends BaseEntity, TenantScoped {
  unitId: string;
  customerId: string;
  status: LeaseStatus;
  type: LeaseType;
  term: DateRange;
  rentAmount: Money;
  depositAmount: Money;
  depositPaid: Money;
  paymentDay: number; // Day of month rent is due (1-28)
  terms: LeaseTerms;
  signatories: LeaseSignatory[];
  renewalHistory: LeaseRenewal[];
  documents: LeaseDocument[];
}

export type LeaseStatus = 'draft' | 'pending_signature' | 'active' | 'expired' | 'terminated' | 'renewed';

export type LeaseType = 'fixed_term' | 'month_to_month' | 'short_term';

export interface LeaseTerms {
  lateFeePercentage: number;
  lateFeeGraceDays: number;
  noticePeriodDays: number;
  petsAllowed: boolean;
  maxOccupants: number;
  includedUtilities: string[];
  specialConditions?: string;
}

export interface LeaseSignatory {
  customerId: string;
  role: 'primary' | 'co_tenant' | 'guarantor';
  signedAt?: Date;
  signatureUrl?: string;
}

export interface LeaseRenewal {
  previousLeaseId: string;
  renewedAt: Date;
  newTerm: DateRange;
  newRentAmount: Money;
  reason?: string;
}

export interface LeaseDocument {
  id: string;
  type: LeaseDocumentType;
  name: string;
  url: string;
  generatedAt: Date;
  signedAt?: Date;
}

export type LeaseDocumentType =
  | 'lease_agreement'
  | 'addendum'
  | 'notice'
  | 'termination_letter'
  | 'renewal_offer';

// ============================================================================
// Occupancy Entity
// ============================================================================

export interface Occupancy extends BaseEntity, TenantScoped {
  leaseId: string;
  unitId: string;
  customerId: string;
  status: OccupancyStatus;
  moveInDate: Date;
  moveOutDate?: Date;
  moveInInspection?: Inspection;
  moveOutInspection?: Inspection;
}

export type OccupancyStatus = 'scheduled' | 'active' | 'notice_given' | 'moved_out';

export interface Inspection {
  id: string;
  date: Date;
  conductedBy: string;
  items: InspectionItem[];
  overallCondition: 'excellent' | 'good' | 'fair' | 'poor';
  photos: string[];
  notes?: string;
  signedByCustomer: boolean;
  signedAt?: Date;
}

export interface InspectionItem {
  area: string;
  condition: 'excellent' | 'good' | 'fair' | 'poor' | 'damaged';
  notes?: string;
  photos?: string[];
}

// ============================================================================
// DTOs
// ============================================================================

export interface CreateCustomerInput {
  firstName: string;
  lastName: string;
  idType: IdentificationType;
  idNumber: string;
  dateOfBirth?: Date;
  contactInfo: ContactInfo;
  emergencyContact?: EmergencyContact;
}

export interface CreateLeaseInput {
  unitId: string;
  customerId: string;
  type: LeaseType;
  term: DateRange;
  rentAmount: Money;
  depositAmount: Money;
  paymentDay: number;
  terms: LeaseTerms;
  additionalSignatories?: Array<{
    customerId: string;
    role: 'co_tenant' | 'guarantor';
  }>;
}

export interface RenewLeaseInput {
  newTerm: DateRange;
  newRentAmount?: Money;
  updatedTerms?: Partial<LeaseTerms>;
}

export interface TerminateLeaseInput {
  reason: string;
  effectiveDate: Date;
  refundAmount?: Money;
}
