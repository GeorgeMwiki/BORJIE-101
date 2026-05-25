# BORJIE Domain Model

## Overview

This document defines the core domain entities, their relationships, and the bounded context boundaries for the BORJIE platform.

---

## Domain Glossary

| Term | Definition |
|------|------------|
| **Organization** | Legal entity that subscribes to BORJIE; billing boundary |
| **Tenant** | Operational data isolation boundary within an organization |
| **Property Owner** | Investor/landlord who owns properties managed on the platform |
| **Customer** | End-user who rents/buys property (also called "tenant" in real estate; we use "customer" to avoid confusion with multi-tenant SaaS) |
| **Estate Manager** | Field personnel managing properties day-to-day |
| **Property** | Physical real estate asset (building, complex, land) |
| **Unit** | Individual rentable/sellable space within a property |
| **Lease** | Contractual agreement between property owner and customer |
| **Work Order** | Assigned maintenance task |
| **Ledger Entry** | Immutable financial record |
| **Disbursement** | Payment from platform to property owner |
| **Contribution** | Capital call from property owner to platform |

---

## Bounded Contexts

### Context Map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BORJIE PLATFORM                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌───────────────┐      ┌───────────────┐      ┌───────────────┐           │
│  │   IDENTITY    │      │   TENANCY     │      │   BILLING     │           │
│  │   CONTEXT     │◄────►│   CONTEXT     │◄────►│   CONTEXT     │           │
│  │               │      │               │      │               │           │
│  │ - User        │      │ - Organization│      │ - Subscription│           │
│  │ - Role        │      │ - Tenant      │      │ - Invoice     │           │
│  │ - Permission  │      │ - Settings    │      │ - PaymentMethod│          │
│  │ - Session     │      │               │      │               │           │
│  └───────┬───────┘      └───────────────┘      └───────────────┘           │
│          │                                                                  │
│          │ authenticates                                                    │
│          ▼                                                                  │
│  ┌───────────────┐      ┌───────────────┐      ┌───────────────┐           │
│  │   PROPERTY    │      │   CUSTOMER    │      │  MAINTENANCE  │           │
│  │   CONTEXT     │◄────►│   CONTEXT     │◄────►│   CONTEXT     │           │
│  │               │      │               │      │               │           │
│  │ - Property    │      │ - Customer    │      │ - Request     │           │
│  │ - Unit        │      │ - Lease       │      │ - WorkOrder   │           │
│  │ - Amenity     │      │ - Occupancy   │      │ - Vendor      │           │
│  │ - OwnerAcct   │      │ - KYCRecord   │      │ - SLAPolicy   │           │
│  └───────┬───────┘      └───────┬───────┘      └───────────────┘           │
│          │                      │                                           │
│          │                      │ pays rent                                 │
│          │                      ▼                                           │
│          │              ┌───────────────┐      ┌───────────────┐           │
│          │              │   FINANCIAL   │      │   DOCUMENT    │           │
│          └─────────────►│   CONTEXT     │◄────►│   CONTEXT     │           │
│           receives      │               │      │               │           │
│           disbursement  │ - LedgerEntry │      │ - Document    │           │
│                         │ - Statement   │      │ - Template    │           │
│                         │ - Payment     │      │ - Signature   │           │
│                         │ - Disbursement│      │               │           │
│                         └───────────────┘      └───────────────┘           │
│                                                                             │
│  ┌───────────────┐      ┌───────────────┐                                  │
│  │ COMMUNICATION │      │   ANALYTICS   │                                  │
│  │   CONTEXT     │      │   CONTEXT     │                                  │
│  │               │      │               │                                  │
│  │ - Message     │      │ - KPI         │                                  │
│  │ - Notification│      │ - Report      │                                  │
│  │ - Preference  │      │ - Dashboard   │                                  │
│  └───────────────┘      └───────────────┘                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Entity Definitions

### Tenancy Context

#### Organization

```typescript
interface Organization {
  id: UUID;
  name: string;
  legalName: string;
  taxId?: string;
  status: 'active' | 'suspended' | 'terminated';
  billingEmail: string;
  createdAt: DateTime;
  updatedAt: DateTime;
}
```

#### Tenant

