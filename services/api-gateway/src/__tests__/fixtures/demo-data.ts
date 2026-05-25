// ==================================================
// Demo Fixtures — TEST-ONLY
//
// In-memory data used exclusively by the api-gateway test suite.
// MUST NOT be imported from production code paths. Living under
// __tests__/fixtures/ guarantees a build of `src/` cannot pull these
// constants by accident.
// ==================================================

import {
  Tenant,
  User,
  TenantUser,
  Property,
  Unit,
  Customer,
  Lease,
  WorkOrder,
  Vendor,
  Invoice,
  Payment,
  Document,
  Approval,
  TenantStatus,
  UserRole,
  PropertyStatus,
  UnitStatus,
  LeaseStatus,
  WorkOrderStatus,
  WorkOrderPriority,
  WorkOrderCategory,
  InvoiceStatus,
  PaymentStatus,
  PaymentMethod,
  DocumentType,
  DocumentVerificationStatus,
  ApprovalStatus,
} from '../../types/mock-types';

// Demo tenant
export let DEMO_TENANT: Tenant = {
  id: 'tenant-001',
  name: 'Mwanga Properties',
  slug: 'mwanga-properties',
  status: TenantStatus.ACTIVE,
  contactEmail: 'admin@mwangaproperties.co.tz',
  contactPhone: '+255 755 000 001',
  settings: {
    timezone: 'Africa/Dar_es_Salaam',
    currency: 'TZS',
    locale: 'sw-TZ',
    features: ['payments', 'maintenance', 'documents', 'reports'],
    policies: {
      gracePeriodDays: 5,
      requireDepositBeforeMoveIn: true,
      allowPartialPayments: true,
      lateFeePolicy: {
        enabled: true,
        type: 'PERCENTAGE',
        amount: 5,
        applyAfterDays: 7,
      },
    },
  },
  subscription: {
    plan: 'PROFESSIONAL',
    status: 'ACTIVE',
    maxUnits: 500,
    maxUsers: 50,
    currentPeriodEndsAt: new Date('2026-12-31'),
  },
  createdAt: new Date('2024-01-01'),
  createdBy: 'system',
  updatedAt: new Date('2024-01-01'),
  updatedBy: 'system',
};

// (PLATFORM_ADMIN_USERS / getPlatformAdminRoles helpers removed —
//  they were never imported by production code and the env-driven version
//  carried hardcoded fallback emails / phones. Real platform admin
//  bootstrap goes through the seed pipeline / Supabase.)

// Demo users
export let DEMO_USERS: User[] = [
  {
    id: 'user-001',
    email: 'admin@mwangaproperties.co.tz',
    emailVerified: true,
    phone: '+255 755 000 001',
    phoneVerified: true,
    firstName: 'John',
    lastName: 'Mwanga',
    status: 'ACTIVE',
    mfaEnabled: true,
    lastLoginAt: new Date(),
    createdAt: new Date('2024-01-01'),
    createdBy: 'system',
    updatedAt: new Date('2024-01-01'),
    updatedBy: 'system',
  },
  {
    id: 'user-002',
    email: 'manager@mwangaproperties.co.tz',
    emailVerified: true,
    phone: '+255 755 000 002',
    phoneVerified: true,
    firstName: 'Sarah',
    lastName: 'Kimaro',
    status: 'ACTIVE',
    mfaEnabled: false,
    lastLoginAt: new Date(),
    createdAt: new Date('2024-01-15'),
    createdBy: 'user-001',
    updatedAt: new Date('2024-01-15'),
    updatedBy: 'user-001',
  },
  {
    id: 'user-003',
    email: 'owner@example.com',
    emailVerified: true,
    firstName: 'George',
    lastName: 'Mwikila',
    phoneVerified: false,
    status: 'ACTIVE',
    mfaEnabled: false,
    createdAt: new Date('2024-02-01'),
    createdBy: 'user-001',
    updatedAt: new Date('2024-02-01'),
    updatedBy: 'user-001',
  },
];

