/**
 * Simplified Mock Types for API Gateway
 * These are used for the MVP mock data system
 */

import { UserRole } from './user-role';

// Tenant Status
export const TenantStatus = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  PENDING: 'PENDING',
  CHURNED: 'CHURNED',
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

// Property Status
export const PropertyStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  UNDER_CONSTRUCTION: 'UNDER_CONSTRUCTION',
} as const;
export type PropertyStatus = (typeof PropertyStatus)[keyof typeof PropertyStatus];

// Unit Status
export const UnitStatus = {
  AVAILABLE: 'AVAILABLE',
  OCCUPIED: 'OCCUPIED',
  MAINTENANCE: 'MAINTENANCE',
  RESERVED: 'RESERVED',
} as const;
export type UnitStatus = (typeof UnitStatus)[keyof typeof UnitStatus];

// Lease Status
export const LeaseStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  TERMINATED: 'TERMINATED',
} as const;
export type LeaseStatus = (typeof LeaseStatus)[keyof typeof LeaseStatus];

// Work Order Status
export const WorkOrderStatus = {
  SUBMITTED: 'SUBMITTED',
  TRIAGED: 'TRIAGED',
  APPROVED: 'APPROVED',
  ASSIGNED: 'ASSIGNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type WorkOrderStatus = (typeof WorkOrderStatus)[keyof typeof WorkOrderStatus];

// Work Order Priority
export const WorkOrderPriority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  EMERGENCY: 'EMERGENCY',
} as const;
export type WorkOrderPriority = (typeof WorkOrderPriority)[keyof typeof WorkOrderPriority];

// Work Order Category
export const WorkOrderCategory = {
  PLUMBING: 'PLUMBING',
  ELECTRICAL: 'ELECTRICAL',
  HVAC: 'HVAC',
  GENERAL: 'GENERAL',
  APPLIANCE: 'APPLIANCE',
  STRUCTURAL: 'STRUCTURAL',
} as const;
export type WorkOrderCategory = (typeof WorkOrderCategory)[keyof typeof WorkOrderCategory];

// Invoice Status
export const InvoiceStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  PENDING: 'PENDING',
  PAID: 'PAID',
  PARTIALLY_PAID: 'PARTIALLY_PAID',
  OVERDUE: 'OVERDUE',
  CANCELLED: 'CANCELLED',
} as const;
export type InvoiceStatus = (typeof InvoiceStatus)[keyof typeof InvoiceStatus];

// Payment Status
export const PaymentStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

// Payment Method
export const PaymentMethod = {
  MPESA: 'MPESA',
  BANK_TRANSFER: 'BANK_TRANSFER',
  CARD: 'CARD',
  CASH: 'CASH',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

// Document Type
export const DocumentType = {
  LEASE: 'LEASE',
  ID_DOCUMENT: 'ID_DOCUMENT',
  INVOICE: 'INVOICE',
  RECEIPT: 'RECEIPT',
  CONTRACT: 'CONTRACT',
  OTHER: 'OTHER',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

// Document Verification Status
export const DocumentVerificationStatus = {
  PENDING: 'PENDING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
} as const;
export type DocumentVerificationStatus = (typeof DocumentVerificationStatus)[keyof typeof DocumentVerificationStatus];

// Approval Status
export const ApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

// Entity Interfaces
export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  contactEmail: string;
  contactPhone?: string;
  settings: Record<string, unknown>;
  subscription: Record<string, unknown>;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  phone?: string;
  phoneVerified?: boolean;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt?: Date;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface TenantUser {
  tenantId: string;
  userId: string;
  role: UserRole;
  permissions: string[];
  propertyAccess: string[];
  assignedAt: Date;
  assignedBy: string;
}

export interface Property {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  status: PropertyStatus;
  deletedAt?: Date;
  address: {
    line1: string;
    city: string;
    region?: string;
    country: string;
    coordinates?: { latitude: number; longitude: number };
  };
  description?: string;
  amenities: string[];
  images: string[];
  managerId?: string;
  totalUnits: number;
  occupiedUnits: number;
  settings: Record<string, unknown>;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface Unit {
  id: string;
  tenantId: string;
  propertyId: string;
  unitNumber: string;
  deletedAt?: Date;
  floor?: number;
  type: string;
  status: UnitStatus;
  bedrooms: number;
  bathrooms: number;
  squareMeters?: number;
  rentAmount: number;
  depositAmount: number;
  amenities: string[];
  images: string[];
  currentOccupancyId?: string;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface Customer {
  id: string;
  tenantId: string;
  type: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  idNumber?: string;
  idType?: string;
  companyName?: string;
  companyRegNumber?: string;
  preferences: Record<string, unknown>;
  verificationStatus: DocumentVerificationStatus;
  riskScore?: number;
  deletedAt?: Date;
  blacklisted?: boolean;
  blacklistReason?: string;
  blacklistedAt?: Date;
  blacklistedBy?: string;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface Lease {
  id: string;
  tenantId: string;
  unitId: string;
  customerId: string;
  status: LeaseStatus;
  startDate: Date;
  endDate: Date;
  rentAmount: number;
  depositAmount: number;
  depositPaid: number;
  paymentDueDay: number;
  terms: Record<string, unknown>;
  signedAt?: Date;
  signedByCustomer?: boolean;
  signedByManager?: boolean;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface WorkOrder {
  id: string;
  tenantId: string;
  unitId: string;
  propertyId: string;
  customerId?: string;
  vendorId?: string;
  assignedTo?: string;
  category: WorkOrderCategory;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  title: string;
  description: string;
  reportedAt: Date;
  scheduledAt?: Date;
  completedAt?: Date;
  slaDeadline?: Date;
  slaPausedAt?: Date;
  slaPausedReason?: string;
  escalatedAt?: Date;
  escalationReason?: string;
  verifiedAt?: Date;
  verifiedBy?: string;
  customerFeedback?: string;
  customerRating?: number;
  estimatedCost?: number;
  actualCost?: number;
  evidence: Record<string, unknown>;
  notes: unknown[];
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface Vendor {
  id: string;
  tenantId: string;
  name: string;
  companyName?: string;
  email: string;
  phone: string;
  categories: WorkOrderCategory[];
  isAvailable: boolean;
  rating?: number;
  completedJobs?: number;
  responseTimeHours?: number;
  deletedAt?: Date;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface Invoice {
  id: string;
  tenantId: string;
  number: string;
  customerId: string;
  leaseId?: string;
  status: InvoiceStatus;
  type: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  subtotal: number;
  tax: number;
  total: number;
  amountPaid: number;
  amountDue: number;
  currency: string;
  lineItems: unknown[];
  paidAt?: Date;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface Payment {
  id: string;
  tenantId: string;
  invoiceId: string;
  customerId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: PaymentStatus;
  reference: string;
  externalReference?: string;
  processedAt?: Date;
  reconciledAt?: Date;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface Document {
  id: string;
  tenantId: string;
  type: DocumentType;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  verificationStatus: DocumentVerificationStatus;
  verifiedAt?: Date;
  verifiedBy?: string;
  tags: string[];
  relatedEntityType?: string;
  relatedEntityId?: string;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

export interface Approval {
  id: string;
  tenantId: string;
  type: string;
  status: ApprovalStatus;
  requesterId: string;
  approverId?: string;
  entityType: string;
  entityId: string;
  requestedAction: string;
  justification: string;
  decision?: string;
  decidedAt?: Date;
  escalationLevel: number;
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
  updatedBy: string;
}

// Re-export UserRole
export { UserRole };
