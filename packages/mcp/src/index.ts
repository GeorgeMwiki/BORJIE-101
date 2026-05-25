/**
 * `@borjie/mcp` — public barrel.
 *
 * Deep Model Context Protocol primitives. The package is composed of
 * subsystems, each also exported via a sub-path
 * (`@borjie/mcp/transport`, `/server`, `/client`, `/discovery`,
 * `/domain-servers`, `/auth`).
 *
 * The default barrel re-exports the most commonly-used surface so simple
 * consumers can `import { createMCPServer, createMCPClient } from
 * '@borjie/mcp'` without ceremony.
 */

// Types
export * from './types.js';

// Transports
export {
  createStdioTransport,
  createSSETransport,
  createStreamableHTTPTransport,
  createInMemoryTransportPair,
  type StdioTransportOptions,
  type SSETransportOptions,
  type StreamableHTTPTransportOptions,
  type InMemoryTransportPair,
} from './transport/index.js';

// Server framework
export {
  createMCPServer,
  type MCPServer,
  type MCPServerConfig,
  type AttachedSession,
  zodToJsonSchema,
} from './server/index.js';

// Client
export {
  createMCPClient,
  type MCPClient,
  type MCPClientOptions,
} from './client/index.js';

// Discovery
export {
  discoverFromConfig,
  namespace,
  unnamespace,
  createToolRouter,
  MCPConfigSchema,
  MCPServerConfigSchema,
  type DiscoveredServer,
  type MCPConfig,
  type MCPServerConfigEntry,
  type ToolRouter,
} from './discovery/index.js';

// Auth
export {
  createOAuthPKCEFlow,
  createBearerAuth,
  createServiceTokenAuth,
  type AuthProvider,
  type OAuthPKCEConfig,
  type OAuthPKCEFlow,
  type PKCEChallenge,
  type ServiceTokenStore,
} from './auth/index.js';

// Domain servers
export {
  createPropertyMCPServer,
  createPaymentsMCPServer,
  createMaintenanceMCPServer,
  createDocumentsMCPServer,
  createGeoMCPServer,
  type PropertyMCPServerConfig,
  type PaymentsMCPServerConfig,
  type MaintenanceMCPServerConfig,
  type DocumentsMCPServerConfig,
  type GeoMCPServerConfig,
  type Property,
  type Unit,
  type Lease,
  type PropertyPort,
  type LedgerEntry,
  type ArrearsRecord,
  type PaymentsPort,
  type MaintenanceTicket,
  type MaintenancePort,
  type DocumentRecord,
  type DocumentsPort,
  type Parcel,
  type Segment,
  type GeoPort,
} from './domain-servers/index.js';

// ──────────────────────────────────────────────────────────────────────────────
// createMCP — convenience composition helper
// ──────────────────────────────────────────────────────────────────────────────

import type { MCPServer } from './server/index.js';
import type { MCPClient } from './client/index.js';
import type { AuditPort } from './types.js';

/**
 * `createMCP({ servers, clients, audit })` is a convenience entrypoint that
 * keeps a typed bag of running servers + clients + the audit port in one
 * place. Useful when wiring an app that needs both sides (e.g. hosts the
 * Property MCP server *and* connects to an external github MCP server).
 */
export interface MCPBundle {
  readonly servers: ReadonlyMap<string, MCPServer>;
  readonly clients: ReadonlyMap<string, MCPClient>;
  readonly audit?: AuditPort;
}

export function createMCP(opts: {
  readonly servers?: Readonly<Record<string, MCPServer>>;
  readonly clients?: Readonly<Record<string, MCPClient>>;
  readonly audit?: AuditPort;
}): MCPBundle {
  const servers = new Map(Object.entries(opts.servers ?? {}));
  const clients = new Map(Object.entries(opts.clients ?? {}));
  const bundle: { -readonly [K in keyof MCPBundle]: MCPBundle[K] } = { servers, clients };
  if (opts.audit) bundle.audit = opts.audit;
  return bundle;
}