export let DEMO_TENANT_USERS: TenantUser[] = [
  {
    tenantId: 'tenant-001',
    userId: 'user-001',
    role: UserRole.TENANT_ADMIN,
    permissions: [],
    propertyAccess: ['*'],
    assignedAt: new Date('2024-01-01'),
    assignedBy: 'system',
  },
  {
    tenantId: 'tenant-001',
    userId: 'user-002',
    role: UserRole.PROPERTY_MANAGER,
    permissions: [],
    propertyAccess: ['*'],
    assignedAt: new Date('2024-01-15'),
    assignedBy: 'user-001',
  },
  {
    tenantId: 'tenant-001',
    userId: 'user-003',
    role: UserRole.OWNER,
    permissions: [],
    propertyAccess: ['property-001', 'property-002'],
    assignedAt: new Date('2024-02-01'),
    assignedBy: 'user-001',
  },
];

// Demo properties
export let DEMO_PROPERTIES: Property[] = [
  {
    id: 'property-001',
    tenantId: 'tenant-001',
    name: 'Oyster Bay Apartments',
    type: 'RESIDENTIAL',
    status: PropertyStatus.ACTIVE,
    address: {
      line1: '123 Ocean Drive',
      city: 'Dar es Salaam',
      region: 'Kinondoni',
      country: 'Tanzania',
      coordinates: { latitude: -6.7694, longitude: 39.2712 },
    },
    description: 'Premium waterfront apartments with ocean views',
    amenities: ['Swimming Pool', 'Gym', '24/7 Security', 'Parking', 'Generator Backup'],
    images: [],
    managerId: 'user-002',
    totalUnits: 24,
    occupiedUnits: 20,
    settings: {
      defaultLeaseTermMonths: 12,
      requireMoveInInspection: true,
      requireMoveOutInspection: true,
    },
    createdAt: new Date('2024-01-01'),
    createdBy: 'user-001',
    updatedAt: new Date('2024-01-01'),
    updatedBy: 'user-001',
  },
  {
    id: 'property-002',
    tenantId: 'tenant-001',
    name: 'Masaki Heights',
    type: 'RESIDENTIAL',
    status: PropertyStatus.ACTIVE,
    address: {
      line1: '456 Peninsula Road',
      city: 'Dar es Salaam',
      region: 'Kinondoni',
      country: 'Tanzania',
    },
    description: 'Modern high-rise residential complex',
    amenities: ['Rooftop Garden', 'Concierge', 'Smart Home', 'EV Charging'],
    images: [],
    managerId: 'user-002',
    totalUnits: 48,
    occupiedUnits: 42,
    settings: {
      defaultLeaseTermMonths: 12,
      requireMoveInInspection: true,
      requireMoveOutInspection: true,
    },
    createdAt: new Date('2024-02-01'),
    createdBy: 'user-001',
    updatedAt: new Date('2024-02-01'),
    updatedBy: 'user-001',
  },
];

// Demo units
export let DEMO_UNITS: Unit[] = [
  {
    id: 'unit-001',
    tenantId: 'tenant-001',
    propertyId: 'property-001',
    unitNumber: 'A101',
    floor: 1,
    type: '2BR',
    status: UnitStatus.OCCUPIED,
    bedrooms: 2,
    bathrooms: 2,
    squareMeters: 85,
    rentAmount: 2500000,
    depositAmount: 5000000,
    amenities: ['Balcony', 'Ocean View'],
    images: [],
    currentOccupancyId: 'occupancy-001',
    createdAt: new Date('2024-01-01'),
    createdBy: 'user-001',
    updatedAt: new Date('2024-01-01'),
    updatedBy: 'user-001',
  },
  {
    id: 'unit-002',
    tenantId: 'tenant-001',
    propertyId: 'property-001',
    unitNumber: 'A102',
    floor: 1,
    type: '1BR',
    status: UnitStatus.OCCUPIED,
    bedrooms: 1,
    bathrooms: 1,
    squareMeters: 55,
    rentAmount: 1500000,
    depositAmount: 3000000,
    amenities: [],
    images: [],
    currentOccupancyId: 'occupancy-002',
    createdAt: new Date('2024-01-01'),
    createdBy: 'user-001',
    updatedAt: new Date('2024-01-01'),
    updatedBy: 'user-001',
  },
  {
    id: 'unit-003',
    tenantId: 'tenant-001',
    propertyId: 'property-001',
    unitNumber: 'B201',
    floor: 2,
    type: '3BR',
    status: UnitStatus.AVAILABLE,
    bedrooms: 3,
    bathrooms: 2,
    squareMeters: 120,
    rentAmount: 3500000,
    depositAmount: 7000000,
    amenities: ['Balcony', 'Ocean View', 'Maid Room'],
    images: [],
    createdAt: new Date('2024-01-01'),
    createdBy: 'user-001',
    updatedAt: new Date('2024-01-01'),
    updatedBy: 'user-001',
  },
];

