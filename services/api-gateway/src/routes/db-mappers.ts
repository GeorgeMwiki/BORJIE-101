
/**
 * Money conversion helpers.
 *
 * IMPORTANT: this codebase treats money as integer MINOR UNITS
 * (e.g. KES cents) at every layer — DB columns, API payloads, tests,
 * fixtures. There is no "major units" conversion in the request path;
 * clients submit minor-unit integers directly, and the formatCurrency
 * helper at display time divides by 100.
 *
 * These helpers therefore normalize/round incoming values WITHOUT
 * multiplying — they exist so a client that accidentally submits a
 * float (e.g. 50000.4) gets truncated to a safe integer before hitting
 * the DB integer column.
 *
 * Do NOT change these to multiply/divide by 100 without coordinating
 * a breaking-change migration of every fixture, integration test,
 * and client payload. A mass-rename pass is tracked separately.
 */

function asNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Normalize an incoming money value to an integer minor-unit amount.
 * Clients submit minor-units directly; this is effectively a safe-int
 * coerce that rejects NaN / undefined as 0 and rounds floats.
 */
export function majorToMinor(amount: number | undefined | null): number {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/**
 * Read a minor-unit amount from the DB. Identity today — kept as a
 * seam for future major/minor migration so callsites are already
 * wrapping their reads.
 */
export function minorToMajor(amount: number | undefined | null): number {
  const n = Number(amount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function paginateArray(items: any[], page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const totalItems = items.length;
  const totalPages = Math.ceil(totalItems / pageSize);
  return {
    data: items.slice(offset, offset + pageSize),
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

export function normalizePropertyTypeToDb(type?: string) {
  switch ((type ?? '').toUpperCase()) {
    case 'RESIDENTIAL':
      return 'apartment_complex';
    case 'COMMERCIAL':
      return 'commercial';
    case 'MIXED':
      return 'mixed_use';
    default:
      return type?.toLowerCase() || 'apartment_complex';
  }
}

export function normalizePropertyStatusToDb(status?: string) {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'active';
    case 'INACTIVE':
      return 'inactive';
    case 'UNDER_CONSTRUCTION':
      return 'draft';
    default:
      return status?.toLowerCase() || 'active';
  }
}

export function mapPropertyTypeFromDb(type?: string) {
  switch (type) {
    case 'commercial':
      return 'COMMERCIAL';
    case 'mixed_use':
      return 'MIXED';
    default:
      return 'RESIDENTIAL';
  }
}

export function mapPropertyStatusFromDb(status?: string) {
  switch (status) {
    case 'inactive':
      return 'INACTIVE';
    case 'draft':
      return 'UNDER_CONSTRUCTION';
    default:
      return 'ACTIVE';
  }
}

export function normalizeUnitTypeToDb(type?: string) {
  if (!type) return 'one_bedroom';
  if (type === 'four_bedroom_plus') return 'four_plus_bedroom';
  return type.toLowerCase();
}

export function normalizeUnitStatusToDb(status?: string) {
  switch ((status ?? '').toUpperCase()) {
    case 'AVAILABLE':
      return 'vacant';
    case 'OCCUPIED':
      return 'occupied';
    case 'MAINTENANCE':
      return 'under_maintenance';
    case 'RESERVED':
      return 'reserved';
    default:
      return status?.toLowerCase() || 'vacant';
  }
}

export function mapUnitTypeFromDb(type?: string) {
  if (type === 'four_plus_bedroom') return 'four_bedroom_plus';
  return type || 'one_bedroom';
}

export function mapUnitStatusFromDb(status?: string) {
  switch (status) {
    case 'vacant':
      return 'AVAILABLE';
    case 'occupied':
      return 'OCCUPIED';
    case 'under_maintenance':
      return 'MAINTENANCE';
    case 'reserved':
      return 'RESERVED';
    default:
      return 'NOT_AVAILABLE';
  }
}

export function mapPropertyRow(row: any) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    ownerId: row.ownerId,
    propertyCode: row.propertyCode,
    name: row.name,
    type: mapPropertyTypeFromDb(row.type),
    status: mapPropertyStatusFromDb(row.status),
    address: {
      line1: row.addressLine1,
      line2: row.addressLine2 ?? undefined,
      city: row.city,
      region: row.state ?? undefined,
      postalCode: row.postalCode ?? undefined,
      country: row.country,
      coordinates:
        row.latitude != null && row.longitude != null
          ? {
              latitude: asNumber(row.latitude),
              longitude: asNumber(row.longitude),
            }
          : undefined,
    },
    description: row.description ?? undefined,
    amenities: Array.isArray(row.amenities) ? row.amenities : [],
    features: row.features ?? {},
    images: Array.isArray(row.images) ? row.images : [],
    managerId: row.managerId ?? undefined,
    totalUnits: row.totalUnits ?? 0,
    occupiedUnits: row.occupiedUnits ?? 0,
    settings: row.features ?? {},
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    stats: {
      totalUnits: row.totalUnits ?? 0,
      occupiedUnits: row.occupiedUnits ?? 0,
      availableUnits: row.vacantUnits ?? Math.max((row.totalUnits ?? 0) - (row.occupiedUnits ?? 0), 0),
      occupancyRate:
        (row.totalUnits ?? 0) > 0 ? Math.round(((row.occupiedUnits ?? 0) / row.totalUnits) * 100) : 0,
    },
  };
}

export function mapUnitRow(row: any) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    propertyId: row.propertyId,
    unitNumber: row.unitCode,
    name: row.name,
    floor: row.floor ?? undefined,
    type: mapUnitTypeFromDb(row.type),
    status: mapUnitStatusFromDb(row.status),
    bedrooms: row.bedrooms ?? 0,
    bathrooms: asNumber(row.bathrooms) ?? 0,
    squareMeters: asNumber(row.squareMeters),
    rentAmount: minorToMajor(row.baseRentAmount),
    depositAmount: minorToMajor(row.depositAmount),
    amenities: Array.isArray(row.amenities) ? row.amenities : [],
    images: Array.isArray(row.images) ? row.images : [],
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
    currentLease: row.currentLeaseId ? { id: row.currentLeaseId } : null,
    currentTenant: row.currentCustomerId ? { id: row.currentCustomerId } : null,
  };
}

