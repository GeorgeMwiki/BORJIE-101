/**
 * Connector fabric — the universal outward-integration seam.
 *
 * ONE governed dispatch surface over the 21 connector packages
 * (`packages/connectors/<id>/`), discovered from the declarative
 * `CONNECTOR_CATALOG` (connector-catalog.ts). The fabric answers three
 * questions, generically, for ANY catalog entry:
 *
 *   - `list(tenantId)`    → every connector + this tenant's connection state
 *   - `status(tenantId)`  → one connector's lifecycle status (accounts, scopes)
 *   - `invoke(request)`   → run a declared action through the bound invoker
 *
 * Connection state is read from the shared `connector_credentials` table
 * (tenant-scoped, RLS-forced; tokens are AES-GCM `bytea` ciphertext the
 * fabric NEVER decrypts — only presence/expiry/scopes are surfaced).
 *
 * HONEST DEGRADATION (never fake, never crash):
 *   - credential store unreachable → `connected:false` + explicit reason
 *   - tenant not connected         → `not_connected` outcome + reason
 *   - no runtime invoker bound     → `not_provisioned` outcome + reason
 *     (the composition root binds per-connector invokers onto
 *     `services.connectorInvokers` ONLY when that connector's OAuth app
 *     credentials + runtime are provisioned — mirroring the
 *     legacy-portal `services.legacyPortalFileKra` precedent)
 *   - invoker throws               → `invoker_error` outcome, message only
 *
 * Tenant isolation: every query binds the caller's `tenantId` (the
 * natural key of `connector_credentials`) on top of the FORCE-RLS
 * policy bound by the gateway database middleware. No cross-tenant path
 * exists.
 */

import { sql } from 'drizzle-orm';

import {
  CONNECTOR_CATALOG,
  getConnectorDescriptor,
  type ConnectorDescriptor,
} from './connector-catalog.js';

// ---------- Ports ----------

export interface FabricDb {
  execute(query: unknown): Promise<unknown>;
}

export interface ConnectorInvokeRequest {
  readonly tenantId: string;
  readonly actorId: string;
  readonly connectorId: string;
  readonly action: string;
  readonly input: Readonly<Record<string, unknown>>;
}

/**
 * The runtime seam — one function per PROVISIONED connector, bound by
 * the composition root onto `services.connectorInvokers`. A connector
 * with no bound invoker degrades honestly to `not_provisioned`.
 */
export interface ConnectorInvoker {
  (request: ConnectorInvokeRequest): Promise<unknown>;
}

export type ConnectorInvokerMap = Readonly<Record<string, ConnectorInvoker>>;

// ---------- Status shapes ----------

export interface ConnectorAccountStatus {
  readonly account: string;
  readonly kind: string;
  readonly scopes: ReadonlyArray<string>;
  readonly expiresAt: string | null;
}

export interface ConnectorConnectionStatus {
  readonly connectorId: string;
  readonly connected: boolean;
  /** False when the credential store could not be read (status unknown). */
  readonly storeAvailable: boolean;
  readonly accounts: ReadonlyArray<ConnectorAccountStatus>;
  readonly reason?: string;
}

export interface ConnectorListEntry {
  readonly id: string;
  readonly displayName: string;
  readonly category: string;
  readonly description: string;
  readonly packageName: string;
  readonly actions: ConnectorDescriptor['actions'];
  readonly connected: boolean;
  readonly accountCount: number;
  readonly reason?: string;
}

// ---------- Invoke outcomes (discriminated, route maps to HTTP) ----------

export type ConnectorInvokeOutcome =
  | { readonly kind: 'unknown_connector'; readonly connectorId: string }
  | {
      readonly kind: 'unknown_action';
      readonly connectorId: string;
      readonly action: string;
      readonly availableActions: ReadonlyArray<string>;
    }
  | {
      readonly kind: 'not_connected';
      readonly connectorId: string;
      readonly connected: false;
      readonly reason: string;
    }
  | {
      readonly kind: 'not_provisioned';
      readonly connectorId: string;
      readonly connected: boolean;
      readonly reason: string;
    }
  | {
      readonly kind: 'invoker_error';
      readonly connectorId: string;
      readonly reason: string;
    }
  | {
      readonly kind: 'ok';
      readonly connectorId: string;
      readonly action: string;
      readonly data: unknown;
    };