// Demo customers
export let DEMO_CUSTOMERS: Customer[] = [
  {
    id: 'customer-001',
    tenantId: 'tenant-001',
    type: 'INDIVIDUAL',
    firstName: 'James',
    lastName: 'Mkenda',
    email: 'james.mkenda@email.com',
    phone: '+255 755 111 001',
    idNumber: 'TZ-123456789',
    idType: 'NATIONAL_ID',
    preferences: {
      preferredChannel: 'WHATSAPP',
      language: 'sw',
      quietHoursEnabled: true,
      quietHoursStart: '22:00',
      quietHoursEnd: '07:00',
    },
    verificationStatus: DocumentVerificationStatus.VERIFIED,
    riskScore: 15,
    createdAt: new Date('2024-03-01'),
    createdBy: 'user-002',
    updatedAt: new Date('2024-03-01'),
    updatedBy: 'user-002',
  },
  {
    id: 'customer-002',
    tenantId: 'tenant-001',
    type: 'COMPANY',
    firstName: 'Maria',
    lastName: 'Swai',
    email: 'maria@techcorp.co.tz',
    phone: '+255 755 111 002',
    companyName: 'TechCorp Tanzania Ltd',
    companyRegNumber: 'TZ-CORP-2024-001',
    preferences: {
      preferredChannel: 'EMAIL',
      language: 'en',
      quietHoursEnabled: false,
    },
    verificationStatus: DocumentVerificationStatus.VERIFIED,
    riskScore: 8,
    createdAt: new Date('2024-04-01'),
    createdBy: 'user-002',
    updatedAt: new Date('2024-04-01'),
    updatedBy: 'user-002',
  },
];

// Demo leases
export let DEMO_LEASES: Lease[] = [
  {
    id: 'lease-001',
    tenantId: 'tenant-001',
    unitId: 'unit-001',
    customerId: 'customer-001',
    status: LeaseStatus.ACTIVE,
    startDate: new Date('2024-03-01'),
    endDate: new Date('2025-02-28'),
    rentAmount: 2500000,
    depositAmount: 5000000,
    depositPaid: 5000000,
    paymentDueDay: 5,
    terms: {
      gracePeriodDays: 5,
      noticePeriodDays: 30,
      allowPets: false,
      allowSubletting: false,
      utilitiesIncluded: [],
    },
    signedAt: new Date('2024-02-25'),
    signedByCustomer: true,
    signedByManager: true,
    createdAt: new Date('2024-02-20'),
    createdBy: 'user-002',
    updatedAt: new Date('2024-02-25'),
    updatedBy: 'user-002',
  },
  {
    id: 'lease-002',
    tenantId: 'tenant-001',
    unitId: 'unit-002',
    customerId: 'customer-002',
    status: LeaseStatus.ACTIVE,
    startDate: new Date('2024-04-01'),
    endDate: new Date('2025-03-31'),
    rentAmount: 1500000,
    depositAmount: 3000000,
    depositPaid: 3000000,
    paymentDueDay: 1,
    terms: {
      gracePeriodDays: 5,
      noticePeriodDays: 30,
      allowPets: false,
      allowSubletting: false,
      utilitiesIncluded: ['Water'],
    },
    signedAt: new Date('2024-03-28'),
    signedByCustomer: true,
    signedByManager: true,
    createdAt: new Date('2024-03-20'),
    createdBy: 'user-002',
    updatedAt: new Date('2024-03-28'),
    updatedBy: 'user-002',
  },
];

