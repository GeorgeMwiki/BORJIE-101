/**
 * Pre-shipped tenant-scoped MCP servers for the BORJIE domain.
 *
 * Each factory takes a port (e.g. `PropertyPort`) so consumers can plug in
 * whichever backing implementation they prefer — a real DB adapter, a
 * Supabase-backed adapter, an in-memory adapter for tests, etc.
 */

export {
  createPropertyMCPServer,
  type PropertyMCPServerConfig,
} from './property-server.js';

export {
  createPaymentsMCPServer,
  type PaymentsMCPServerConfig,
} from './payments-server.js';

export {
  createMaintenanceMCPServer,
  type MaintenanceMCPServerConfig,
} from './maintenance-server.js';

export {
  createDocumentsMCPServer,
  type DocumentsMCPServerConfig,
} from './documents-server.js';

export {
  createGeoMCPServer,
  type GeoMCPServerConfig,
} from './geo-server.js';

export type {
  Property,
  Unit,
  Lease,
  PropertyPort,
  LedgerEntry,
  ArrearsRecord,
  PaymentsPort,
  MaintenanceTicket,
  MaintenancePort,
  DocumentRecord,
  DocumentsPort,
  Parcel,
  Segment,
  GeoPort,
} from './ports.js';