// ---------- Helpers ----------

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = result as {
    rows?: ReadonlyArray<Record<string, unknown>>;
  };
  return wrapped?.rows ?? [];
}

function toAccountStatus(
  row: Record<string, unknown>,
): ConnectorAccountStatus {
  const scopesRaw = row.scopes;
  const scopes = Array.isArray(scopesRaw)
    ? Object.freeze(
        scopesRaw.filter((s): s is string => typeof s === 'string'),
      )
    : Object.freeze([] as string[]);
  const expires = row.expires_at;
  return Object.freeze({
    account: typeof row.connector_account === 'string' ? row.connector_account : '',
    kind: typeof row.connector_kind === 'string' ? row.connector_kind : '',
    scopes,
    expiresAt:
      expires instanceof Date
        ? expires.toISOString()
        : typeof expires === 'string'
          ? expires
          : null,
  });
}

const STORE_UNAVAILABLE_REASON =
  'connection store unreachable — connection status unknown for this ' +
  'environment; no external call was attempted';

const notConnectedReason = (descriptor: ConnectorDescriptor): string =>
  `tenant has not connected ${descriptor.displayName} — no OAuth credentials ` +
  `on record (kinds: ${descriptor.credentialKinds.join(', ')}). Connect it ` +
  'from Settings → Integrations first; no external call was attempted and ' +
  'no data was fabricated';

const notProvisionedReason = (descriptor: ConnectorDescriptor): string =>
  `${descriptor.displayName} is wired + governed but its runtime invoker is ` +
  'not provisioned in this environment (the composition root binds ' +
  `services.connectorInvokers['${descriptor.id}'] only when the provider ` +
  'app credentials are configured). No external call was attempted and no ' +
  'data was fabricated';

// ---------- Fabric ----------

export interface ConnectorFabricDeps {
  /** Request-scoped, RLS-bound database client. Null in degraded mode. */
  readonly db: FabricDb | null;
  /** Per-connector runtime invokers bound by the composition root. */
  readonly invokers?: ConnectorInvokerMap;
  /** Catalog override for tests. Defaults to CONNECTOR_CATALOG. */
  readonly catalog?: ReadonlyArray<ConnectorDescriptor>;
}

export interface ConnectorFabric {
  list(tenantId: string): Promise<ReadonlyArray<ConnectorListEntry>>;
  status(
    tenantId: string,
    connectorId: string,
  ): Promise<ConnectorConnectionStatus | null>;
  invoke(request: ConnectorInvokeRequest): Promise<ConnectorInvokeOutcome>;
}