// Demo vendors
export let DEMO_VENDORS: Vendor[] = [
  {
    id: 'vendor-001',
    tenantId: 'tenant-001',
    name: 'John Masanja',
    companyName: 'Masanja Plumbing & HVAC',
    email: 'john@masanja-plumbing.co.tz',
    phone: '+255 755 222 001',
    categories: [WorkOrderCategory.PLUMBING, WorkOrderCategory.HVAC],
    isAvailable: true,
    rating: 4.8,
    completedJobs: 45,
    responseTimeHours: 4,
    createdAt: new Date('2024-06-01'),
    createdBy: 'user-001',
    updatedAt: new Date('2024-06-01'),
    updatedBy: 'user-001',
  },
  {
    id: 'vendor-002',
    tenantId: 'tenant-001',
    name: 'Sarah Mwangi',
    companyName: 'Mwangi Electrical Services',
    email: 'sarah@mwangi-electrical.co.tz',
    phone: '+255 755 222 002',
    categories: [WorkOrderCategory.ELECTRICAL],
    isAvailable: true,
    rating: 4.5,
    completedJobs: 32,
    responseTimeHours: 6,
    createdAt: new Date('2024-07-01'),
    createdBy: 'user-001',
    updatedAt: new Date('2024-07-01'),
    updatedBy: 'user-001',
  },
  {
    id: 'vendor-003',
    tenantId: 'tenant-001',
    name: 'Hassan Bakari',
    companyName: 'Bakari General Maintenance',
    email: 'hassan@bakari.co.tz',
    phone: '+255 755 222 003',
    categories: [WorkOrderCategory.PLUMBING, WorkOrderCategory.ELECTRICAL, WorkOrderCategory.STRUCTURAL, WorkOrderCategory.GENERAL],
    isAvailable: false,
    rating: 4.2,
    completedJobs: 28,
    responseTimeHours: 8,
    createdAt: new Date('2024-08-01'),
    createdBy: 'user-001',
    updatedAt: new Date('2024-08-01'),
    updatedBy: 'user-001',
  },
];

// Demo work orders
export let DEMO_WORK_ORDERS: WorkOrder[] = [
  {
    id: 'wo-001',
    tenantId: 'tenant-001',
    unitId: 'unit-001',
    propertyId: 'property-001',
    customerId: 'customer-001',
    vendorId: 'vendor-001',
    assignedTo: 'vendor-001',
    category: WorkOrderCategory.PLUMBING,
    priority: WorkOrderPriority.HIGH,
    status: WorkOrderStatus.IN_PROGRESS,
    title: 'Kitchen sink leak',
    description: 'Water leaking from under the kitchen sink, appears to be from the pipe connection',
    reportedAt: new Date('2026-02-10'),
    scheduledAt: new Date('2026-02-12'),
    slaDeadline: new Date('2026-02-13'),
    evidence: {
      beforePhotos: [],
      afterPhotos: [],
      videos: [],
      voiceNotes: [],
    },
    notes: [],
    createdAt: new Date('2026-02-10'),
    createdBy: 'customer-001',
    updatedAt: new Date('2026-02-11'),
    updatedBy: 'user-002',
  },
  {
    id: 'wo-002',
    tenantId: 'tenant-001',
    unitId: 'unit-002',
    propertyId: 'property-001',
    customerId: 'customer-002',
    category: WorkOrderCategory.ELECTRICAL,
    priority: WorkOrderPriority.MEDIUM,
    status: WorkOrderStatus.SUBMITTED,
    title: 'Bedroom light fixture not working',
    description: 'The main bedroom ceiling light stopped working. Changed bulb but still no power.',
    reportedAt: new Date('2026-02-11'),
    evidence: {
      beforePhotos: [],
      afterPhotos: [],
      videos: [],
      voiceNotes: [],
    },
    notes: [],
    createdAt: new Date('2026-02-11'),
    createdBy: 'customer-002',
    updatedAt: new Date('2026-02-11'),
    updatedBy: 'customer-002',
  },
  {
    id: 'wo-003',
    tenantId: 'tenant-001',
    unitId: 'unit-001',
    propertyId: 'property-001',
    customerId: 'customer-001',
    vendorId: 'vendor-001',
    assignedTo: 'vendor-001',
    category: WorkOrderCategory.HVAC,
    priority: WorkOrderPriority.LOW,
    status: WorkOrderStatus.COMPLETED,
    title: 'AC filter replacement',
    description: 'Regular AC maintenance and filter replacement needed',
    reportedAt: new Date('2026-01-15'),
    scheduledAt: new Date('2026-01-20'),
    completedAt: new Date('2026-01-20'),
    estimatedCost: 50000,
    actualCost: 45000,
    evidence: {
      beforePhotos: [],
      afterPhotos: [],
      videos: [],
      voiceNotes: [],
    },
    notes: [],
    createdAt: new Date('2026-01-15'),
    createdBy: 'customer-001',
    updatedAt: new Date('2026-01-20'),
    updatedBy: 'user-002',
  },
];