```typescript
interface Tenant {
  id: UUID;
  organizationId: UUID;
  name: string;
  slug: string;                    // URL-safe identifier
  status: 'provisioning' | 'active' | 'suspended' | 'terminated';
  settings: TenantSettings;
  createdAt: DateTime;
  updatedAt: DateTime;
}

interface TenantSettings {
  timezone: string;
  currency: CurrencyCode;
  locale: string;
  fiscalYearStart: MonthDay;
  features: FeatureFlags;
}
```

---

### Identity Context

#### User

```typescript
interface User {
  id: UUID;
  tenantId: UUID;
  email: string;
  emailVerified: boolean;
  phone?: string;
  phoneVerified: boolean;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  status: 'pending' | 'active' | 'suspended' | 'deactivated';
  mfaEnabled: boolean;
  lastLoginAt?: DateTime;
  createdAt: DateTime;
  updatedAt: DateTime;
}
```

#### Role

```typescript
interface Role {
  id: UUID;
  tenantId: UUID;
  name: string;
  description: string;
  isSystemRole: boolean;          // Built-in roles cannot be deleted
  permissions: Permission[];
  createdAt: DateTime;
  updatedAt: DateTime;
}

type Permission = string;         // e.g., 'properties:read', 'leases:create'
```

#### UserRole (Assignment)

```typescript
interface UserRole {
  userId: UUID;
  roleId: UUID;
  scope?: ResourceScope;          // Optional: limit role to specific resources
  assignedAt: DateTime;
  assignedBy: UUID;
}

interface ResourceScope {
  type: 'property' | 'unit' | 'customer';
  resourceIds: UUID[];
}
```

---

### Property Context

#### Property

```typescript
interface Property {
  id: UUID;
  tenantId: UUID;
  name: string;
  type: PropertyType;
  address: Address;
  geoLocation?: GeoPoint;
  totalUnits: number;
  yearBuilt?: number;
  status: 'active' | 'inactive' | 'archived';
  metadata: Record<string, unknown>;
  createdAt: DateTime;
  updatedAt: DateTime;
}

type PropertyType = 
  | 'residential_single'
  | 'residential_multi'
  | 'commercial'
  | 'mixed_use'
  | 'land';

interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: CountryCode;
}

interface GeoPoint {
  latitude: number;
  longitude: number;
}
```

#### Unit

```typescript
interface Unit {
  id: UUID;
  tenantId: UUID;
  propertyId: UUID;
  name: string;                   // e.g., "Unit 101", "Apt 2B"
  type: UnitType;
  status: UnitStatus;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  monthlyRent: Money;
  securityDeposit: Money;
  amenities: string[];
  createdAt: DateTime;
  updatedAt: DateTime;
}

type UnitType = 
  | 'apartment'
  | 'studio'
  | 'house'
  | 'townhouse'
  | 'office'
  | 'retail'
  | 'warehouse'
  | 'parking';

type UnitStatus = 
  | 'available'
  | 'occupied'
  | 'reserved'
  | 'maintenance'
  | 'inactive';

interface Money {
  amount: number;                 // Stored as integer cents
  currency: CurrencyCode;
}
```

#### PropertyOwner

```typescript
interface PropertyOwner {
  id: UUID;
  tenantId: UUID;
  userId?: UUID;                  // If owner has platform account
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: Address;
  taxId?: string;
  bankAccount?: BankAccount;
  ownershipPercentage: number;    // For co-ownership scenarios
  createdAt: DateTime;
  updatedAt: DateTime;
}

interface PropertyOwnership {
  propertyOwnerId: UUID;
  propertyId: UUID;
  ownershipPercentage: number;
  effectiveFrom: Date;
  effectiveTo?: Date;
}
```

---

### Customer Context

#### Customer

```typescript
interface Customer {
  id: UUID;
  tenantId: UUID;
  userId?: UUID;                  // If customer has platform account
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth?: Date;
  governmentId?: EncryptedString;
  status: 'prospect' | 'applicant' | 'active' | 'former';
  kycStatus: 'pending' | 'verified' | 'failed' | 'expired';
  createdAt: DateTime;
  updatedAt: DateTime;
}
```

#### Lease

