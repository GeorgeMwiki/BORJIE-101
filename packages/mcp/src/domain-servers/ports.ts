/**
 * Domain ports — minimal interfaces the five pre-shipped MCP servers
 * depend on. We do NOT import `@borjie/database` directly to avoid a
 * heavy dependency edge; consumers inject an adapter that satisfies these
 * ports.
 *
 * Every port method receives an explicit `tenantId` parameter. The server
 * framework's tenant middleware guarantees the caller can never spoof it.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Property port
// ──────────────────────────────────────────────────────────────────────────────

export interface Property {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly addressLine1: string;
  readonly city: string;
  readonly countryCode: string;
  readonly unitsCount: number;
}

export interface Unit {
  readonly id: string;
  readonly propertyId: string;
  readonly tenantId: string;
  readonly label: string;
  readonly bedrooms: number;
  readonly status: 'vacant' | 'occupied' | 'maintenance';
}

export interface Lease {
  readonly id: string;
  readonly unitId: string;
  readonly tenantId: string;
  readonly leaseholderId: string;
  readonly startDate: string;
  readonly endDate?: string;
  readonly monthlyRentMinor: number;
  readonly currency: string;
}

export interface PropertyPort {
  listProperties(
    tenantId: string,
    filters?: { readonly city?: string; readonly q?: string },
  ): Promise<ReadonlyArray<Property>>;
  getProperty(tenantId: string, propertyId: string): Promise<Property | null>;
  createProperty(
    tenantId: string,
    data: Omit<Property, 'id' | 'tenantId' | 'unitsCount'>,
  ): Promise<Property>;
  updateProperty(
    tenantId: string,
    propertyId: string,
    patch: Partial<Omit<Property, 'id' | 'tenantId'>>,
  ): Promise<Property>;
  listUnits(tenantId: string, propertyId: string): Promise<ReadonlyArray<Unit>>;
  listLeases(tenantId: string, unitId: string): Promise<ReadonlyArray<Lease>>;
  getTenantHistory(
    tenantId: string,
    leaseholderId: string,
  ): Promise<ReadonlyArray<Lease>>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Payments port
// ──────────────────────────────────────────────────────────────────────────────

export interface LedgerEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly leaseId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly kind: 'rent-charge' | 'rent-payment' | 'late-fee' | 'refund' | 'adjustment';
  readonly date: string;
  readonly note?: string;
}

export interface ArrearsRecord {
  readonly leaseId: string;
  readonly leaseholderId: string;
  readonly balanceMinor: number;
  readonly currency: string;
  readonly daysOverdue: number;
}

export interface PaymentsPort {
  getRentLedger(
    tenantId: string,
    leaseId: string,
    range?: { readonly from?: string; readonly to?: string },
  ): Promise<ReadonlyArray<LedgerEntry>>;
  recordPayment(
    tenantId: string,
    input: {
      readonly leaseId: string;
      readonly amountMinor: number;
      readonly currency: string;
      readonly date: string;
      readonly note?: string;
    },
  ): Promise<LedgerEntry>;
  listArrears(
    tenantId: string,
    filters?: { readonly minDaysOverdue?: number },
  ): Promise<ReadonlyArray<ArrearsRecord>>;
  computeLateFee(
    tenantId: string,
    leaseId: string,
    asOf?: string,
  ): Promise<{ readonly leaseId: string; readonly feeMinor: number; readonly currency: string }>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Maintenance port
// ──────────────────────────────────────────────────────────────────────────────

export interface MaintenanceTicket {
  readonly id: string;
  readonly tenantId: string;
  readonly propertyId: string;
  readonly unitId?: string;
  readonly title: string;
  readonly description: string;
  readonly status: 'open' | 'assigned' | 'in-progress' | 'completed' | 'cancelled';
  readonly priority: 'low' | 'normal' | 'high' | 'critical';
  readonly assignedTechId?: string;
  readonly createdAt: string;
  readonly completedAt?: string;
}

export interface MaintenancePort {
  listOpenTickets(
    tenantId: string,
    filters?: { readonly propertyId?: string; readonly priority?: MaintenanceTicket['priority'] },
  ): Promise<ReadonlyArray<MaintenanceTicket>>;
  createTicket(
    tenantId: string,
    input: Omit<MaintenanceTicket, 'id' | 'tenantId' | 'createdAt' | 'status' | 'completedAt' | 'assignedTechId'>,
  ): Promise<MaintenanceTicket>;
  assignTechnician(
    tenantId: string,
    ticketId: string,
    technicianId: string,
  ): Promise<MaintenanceTicket>;
  recordCompletion(
    tenantId: string,
    ticketId: string,
    note?: string,
  ): Promise<MaintenanceTicket>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Documents port
// ──────────────────────────────────────────────────────────────────────────────

export interface DocumentRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly bytesUrl: string;
  readonly size: number;
  readonly tags?: ReadonlyArray<string>;
  readonly uploadedAt: string;
}

export interface DocumentsPort {
  listDocuments(
    tenantId: string,
    filters?: { readonly tag?: string; readonly q?: string },
  ): Promise<ReadonlyArray<DocumentRecord>>;
  getDocument(tenantId: string, documentId: string): Promise<DocumentRecord | null>;
  uploadDocument(
    tenantId: string,
    input: {
      readonly name: string;
      readonly mimeType: string;
      readonly content: Uint8Array | string;
      readonly tags?: ReadonlyArray<string>;
    },
  ): Promise<DocumentRecord>;
  chatWithDocument(
    tenantId: string,
    documentId: string,
    question: string,
  ): Promise<{ readonly answer: string; readonly citations?: ReadonlyArray<string> }>;
}

// ──────────────────────────────────────────────────────────────────────────────
// Geo / knowledge-graph port
// ──────────────────────────────────────────────────────────────────────────────

export interface Parcel {
  readonly id: string;
  readonly tenantId: string;
  readonly geoJson: unknown;
  readonly historyEvents?: ReadonlyArray<{ readonly date: string; readonly event: string }>;
}

export interface Segment {
  readonly id: string;
  readonly name: string;
  readonly kind: 'street' | 'district' | 'block';
}

export interface GeoPort {
  findNearestParcels(
    tenantId: string,
    point: { readonly lat: number; readonly lng: number },
    limit?: number,
  ): Promise<ReadonlyArray<Parcel & { readonly distanceMeters: number }>>;
  getParcelHistory(tenantId: string, parcelId: string): Promise<Parcel | null>;
  listSegments(tenantId: string, kind?: Segment['kind']): Promise<ReadonlyArray<Segment>>;
}