// Demo invoices
export let DEMO_INVOICES: Invoice[] = [
  {
    id: 'inv-001',
    tenantId: 'tenant-001',
    number: 'INV-2026-001',
    customerId: 'customer-001',
    leaseId: 'lease-001',
    status: InvoiceStatus.PAID,
    type: 'RENT',
    periodStart: new Date('2026-02-01'),
    periodEnd: new Date('2026-02-28'),
    dueDate: new Date('2026-02-05'),
    subtotal: 2500000,
    tax: 0,
    total: 2500000,
    amountPaid: 2500000,
    amountDue: 0,
    currency: 'TZS',
    lineItems: [
      {
        id: 'li-001',
        description: 'Monthly Rent - Unit A101 - February 2026',
        quantity: 1,
        unitPrice: 2500000,
        total: 2500000,
      },
    ],
    paidAt: new Date('2026-02-03'),
    createdAt: new Date('2026-02-01'),
    createdBy: 'system',
    updatedAt: new Date('2026-02-03'),
    updatedBy: 'system',
  },
  {
    id: 'inv-002',
    tenantId: 'tenant-001',
    number: 'INV-2026-002',
    customerId: 'customer-002',
    leaseId: 'lease-002',
    status: InvoiceStatus.PARTIALLY_PAID,
    type: 'RENT',
    periodStart: new Date('2026-02-01'),
    periodEnd: new Date('2026-02-28'),
    dueDate: new Date('2026-02-01'),
    subtotal: 1500000,
    tax: 0,
    total: 1500000,
    amountPaid: 1000000,
    amountDue: 500000,
    currency: 'TZS',
    lineItems: [
      {
        id: 'li-002',
        description: 'Monthly Rent - Unit A102 - February 2026',
        quantity: 1,
        unitPrice: 1500000,
        total: 1500000,
      },
    ],
    createdAt: new Date('2026-02-01'),
    createdBy: 'system',
    updatedAt: new Date('2026-02-05'),
    updatedBy: 'system',
  },
  {
    id: 'inv-003',
    tenantId: 'tenant-001',
    number: 'INV-2026-003',
    customerId: 'customer-001',
    leaseId: 'lease-001',
    status: InvoiceStatus.OVERDUE,
    type: 'RENT',
    periodStart: new Date('2026-01-01'),
    periodEnd: new Date('2026-01-31'),
    dueDate: new Date('2026-01-05'),
    subtotal: 2500000,
    tax: 0,
    total: 2500000,
    amountPaid: 0,
    amountDue: 2500000,
    currency: 'TZS',
    lineItems: [
      {
        id: 'li-003',
        description: 'Monthly Rent - Unit A101 - January 2026',
        quantity: 1,
        unitPrice: 2500000,
        total: 2500000,
      },
    ],
    createdAt: new Date('2026-01-01'),
    createdBy: 'system',
    updatedAt: new Date('2026-01-01'),
    updatedBy: 'system',
  },
];

// Demo payments
export let DEMO_PAYMENTS: Payment[] = [
  {
    id: 'pay-001',
    tenantId: 'tenant-001',
    invoiceId: 'inv-001',
    customerId: 'customer-001',
    amount: 2500000,
    currency: 'TZS',
    method: PaymentMethod.MPESA,
    status: PaymentStatus.COMPLETED,
    reference: 'PAY-2026-001',
    externalReference: 'MPESA-TX-001',
    processedAt: new Date('2026-02-03'),
    createdAt: new Date('2026-02-03'),
    createdBy: 'customer-001',
    updatedAt: new Date('2026-02-03'),
    updatedBy: 'system',
  },
  {
    id: 'pay-002',
    tenantId: 'tenant-001',
    invoiceId: 'inv-002',
    customerId: 'customer-002',
    amount: 1000000,
    currency: 'TZS',
    method: PaymentMethod.BANK_TRANSFER,
    status: PaymentStatus.COMPLETED,
    reference: 'PAY-2026-002',
    processedAt: new Date('2026-02-05'),
    createdAt: new Date('2026-02-05'),
    createdBy: 'customer-002',
    updatedAt: new Date('2026-02-05'),
    updatedBy: 'system',
  },
];

