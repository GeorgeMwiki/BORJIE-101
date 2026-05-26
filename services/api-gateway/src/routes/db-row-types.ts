/**
 * Row-shape interfaces consumed by `db-mappers.ts`.
 *
 * These mirror the columns of the legacy BossNyumba property-domain
 * tables (properties, units, leases, vendors, invoices, payments,
 * customers, work_orders). The Borjie mining-domain Drizzle schema does
 * not (yet) ship strongly-typed equivalents — the repositories that
 * back these mappers live in `services/domain-services` and are
 * scaffolded against a hand-maintained row contract. Keeping these
 * interfaces in a dedicated file lets `db-mappers.ts` stay focused on
 * the data-shaping logic and avoids the `row: any` escape hatch.
 *
 * When the equivalent mining-domain tables land in `@borjie/database`
 * these types should be replaced with `typeof <table>.$inferSelect`.
 */

export interface PropertyRowLike {
  id: string;
  tenantId: string;
  ownerId: string;
  propertyCode: string;
  name: string;
  type?: string | null;
  status?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  latitude?: string | number | null;
  longitude?: string | number | null;
  description?: string | null;
  amenities?: readonly string[] | null;
  features?: Record<string, unknown> | null;
  images?: readonly string[] | null;
  managerId?: string | null;
  totalUnits?: number | null;
  occupiedUnits?: number | null;
  vacantUnits?: number | null;
  createdAt: Date | string;
  createdBy: string;
  updatedAt: Date | string;
  updatedBy: string;
}

export interface UnitRowLike {
  id: string;
  tenantId: string;
  propertyId: string;
  unitCode: string;
  name?: string | null;
  floor?: number | null;
  type?: string | null;
  status?: string | null;
  bedrooms?: number | null;
  bathrooms?: string | number | null;
  squareMeters?: string | number | null;
  baseRentAmount?: number | null;
  depositAmount?: number | null;
  amenities?: readonly string[] | null;
  images?: readonly string[] | null;
  currentLeaseId?: string | null;
  currentCustomerId?: string | null;
  createdAt: Date | string;
  createdBy: string;
  updatedAt: Date | string;
  updatedBy: string;
}

export interface CustomerRowLike {
  id: string;
  tenantId: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  kycStatus?: string | null;
  status?: string | null;
  blacklistedAt?: Date | string | null;
  blacklistedReason?: string | null;
  createdAt: Date | string;
  createdBy: string;
  updatedAt: Date | string;
  updatedBy: string;
}

export interface LeaseRowLike {
  id: string;
  tenantId: string;
  propertyId: string;
  unitId: string;
  customerId: string;
  leaseNumber: string;
  status?: string | null;
  startDate: Date | string;
  endDate: Date | string;
  rentAmount?: number | null;
  securityDepositAmount?: number | null;
  securityDepositPaid?: number | null;
  rentDueDay?: number | null;
  gracePeriodDays?: number | null;
  noticePeriodDays?: number | null;
  utilitiesIncludedInRent?: readonly string[] | null;
  createdAt: Date | string;
  createdBy: string;
  updatedAt: Date | string;
  updatedBy: string;
}

export interface InvoiceRowLike {
  id: string;
  tenantId: string;
  invoiceNumber: string;
  customerId: string;
  leaseId?: string | null;
  status?: string | null;
  invoiceType?: string | null;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
  dueDate: Date | string;
  subtotalAmount?: number | null;
  taxAmount?: number | null;
  totalAmount?: number | null;
  paidAmount?: number | null;
  balanceAmount?: number | null;
  currency: string;
  lineItems?: readonly Record<string, unknown>[] | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface PaymentRowLike {
  id: string;
  tenantId: string;
  customerId: string;
  invoiceId?: string | null;
  leaseId?: string | null;
  paymentNumber: string;
  externalReference?: string | null;
  status?: string | null;
  paymentMethod?: string | null;
  amount?: number | null;
  currency: string;
  feeAmount?: number | null;
  netAmount?: number | null;
  description?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt?: Date | string | null;
}

export interface VendorContactLike {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface VendorRowLike {
  id: string;
  tenantId: string;
  vendorCode: string;
  companyName: string;
  status?: string | null;
  specializations?: readonly string[] | null;
  serviceAreas?: readonly string[] | null;
  contacts?: readonly VendorContactLike[] | null;
  isPreferred?: boolean | null;
  emergencyAvailable?: boolean | null;
  notes?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface WorkOrderTimelineEntry {
  at?: Date | string | null;
  action?: string | null;
  note?: string | null;
  actor?: string | null;
}

export interface WorkOrderRowLike {
  id: string;
  tenantId: string;
  propertyId: string;
  unitId?: string | null;
  customerId?: string | null;
  vendorId?: string | null;
  workOrderNumber: string;
  priority?: string | null;
  status?: string | null;
  category?: string | null;
  title: string;
  description?: string | null;
  location?: string | null;
  attachments?: readonly string[] | null;
  estimatedCost?: number | null;
  actualCost?: number | null;
  currency?: string | null;
  scheduledAt?: Date | string | null;
  scheduledStartAt?: Date | string | null;
  completedAt?: Date | string | null;
  completionNotes?: string | null;
  timeline?: readonly WorkOrderTimelineEntry[] | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}