```typescript
interface Lease {
  id: UUID;
  tenantId: UUID;
  customerId: UUID;
  unitId: UUID;
  status: LeaseStatus;
  type: 'fixed_term' | 'month_to_month' | 'periodic';
  startDate: Date;
  endDate?: Date;
  terms: LeaseTerms;
  signedAt?: DateTime;
  terminatedAt?: DateTime;
  terminationReason?: string;
  renewedFromLeaseId?: UUID;
  createdAt: DateTime;
  updatedAt: DateTime;
}

type LeaseStatus = 
  | 'draft'
  | 'pending_signature'
  | 'active'
  | 'expiring'
  | 'expired'
  | 'terminated'
  | 'renewed';

interface LeaseTerms {
  monthlyRent: Money;
  securityDeposit: Money;
  paymentDueDay: number;          // 1-28
  lateFeeAmount: Money;
  lateFeeGraceDays: number;
  utilities: UtilityResponsibility[];
  petPolicy?: PetPolicy;
  specialTerms?: string;
}
```

#### Occupancy

```typescript
interface Occupancy {
  id: UUID;
  tenantId: UUID;
  leaseId: UUID;
  customerId: UUID;
  unitId: UUID;
  isPrimary: boolean;             // Primary vs. additional occupant
  moveInDate: Date;
  moveOutDate?: Date;
  status: 'scheduled' | 'active' | 'vacated';
  createdAt: DateTime;
  updatedAt: DateTime;
}
```

---

### Maintenance Context

#### MaintenanceRequest

```typescript
interface MaintenanceRequest {
  id: UUID;
  tenantId: UUID;
  unitId: UUID;
  reportedBy: UUID;               // Customer or Manager
  reporterType: 'customer' | 'manager' | 'owner';
  category: MaintenanceCategory;
  priority: 'low' | 'medium' | 'high' | 'emergency';
  title: string;
  description: string;
  attachments: Attachment[];
  status: RequestStatus;
  createdAt: DateTime;
  updatedAt: DateTime;
}

type MaintenanceCategory = 
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'appliance'
  | 'structural'
  | 'pest'
  | 'landscaping'
  | 'security'
  | 'cleaning'
  | 'other';

type RequestStatus = 
  | 'submitted'
  | 'triaged'
  | 'work_order_created'
  | 'resolved'
  | 'cancelled';
```

#### WorkOrder

```typescript
interface WorkOrder {
  id: UUID;
  tenantId: UUID;
  maintenanceRequestId?: UUID;
  propertyId: UUID;
  unitId?: UUID;
  assignedTo?: UUID;              // Estate Manager
  vendorId?: UUID;
  type: 'reactive' | 'preventive' | 'inspection';
  priority: 'low' | 'medium' | 'high' | 'emergency';
  status: WorkOrderStatus;
  title: string;
  description: string;
  scheduledDate?: DateTime;
  completedDate?: DateTime;
  estimatedCost?: Money;
  actualCost?: Money;
  notes: WorkOrderNote[];
  createdAt: DateTime;
  updatedAt: DateTime;
}

type WorkOrderStatus = 
  | 'open'
  | 'assigned'
  | 'scheduled'
  | 'in_progress'
  | 'pending_approval'
  | 'completed'
  | 'cancelled'
  | 'escalated';
```

#### Vendor

```typescript
interface Vendor {
  id: UUID;
  tenantId: UUID;
  name: string;
  type: VendorType;
  contactName: string;
  email: string;
  phone: string;
  address?: Address;
  taxId?: string;
  bankAccount?: BankAccount;
  status: 'active' | 'inactive';
  rating?: number;
  createdAt: DateTime;
  updatedAt: DateTime;
}

type VendorType = 
  | 'plumber'
  | 'electrician'
  | 'hvac_technician'
  | 'general_contractor'
  | 'landscaper'
  | 'cleaning'
  | 'pest_control'
  | 'security'
  | 'other';
```

---

### Financial Context

#### LedgerEntry

```typescript
interface LedgerEntry {
  id: UUID;
  tenantId: UUID;
  entryDate: Date;
  effectiveDate: Date;
  type: LedgerEntryType;
  debitAccountId: UUID;
  creditAccountId: UUID;
  amount: Money;
  description: string;
  referenceType: ReferenceType;
  referenceId: UUID;
  reversesEntryId?: UUID;         // For corrections
  createdAt: DateTime;
  // NOTE: No updatedAt - ledger entries are immutable
}

type LedgerEntryType = 
  | 'rent_charge'
  | 'rent_payment'
  | 'deposit_charge'
  | 'deposit_payment'
  | 'deposit_refund'
  | 'late_fee'
  | 'maintenance_charge'
  | 'disbursement'
  | 'contribution'
  | 'adjustment'
  | 'reversal';

type ReferenceType = 
  | 'lease'
  | 'payment'
  | 'work_order'
  | 'disbursement'
  | 'contribution'
  | 'manual';
```