// Demo documents
export let DEMO_DOCUMENTS: Document[] = [
  {
    id: 'doc-001',
    tenantId: 'tenant-001',
    type: DocumentType.LEASE,
    name: 'Lease Agreement - A101',
    mimeType: 'application/pdf',
    size: 256000,
    url: '/documents/lease-001.pdf',
    verificationStatus: DocumentVerificationStatus.VERIFIED,
    verifiedAt: new Date('2024-02-25'),
    verifiedBy: 'user-002',
    tags: ['lease', 'signed'],
    relatedEntityType: 'lease',
    relatedEntityId: 'lease-001',
    createdAt: new Date('2024-02-25'),
    createdBy: 'user-002',
    updatedAt: new Date('2024-02-25'),
    updatedBy: 'user-002',
  },
  {
    id: 'doc-002',
    tenantId: 'tenant-001',
    type: DocumentType.ID_DOCUMENT,
    name: 'National ID - James Mkenda',
    mimeType: 'image/jpeg',
    size: 125000,
    url: '/documents/id-001.jpg',
    verificationStatus: DocumentVerificationStatus.VERIFIED,
    verifiedAt: new Date('2024-03-01'),
    verifiedBy: 'user-002',
    tags: ['id', 'verified'],
    relatedEntityType: 'customer',
    relatedEntityId: 'customer-001',
    createdAt: new Date('2024-03-01'),
    createdBy: 'user-002',
    updatedAt: new Date('2024-03-01'),
    updatedBy: 'user-002',
  },
];

// Demo approvals
export let DEMO_APPROVALS: Approval[] = [
  {
    id: 'approval-001',
    tenantId: 'tenant-001',
    type: 'work_order_approval',
    status: ApprovalStatus.PENDING,
    requesterId: 'user-002',
    entityType: 'work_order',
    entityId: 'wo-002',
    requestedAction: 'approve',
    justification: 'Work order needs owner approval - electrical work exceeds threshold',
    escalationLevel: 0,
    createdAt: new Date('2026-02-11'),
    createdBy: 'user-002',
    updatedAt: new Date('2026-02-11'),
    updatedBy: 'user-002',
  },
  {
    id: 'approval-002',
    tenantId: 'tenant-001',
    type: 'rent_adjustment',
    status: ApprovalStatus.APPROVED,
    requesterId: 'user-002',
    approverId: 'user-003',
    entityType: 'lease',
    entityId: 'lease-001',
    requestedAction: 'adjust_rent',
    justification: 'Annual rent increase of 5%',
    decision: 'Approved as requested',
    decidedAt: new Date('2026-01-15'),
    escalationLevel: 0,
    createdAt: new Date('2026-01-10'),
    createdBy: 'user-002',
    updatedAt: new Date('2026-01-15'),
    updatedBy: 'user-003',
  },
];

// Helper functions
export function getById<T extends { id: string }>(items: T[], id: string): T | undefined {
  return items.find((item) => item.id === id);
}

export function getByTenant<T extends { tenantId: string }>(items: T[], tenantId: string): T[] {
  return items.filter((item) => item.tenantId === tenantId);
}

/** Get by ID excluding soft-deleted items */
export function getActiveById<T extends { id: string; deletedAt?: Date }>(
  items: T[],
  id: string
): T | undefined {
  const item = items.find((i) => i.id === id);
  return item && !item.deletedAt ? item : undefined;
}

/** Get by tenant excluding soft-deleted items */
export function getActiveByTenant<T extends { tenantId: string; deletedAt?: Date }>(
  items: T[],
  tenantId: string
): T[] {
  return items.filter((item) => item.tenantId === tenantId && !item.deletedAt);
}

