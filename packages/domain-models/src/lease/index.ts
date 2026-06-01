/**
 * Offtake (supply-agreement) domain models (public subpath barrel).
 *
 * Offtakes represent mineral supply agreements between mining owners
 * (sellers) and buyer / off-taker counterparties. They define the
 * terms, duration, and obligations of the supply relationship. This
 * barrel re-exports the canonical `Offtake` and `ProductionTenure`
 * models and adds the counterparty value model + input DTOs.
 */

// Canonical models (offtake agreement + production tenure).
export * from './lease';
export * from './occupancy';

import { BaseEntity, TenantScoped, DateRange, Money, ContactInfo, Address } from '../common';
import type { OfftakeType } from './lease';

// ============================================================================
// Counterparty Account Entity
// ============================================================================

export interface CounterpartyAccount extends BaseEntity, TenantScoped {
  userId?: string; // Linked user for app access
  firstName: string;
  lastName: string;
  idType: IdentificationType;
  idNumber: string;
  dateOfBirth?: Date;
  contactInfo: ContactInfo;
  emergencyContact?: EmergencyContact;
  tradeInfo?: TradeInfo;
  documents: CounterpartyDocument[];
  status: CounterpartyStatus;
}

export type IdentificationType = 'national_id' | 'passport' | 'drivers_license' | 'company_registration';

export type CounterpartyStatus = 'active' | 'inactive' | 'blacklisted';

export interface EmergencyContact {
  name: string;
  relationship: string;
  phone: string;
  email?: string;
}

export interface TradeInfo {
  /** Buyer / off-taker trading entity. */
  tradingName: string;
  role: string;
  monthlyVolume?: Money;
  tradingPhone?: string;
  tradingAddress?: Address;
}

export interface CounterpartyDocument {
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
  | 'proof_of_funds'
  | 'trade_licence'
  | 'bank_statement'
  | 'reference_letter'
  | 'other';

// ============================================================================
// Site-condition Inspection Value Object
// ============================================================================

export interface Inspection {
  id: string;
  date: Date;
  conductedBy: string;
  items: InspectionItem[];
  overallCondition: 'excellent' | 'good' | 'fair' | 'poor';
  photos: string[];
  notes?: string;
  signedByCounterparty: boolean;
  signedAt?: Date;
}

export interface InspectionItem {
  area: string;
  condition: 'excellent' | 'good' | 'fair' | 'poor' | 'damaged';
  notes?: string;
  photos?: string[];
}

// ============================================================================
// Input DTOs
// ============================================================================

export interface CreateCounterpartyInput {
  firstName: string;
  lastName: string;
  idType: IdentificationType;
  idNumber: string;
  dateOfBirth?: Date;
  contactInfo: ContactInfo;
  emergencyContact?: EmergencyContact;
}

export interface CreateOfftakeInput {
  unitId: string;
  counterpartyId: string;
  type: OfftakeType;
  term: DateRange;
  paymentAmount: Money;
  performanceBond: Money;
  paymentDay: number;
  additionalParties?: Array<{
    counterpartyId: string;
    role: 'co_buyer' | 'guarantor';
  }>;
}

export interface RenewOfftakeInput {
  newTerm: DateRange;
  newPaymentAmount?: Money;
}

export interface TerminateOfftakeInput {
  reason: string;
  effectiveDate: Date;
  refundAmount?: Money;
}