#### PaymentTransaction

```typescript
interface PaymentTransaction {
  id: UUID;
  tenantId: UUID;
  customerId: UUID;
  leaseId?: UUID;
  type: PaymentType;
  method: PaymentMethod;
  amount: Money;
  fees: Money;
  netAmount: Money;
  status: PaymentStatus;
  externalId?: string;            // Payment provider reference
  processedAt?: DateTime;
  failureReason?: string;
  createdAt: DateTime;
  updatedAt: DateTime;
}

type PaymentType = 'rent' | 'deposit' | 'fee' | 'other';

type PaymentMethod = 
  | 'card'
  | 'bank_transfer'
  | 'mobile_money'
  | 'cash'
  | 'check';

type PaymentStatus = 
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'disputed';
```

#### Statement

```typescript
interface Statement {
  id: UUID;
  tenantId: UUID;
  accountId: UUID;
  accountType: 'customer' | 'owner';
  periodStart: Date;
  periodEnd: Date;
  openingBalance: Money;
  closingBalance: Money;
  totalDebits: Money;
  totalCredits: Money;
  lineItems: StatementLineItem[];
  generatedAt: DateTime;
  documentId?: UUID;              // PDF version
}
```

#### Disbursement

```typescript
interface Disbursement {
  id: UUID;
  tenantId: UUID;
  propertyOwnerId: UUID;
  propertyId: UUID;
  periodStart: Date;
  periodEnd: Date;
  grossAmount: Money;
  managementFee: Money;
  maintenanceCosts: Money;
  otherDeductions: Money;
  netAmount: Money;
  status: 'pending' | 'approved' | 'processing' | 'completed' | 'failed';
  paymentMethod: PaymentMethod;
  processedAt?: DateTime;
  createdAt: DateTime;
  updatedAt: DateTime;
}
```

---

### Document Context

#### Document

```typescript
interface Document {
  id: UUID;
  tenantId: UUID;
  name: string;
  type: DocumentType;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;             // Object storage path
  uploadedBy: UUID;
  associatedType?: string;        // 'lease', 'property', etc.
  associatedId?: UUID;
  expiresAt?: DateTime;
  createdAt: DateTime;
}

type DocumentType = 
  | 'lease_agreement'
  | 'addendum'
  | 'inspection_report'
  | 'invoice'
  | 'receipt'
  | 'identity_document'
  | 'insurance'
  | 'photo'
  | 'other';
```

#### SignatureRequest

```typescript
interface SignatureRequest {
  id: UUID;
  tenantId: UUID;
  documentId: UUID;
  status: 'pending' | 'signed' | 'declined' | 'expired' | 'cancelled';
  signers: SignerInfo[];
  expiresAt: DateTime;
  completedAt?: DateTime;
  createdAt: DateTime;
  updatedAt: DateTime;
}

interface SignerInfo {
  userId: UUID;
  email: string;
  name: string;
  role: string;                   // e.g., "Landlord", "Tenant"
  status: 'pending' | 'signed' | 'declined';
  signedAt?: DateTime;
  signatureImageUrl?: string;
}
```

---

### Communication Context

#### Message

```typescript
interface Message {
  id: UUID;
  tenantId: UUID;
  conversationId: UUID;
  senderId: UUID;
  senderType: 'user' | 'system';
  content: string;
  attachments: Attachment[];
  readBy: ReadReceipt[];
  createdAt: DateTime;
}

interface Conversation {
  id: UUID;
  tenantId: UUID;
  type: 'direct' | 'group' | 'support';
  participants: UUID[];
  subject?: string;
  relatedType?: string;           // 'lease', 'work_order', etc.
  relatedId?: UUID;
  lastMessageAt: DateTime;
  createdAt: DateTime;
}
```

#### Notification