// Mutation helpers for properties and units (in-memory store for demo)
function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createProperty(
  data: Omit<Property, 'id' | 'tenantId' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
  tenantId: string,
  userId: string
): Property {
  const now = new Date();
  const property: Property = {
    ...data,
    id: generateId('property'),
    tenantId,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
  };
  DEMO_PROPERTIES.push(property);
  return property;
}

export function updateProperty(
  id: string,
  data: Partial<Property>,
  userId: string
): Property | null {
  const idx = DEMO_PROPERTIES.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  const now = new Date();
  DEMO_PROPERTIES[idx] = {
    ...DEMO_PROPERTIES[idx],
    ...data,
    updatedAt: now,
    updatedBy: userId,
  };
  return DEMO_PROPERTIES[idx];
}

export function softDeleteProperty(id: string): Property | null {
  return updateProperty(id, { deletedAt: new Date() }, 'system');
}

export function createUnit(
  data: Omit<Unit, 'id' | 'tenantId' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
  tenantId: string,
  userId: string
): Unit {
  const now = new Date();
  const unit: Unit = {
    ...data,
    id: generateId('unit'),
    tenantId,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
  };
  DEMO_UNITS.push(unit);
  return unit;
}

export function updateUnit(
  id: string,
  data: Partial<Unit>,
  userId: string
): Unit | null {
  const idx = DEMO_UNITS.findIndex((u) => u.id === id);
  if (idx === -1) return null;
  const now = new Date();
  DEMO_UNITS[idx] = {
    ...DEMO_UNITS[idx],
    ...data,
    updatedAt: now,
    updatedBy: userId,
  };
  return DEMO_UNITS[idx];
}

export function softDeleteUnit(id: string): Unit | null {
  return updateUnit(id, { deletedAt: new Date() }, 'system');
}

// Work order mutation helpers
export function createWorkOrder(
  data: Omit<WorkOrder, 'id' | 'tenantId' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
  tenantId: string,
  userId: string
): WorkOrder {
  const now = new Date();
  const wo: WorkOrder = {
    ...data,
    id: generateId('wo'),
    tenantId,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
  };
  DEMO_WORK_ORDERS.push(wo);
  return wo;
}

export function updateWorkOrder(
  id: string,
  data: Partial<WorkOrder>,
  userId: string
): WorkOrder | null {
  const idx = DEMO_WORK_ORDERS.findIndex((wo) => wo.id === id);
  if (idx === -1) return null;
  const now = new Date();
  DEMO_WORK_ORDERS[idx] = {
    ...DEMO_WORK_ORDERS[idx],
    ...data,
    updatedAt: now,
    updatedBy: userId,
  };
  return DEMO_WORK_ORDERS[idx];
}

// Vendor mutation helpers
export function createVendor(
  data: Omit<Vendor, 'id' | 'tenantId' | 'createdAt' | 'createdBy' | 'updatedAt' | 'updatedBy'>,
  tenantId: string,
  userId: string
): Vendor {
  const now = new Date();
  const vendor: Vendor = {
    ...data,
    id: generateId('vendor'),
    tenantId,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
  };
  DEMO_VENDORS.push(vendor);
  return vendor;
}

export function updateVendor(
  id: string,
  data: Partial<Vendor>,
  userId: string
): Vendor | null {
  const idx = DEMO_VENDORS.findIndex((v) => v.id === id);
  if (idx === -1) return null;
  const now = new Date();
  DEMO_VENDORS[idx] = {
    ...DEMO_VENDORS[idx],
    ...data,
    updatedAt: now,
    updatedBy: userId,
  };
  return DEMO_VENDORS[idx];
}

export function softDeleteVendor(id: string): Vendor | null {
  return updateVendor(id, { deletedAt: new Date() }, 'system');
}

export function paginate<T>(
  items: T[],
  page: number,
  pageSize: number
): {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
} {
  const totalItems = items.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  const start = (page - 1) * pageSize;
  const end = start + pageSize;

  return {
    data: items.slice(start, end),
    pagination: {
      page,
      pageSize,
      totalItems,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

// Runtime guard removed — the previous implementation referenced
// `RUNTIME_DEMO_DATA_ALLOWED` / `blockRuntimeDemoData` which were never
// defined. Location under `__tests__/fixtures/` is already the enforcement
// mechanism: production builds of `src/` cannot import this module.