export function mapCustomerRow(row: any) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: 'INDIVIDUAL',
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    preferences: {},
    verificationStatus: String(row.kycStatus ?? 'pending').toUpperCase(),
    status: String(row.status ?? 'prospect').toUpperCase(),
    blacklisted: Boolean(row.blacklistedAt),
    blacklistReason: row.blacklistedReason ?? undefined,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export function mapLeaseRow(row: any) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    propertyId: row.propertyId,
    unitId: row.unitId,
    customerId: row.customerId,
    leaseNumber: row.leaseNumber,
    status: String(row.status ?? 'draft').toUpperCase(),
    startDate: row.startDate,
    endDate: row.endDate,
    rentAmount: minorToMajor(row.rentAmount),
    depositAmount: minorToMajor(row.securityDepositAmount),
    depositPaid: minorToMajor(row.securityDepositPaid),
    paymentDueDay: row.rentDueDay,
    terms: {
      gracePeriodDays: row.gracePeriodDays,
      noticePeriodDays: row.noticePeriodDays,
      utilitiesIncluded: Array.isArray(row.utilitiesIncludedInRent) ? row.utilitiesIncludedInRent : [],
    },
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

export function mapInvoiceStatusFromDb(status?: string) {
  switch (status) {
    case 'draft':
      return 'DRAFT';
    case 'sent':
      return 'SENT';
    case 'pending':
      return 'PENDING';
    case 'paid':
      return 'PAID';
    case 'partially_paid':
      return 'PARTIALLY_PAID';
    case 'overdue':
      return 'OVERDUE';
    case 'cancelled':
    case 'void':
      return 'CANCELLED';
    default:
      return 'PENDING';
  }
}

export function mapPaymentStatusFromDb(status?: string) {
  return String(status || 'pending').toUpperCase();
}

export function mapInvoiceRow(row: any) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    number: row.invoiceNumber,
    customerId: row.customerId,
    leaseId: row.leaseId ?? undefined,
    status: mapInvoiceStatusFromDb(row.status),
    type: String(row.invoiceType || 'rent').toUpperCase(),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    dueDate: row.dueDate,
    subtotal: minorToMajor(row.subtotalAmount),
    tax: minorToMajor(row.taxAmount),
    total: minorToMajor(row.totalAmount),
    amountPaid: minorToMajor(row.paidAmount),
    amountDue: minorToMajor(row.balanceAmount),
    currency: row.currency,
    lineItems: Array.isArray(row.lineItems) ? row.lineItems : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapPaymentRow(row: any) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    customerId: row.customerId,
    invoiceId: row.invoiceId ?? undefined,
    leaseId: row.leaseId ?? undefined,
    paymentNumber: row.paymentNumber,
    externalReference: row.externalReference ?? undefined,
    status: mapPaymentStatusFromDb(row.status),
    paymentMethod: String(row.paymentMethod || 'other').toUpperCase(),
    amount: minorToMajor(row.amount),
    currency: row.currency,
    feeAmount: minorToMajor(row.feeAmount),
    netAmount: minorToMajor(row.netAmount ?? row.amount),
    description: row.description ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt ?? undefined,
  };
}

export function mapVendorRow(row: any) {
  const primaryContact = Array.isArray(row.contacts) ? row.contacts[0] : undefined;
  return {
    id: row.id,
    tenantId: row.tenantId,
    vendorCode: row.vendorCode,
    companyName: row.companyName,
    name: row.companyName,
    status: String(row.status || 'active').toUpperCase(),
    categories: Array.isArray(row.specializations) ? row.specializations.map((v: string) => String(v).toUpperCase()) : [],
    specializations: Array.isArray(row.specializations) ? row.specializations : [],
    serviceAreas: Array.isArray(row.serviceAreas) ? row.serviceAreas : [],
    contacts: Array.isArray(row.contacts) ? row.contacts : [],
    contactPerson: primaryContact?.name,
    email: primaryContact?.email,
    phone: primaryContact?.phone,
    isAvailable: String(row.status || 'active') === 'active',
    isPreferred: Boolean(row.isPreferred),
    emergencyAvailable: Boolean(row.emergencyAvailable),
    notes: row.notes ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapWorkOrderRow(row: any) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    propertyId: row.propertyId,
    unitId: row.unitId ?? undefined,
    customerId: row.customerId ?? undefined,
    vendorId: row.vendorId ?? undefined,
    ticketNumber: row.workOrderNumber,
    workOrderNumber: row.workOrderNumber,
    assignedToUserId: undefined,
    priority: String(row.priority || 'medium').toUpperCase(),
    status: String(row.status || 'submitted').toUpperCase(),
    category: String(row.category || 'other').toUpperCase(),
    title: row.title,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    estimatedCost: minorToMajor(row.estimatedCost),
    actualCost: minorToMajor(row.actualCost),
    currency: row.currency || 'USD',
    scheduledAt: row.scheduledAt ?? row.scheduledStartAt ?? undefined,
    scheduledDate: row.scheduledAt ?? row.scheduledStartAt ?? undefined,
    completedAt: row.completedAt ?? undefined,
    completionNotes: row.completionNotes ?? undefined,
    timeline: Array.isArray(row.timeline) ? row.timeline : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