export function createConnectorFabric(
  deps: ConnectorFabricDeps,
): ConnectorFabric {
  const catalog = deps.catalog ?? CONNECTOR_CATALOG;
  const invokers = deps.invokers ?? {};

  const findDescriptor = (connectorId: string): ConnectorDescriptor | null =>
    deps.catalog
      ? (catalog.find((c) => c.id === connectorId) ?? null)
      : getConnectorDescriptor(connectorId);

  /**
   * Fetch every credential row for the tenant in ONE query. Returns null
   * when the store is unreachable (degraded environments, missing table)
   * so callers can degrade honestly instead of crashing.
   */
  async function fetchCredentialRows(
    tenantId: string,
  ): Promise<ReadonlyArray<Record<string, unknown>> | null> {
    if (!deps.db) return null;
    try {
      const result = await deps.db.execute(sql`
        SELECT connector_kind, connector_account, scopes, expires_at
        FROM connector_credentials
        WHERE tenant_id = ${tenantId}
      `);
      return rowsOf(result);
    } catch {
      // Table missing / connection refused — status unknown, not fatal.
      return null;
    }
  }

  function statusFromRows(
    descriptor: ConnectorDescriptor,
    rows: ReadonlyArray<Record<string, unknown>> | null,
  ): ConnectorConnectionStatus {
    if (rows === null) {
      return Object.freeze({
        connectorId: descriptor.id,
        connected: false,
        storeAvailable: false,
        accounts: Object.freeze([] as ConnectorAccountStatus[]),
        reason: STORE_UNAVAILABLE_REASON,
      });
    }
    const kinds = descriptor.credentialKinds as ReadonlyArray<string>;
    const accounts = rows
      .filter((row) => kinds.includes(String(row.connector_kind ?? '')))
      .map(toAccountStatus);
    if (accounts.length === 0) {
      return Object.freeze({
        connectorId: descriptor.id,
        connected: false,
        storeAvailable: true,
        accounts: Object.freeze([] as ConnectorAccountStatus[]),
        reason: notConnectedReason(descriptor),
      });
    }
    return Object.freeze({
      connectorId: descriptor.id,
      connected: true,
      storeAvailable: true,
      accounts: Object.freeze(accounts),
    });
  }

  async function list(
    tenantId: string,
  ): Promise<ReadonlyArray<ConnectorListEntry>> {
    const rows = await fetchCredentialRows(tenantId);
    return Object.freeze(
      catalog.map((descriptor) => {
        const status = statusFromRows(descriptor, rows);
        return Object.freeze({
          id: descriptor.id,
          displayName: descriptor.displayName,
          category: descriptor.category,
          description: descriptor.description,
          packageName: descriptor.packageName,
          actions: descriptor.actions,
          connected: status.connected,
          accountCount: status.accounts.length,
          ...(status.reason !== undefined && { reason: status.reason }),
        });
      }),
    );
  }

  async function status(
    tenantId: string,
    connectorId: string,
  ): Promise<ConnectorConnectionStatus | null> {
    const descriptor = findDescriptor(connectorId);
    if (!descriptor) return null;
    const rows = await fetchCredentialRows(tenantId);
    return statusFromRows(descriptor, rows);
  }

  async function invoke(
    request: ConnectorInvokeRequest,
  ): Promise<ConnectorInvokeOutcome> {
    const descriptor = findDescriptor(request.connectorId);
    if (!descriptor) {
      return Object.freeze({
        kind: 'unknown_connector' as const,
        connectorId: request.connectorId,
      });
    }

    const action = descriptor.actions.find((a) => a.id === request.action);
    if (!action) {
      return Object.freeze({
        kind: 'unknown_action' as const,
        connectorId: descriptor.id,
        action: request.action,
        availableActions: Object.freeze(descriptor.actions.map((a) => a.id)),
      });
    }

    const connection = statusFromRows(
      descriptor,
      await fetchCredentialRows(request.tenantId),
    );
    if (!connection.connected) {
      return Object.freeze({
        kind: 'not_connected' as const,
        connectorId: descriptor.id,
        connected: false as const,
        reason: connection.reason ?? notConnectedReason(descriptor),
      });
    }

    const invoker = invokers[descriptor.id];
    if (!invoker) {
      return Object.freeze({
        kind: 'not_provisioned' as const,
        connectorId: descriptor.id,
        connected: connection.connected,
        reason: notProvisionedReason(descriptor),
      });
    }

    try {
      const data = await invoker(
        Object.freeze({
          tenantId: request.tenantId,
          actorId: request.actorId,
          connectorId: descriptor.id,
          action: action.id,
          input: Object.freeze({ ...request.input }),
        }),
      );
      return Object.freeze({
        kind: 'ok' as const,
        connectorId: descriptor.id,
        action: action.id,
        data,
      });
    } catch (err) {
      return Object.freeze({
        kind: 'invoker_error' as const,
        connectorId: descriptor.id,
        reason: err instanceof Error ? err.message : 'connector invocation failed',
      });
    }
  }

  return Object.freeze({ list, status, invoke });
}