```typescript
interface Notification {
  id: UUID;
  tenantId: UUID;
  userId: UUID;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channels: NotificationChannel[];
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  readAt?: DateTime;
  createdAt: DateTime;
}

type NotificationType = 
  | 'payment_due'
  | 'payment_received'
  | 'lease_expiring'
  | 'maintenance_update'
  | 'document_ready'
  | 'message_received'
  | 'system_alert';

type NotificationChannel = 'in_app' | 'email' | 'sms' | 'push';
```

---

### Audit Context

#### AuditEvent

```typescript
interface AuditEvent {
  id: UUID;
  tenantId: UUID;
  timestamp: DateTime;
  actorId: UUID;
  actorType: 'user' | 'system' | 'api_key';
  action: string;                 // e.g., 'lease.create', 'payment.process'
  resourceType: string;
  resourceId: UUID;
  outcome: 'success' | 'failure' | 'denied';
  changes?: ChangeSet;
  context: AuditContext;
}

interface ChangeSet {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

interface AuditContext {
  ipAddress: string;
  userAgent: string;
  correlationId: string;
  clientApp: string;
}
```

---

## Entity Relationship Diagram

```
                                    ┌──────────────┐
                                    │ Organization │
                                    └──────┬───────┘
                                           │ 1:N
                                    ┌──────▼───────┐
                             ┌──────┤    Tenant    ├──────┐
                             │      └──────┬───────┘      │
                             │             │              │
                    ┌────────▼────────┐    │    ┌────────▼────────┐
                    │      User       │    │    │    Property     │
                    └────────┬────────┘    │    └────────┬────────┘
                             │             │             │
                    ┌────────▼────────┐    │    ┌────────▼────────┐
                    │   UserRole      │    │    │      Unit       │
                    └─────────────────┘    │    └────────┬────────┘
                                           │             │
                    ┌──────────────────────┼─────────────┼──────────────────────┐
                    │                      │             │                      │
           ┌────────▼────────┐    ┌────────▼────────┐   │             ┌────────▼────────┐
           │    Customer     │    │ PropertyOwner   │   │             │     Vendor      │
           └────────┬────────┘    └─────────────────┘   │             └─────────────────┘
                    │                                    │
           ┌────────▼────────┐                          │
           │     Lease       │◄─────────────────────────┘
           └────────┬────────┘
                    │
       ┌────────────┼────────────┬─────────────────┐
       │            │            │                 │
┌──────▼──────┐ ┌───▼────┐ ┌─────▼─────┐ ┌────────▼────────┐
│  Occupancy  │ │Payment │ │ Document  │ │MaintenanceReq   │
└─────────────┘ └───┬────┘ └───────────┘ └────────┬────────┘
                    │                             │
              ┌─────▼─────┐               ┌───────▼───────┐
              │LedgerEntry│               │   WorkOrder   │
              └───────────┘               └───────────────┘
```

---

## Aggregate Boundaries

### Property Aggregate

Root: `Property`
Contains: `Unit[]`, `Amenity[]`
References: `PropertyOwner` (via `PropertyOwnership`)

### Lease Aggregate

Root: `Lease`
Contains: `LeaseTerms`, `Occupancy[]`
References: `Customer`, `Unit`

### Work Order Aggregate

Root: `WorkOrder`
Contains: `WorkOrderNote[]`, `Attachment[]`
References: `MaintenanceRequest`, `Property`, `Unit`, `Vendor`

### Financial Statement Aggregate

Root: `Statement`
Contains: `StatementLineItem[]`
References: `LedgerEntry[]` (read-only)

---

## Invariants and Business Rules

### Tenant Isolation
- Every entity must have a `tenantId`
- Cross-tenant data access is prohibited
- System-level aggregations require explicit admin authorization

### Lease Rules
- A unit can have only one active lease at a time
- Lease dates cannot overlap for the same unit
- Lease termination requires all outstanding payments settled or written off

### Financial Rules
- Ledger entries are immutable; corrections via reversing entries only
- Disbursements require approval for amounts above threshold
- Payment allocations follow FIFO (oldest charges first)

### Work Order Rules
- Emergency work orders bypass approval workflow
- SLA timers start from request creation, not assignment
- Completed work orders cannot be reopened (create new if needed)

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-12 | Architecture Team | Initial domain model |
