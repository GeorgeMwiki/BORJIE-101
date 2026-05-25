/**
 * Maintenance domain models.
 *
 * Handles work orders, maintenance requests, vendor management,
 * and field operations for property managers.
 */

import { BaseEntity, TenantScoped, Money, ContactInfo, Address } from '../common';

// ============================================================================
// Work Order Entity
// ============================================================================

export interface WorkOrder extends BaseEntity, TenantScoped {
  ticketNumber: string;
  propertyId: string;
  unitId?: string;
  requestedBy: string; // User ID (customer or staff)
  requestType: 'customer' | 'internal' | 'inspection';
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  status: WorkOrderStatus;
  title: string;
  description: string;
  attachments: WorkOrderAttachment[];
  assignedTo?: string; // Manager ID
  vendorId?: string;
  scheduledDate?: Date;
  completedDate?: Date;
  estimatedCost?: Money;
  actualCost?: Money;
  billToOwner: boolean;
  billToTenant: boolean;
  approvalRequired: boolean;
  approvedBy?: string;
  approvedAt?: Date;
  notes: WorkOrderNote[];
  timeline: WorkOrderEvent[];
  customerSatisfaction?: CustomerSatisfaction;
}

export type MaintenanceCategory =
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'appliances'
  | 'structural'
  | 'pest_control'
  | 'cleaning'
  | 'landscaping'
  | 'security'
  | 'general'
  | 'emergency';

export type MaintenancePriority = 'low' | 'medium' | 'high' | 'urgent';

export type WorkOrderStatus =
  | 'submitted'
  | 'triaged'
  | 'approved'
  | 'scheduled'
  | 'in_progress'
  | 'pending_parts'
  | 'completed'
  | 'verified'
  | 'cancelled'
  | 'on_hold';

export interface WorkOrderAttachment {
  id: string;
  type: 'image' | 'video' | 'document';
  url: string;
  thumbnailUrl?: string;
  name: string;
  uploadedAt: Date;
  uploadedBy: string;
}

export interface WorkOrderNote {
  id: string;
  content: string;
  isInternal: boolean; // Internal notes not visible to customer
  createdAt: Date;
  createdBy: string;
}

export interface WorkOrderEvent {
  id: string;
  type: WorkOrderEventType;
  description: string;
  timestamp: Date;
  userId: string;
  metadata?: Record<string, unknown>;
}

export type WorkOrderEventType =
  | 'created'
  | 'status_changed'
  | 'assigned'
  | 'scheduled'
  | 'note_added'
  | 'attachment_added'
  | 'cost_updated'
  | 'approved'
  | 'completed'
  | 'verified';

export interface CustomerSatisfaction {
  rating: 1 | 2 | 3 | 4 | 5;
  feedback?: string;
  submittedAt: Date;
}

// ============================================================================
// Vendor Entity
// ============================================================================

export interface Vendor extends BaseEntity, TenantScoped {
  name: string;
  type: VendorType;
  status: VendorStatus;
  categories: MaintenanceCategory[];
  contactInfo: ContactInfo;
  address?: Address;
  taxId?: string;
  insuranceInfo?: VendorInsurance;
  rating: number;
  totalJobs: number;
  completedJobs: number;
  averageResponseTime?: number; // in hours
  paymentTerms: VendorPaymentTerms;
  notes?: string;
}

export type VendorType = 'individual' | 'company';

export type VendorStatus = 'active' | 'inactive' | 'pending_approval' | 'suspended';

export interface VendorInsurance {
  provider: string;
  policyNumber: string;
  coverageAmount: Money;
  expiryDate: Date;
  documentUrl?: string;
}

export interface VendorPaymentTerms {
  method: 'bank_transfer' | 'mpesa' | 'cheque' | 'cash';
  termDays: number;
  bankDetails?: {
    accountName: string;
    bankName: string;
    accountNumber: string;
  };
  mpesaNumber?: string;
}

// ============================================================================
// Inspection Template Entity
// ============================================================================

export interface InspectionTemplate extends BaseEntity, TenantScoped {
  name: string;
  type: 'move_in' | 'move_out' | 'routine' | 'annual';
  sections: InspectionSection[];
  isDefault: boolean;
}

export interface InspectionSection {
  id: string;
  name: string;
  order: number;
  items: InspectionTemplateItem[];
}

export interface InspectionTemplateItem {
  id: string;
  name: string;
  order: number;
  requirePhoto: boolean;
  requireComment: boolean;
  conditionOptions: string[];
}

// ============================================================================
// Scheduled Maintenance Entity
// ============================================================================

export interface ScheduledMaintenance extends BaseEntity, TenantScoped {
  name: string;
  description: string;
  propertyId?: string; // Null for all properties
  category: MaintenanceCategory;
  frequency: MaintenanceFrequency;
  nextDueDate: Date;
  lastCompletedDate?: Date;
  estimatedCost?: Money;
  vendorId?: string;
  assignedTo?: string;
  isActive: boolean;
  createdWorkOrders: string[];
}

export interface MaintenanceFrequency {
  type: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
  dayOfWeek?: number; // 0-6 for weekly
  dayOfMonth?: number; // 1-28 for monthly+
  monthOfYear?: number; // 1-12 for annual
}

// ============================================================================
// DTOs
// ============================================================================

export interface CreateWorkOrderInput {
  propertyId: string;
  unitId?: string;
  category: MaintenanceCategory;
  priority: MaintenancePriority;
  title: string;
  description: string;
  requestType?: 'customer' | 'internal' | 'inspection';
}

export interface UpdateWorkOrderInput {
  category?: MaintenanceCategory;
  priority?: MaintenancePriority;
  status?: WorkOrderStatus;
  title?: string;
  description?: string;
  assignedTo?: string;
  vendorId?: string;
  scheduledDate?: Date;
  estimatedCost?: Money;
  billToOwner?: boolean;
  billToTenant?: boolean;
}

export interface CreateVendorInput {
  name: string;
  type: VendorType;
  categories: MaintenanceCategory[];
  contactInfo: ContactInfo;
  address?: Address;
  paymentTerms: VendorPaymentTerms;
}

export interface CompleteWorkOrderInput {
  actualCost?: Money;
  completionNotes?: string;
  attachments?: Omit<WorkOrderAttachment, 'id' | 'uploadedAt' | 'uploadedBy'>[];
}
