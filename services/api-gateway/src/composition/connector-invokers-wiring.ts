/**
 * connector-invokers-wiring — binds the REAL runtime invokers behind the
 * universal connector fabric (`connector-fabric.ts` + `connector-catalog.ts`).
 *
 * THE SEAM THIS CLOSES
 * --------------------
 * The fabric ships complete + governed: it lists every connector, reads each
 * tenant's connection state from `connector_credentials`, and dispatches a
 * declared action through `services.connectorInvokers[connectorId]`. But that
 * map was NEVER bound by the composition root, so EVERY invoke honest-degraded
 * to `not_provisioned`. This module builds the map — the LAST dark seam on the
 * outward-reach super-power — mirroring the NIDA/EARDHI precedent in
 * `hq-tool-port-bindings.ts` exactly:
 *
 *   1. Construct the bytea-AES-GCM credential cipher from env (`open`-only —
 *      it decrypts `connector_credentials.access_token_enc` at CALL TIME, never
 *      at rest, never logged). No key → cipher null → ZERO invokers bound →
 *      the fabric keeps its honest `not_provisioned` envelope.
 *   2. For each catalog connector whose provider OAuth-app env is provisioned
 *      AND that ships a REAL outbound action adapter (CONNECTOR_ACTION_ADAPTERS),
 *      bind an invoker that:
 *        - loads ONLY the calling tenant's `connector_credentials` row
 *          (tenant-isolated query on top of the FORCE-RLS policy);
 *        - decrypts the access token via the cipher;
 *        - zod-validates the action input;
 *        - calls the real package/provider action with the token;
 *        - returns the result, or throws `ConnectorNotConnectedError` /
 *          `ConnectorActionError` which the fabric maps to its honest
 *          `not_connected` / `invoker_error` envelopes.
 *
 * GENERATIVE BY CONSTRUCTION
 * --------------------------
 * The invoker dispatch is fully generic: it is driven by the catalog + the
 * `CONNECTOR_ACTION_ADAPTERS` registry + per-connector env gates. A 22nd
 * connector that ships a real action adapter + its provider env is picked up
 * with ZERO new wiring code here — add its adapter entry (and catalog row).
 * A connector with NO real adapter is simply never bound (honest, never faked).
 *
 * RAILS
 * -----
 *   - No secrets in code — the cipher key + provider creds come from env only.
 *   - Credentials decrypted ONLY at call time; the plaintext token is NEVER
 *     logged and never leaves the invoker closure.
 *   - Tenant isolation absolute — `loadCredential` binds the CALLING tenantId;
 *     no cross-tenant path exists.
 *   - Honest degrade everywhere — missing key / missing provider env / missing
 *     credential / missing adapter all resolve to a structured refusal, never a
 *     fabricated success, never a crash.
 *   - Governance unchanged — the HIGH-stakes `integration.connector.invoke`
 *     brain tool still gates every write upstream of the fabric route.
 */

import { sql } from 'drizzle-orm';

import {
  createConnectorTokenCipher,
  type ConnectorTokenCipher,
} from './connector-token-cipher.js';
import {
  CONNECTOR_ACTION_ADAPTERS,
  ConnectorActionError,
  ConnectorNotConnectedError,
  type ConnectorActionAdapter,
} from './connector-action-adapters.js';
import {
  CONNECTOR_CATALOG,
  type ConnectorDescriptor,
} from './connector-catalog.js';
import type {
  ConnectorInvokeRequest,
  ConnectorInvoker,
  ConnectorInvokerMap,
} from './connector-fabric.js';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';

// ─────────────────────────────────────────────────────────────────────
// Ports
// ─────────────────────────────────────────────────────────────────────

/** Narrow structural db seam (`execute(sql)`) — test-double-able. */
export interface InvokerDb {
  execute(query: unknown): Promise<unknown>;
}

/** A decrypted credential the invoker passes to a provider action. */
export interface DecryptedCredential {
  /** Plaintext access token — NEVER logged; lives only in the call closure. */
  readonly accessToken: string;
  /** Provider-side account id (Slack workspace id, email address, …). */
  readonly account: string;
  /** OAuth scopes granted on this credential row. */
  readonly scopes: ReadonlyArray<string>;
  /** The `connector_kind` the row matched. */
  readonly kind: string;
}

export interface ConnectorInvokersDeps {
  /**
   * Request-independent platform db handle (`execute(sql)`). Null → no
   * credential store → ZERO invokers bound (the fabric keeps degrading).
   */
  readonly db: InvokerDb | null;
  /** Env source (bootstrap-injected). Defaults to process.env. */
  readonly env?: NodeJS.ProcessEnv;
  /** Structured logger. Defaults to the pino-shim. */
  readonly logger?: PinoLikeLogger;
  /** Catalog override for tests. Defaults to CONNECTOR_CATALOG. */
  readonly catalog?: ReadonlyArray<ConnectorDescriptor>;
  /** Action-adapter override for tests. Defaults to CONNECTOR_ACTION_ADAPTERS. */
  readonly adapters?: Readonly<
    Record<string, Readonly<Record<string, ConnectorActionAdapter>>>
  >;
  /** Cipher override for tests (bypass env-key construction). */
  readonly cipher?: ConnectorTokenCipher;
  /** Outbound fetch port override for tests (defaults to globalThis.fetch). */
  readonly fetchImpl?: typeof fetch;
}

export interface ConnectorInvokersWiring {
  /** The map the composition root binds onto `services.connectorInvokers`. */
  readonly connectorInvokers: ConnectorInvokerMap;
  /** Diagnostic — connector ids that got a live invoker. */
  readonly boundConnectorIds: ReadonlyArray<string>;
  /** Diagnostic — true when the credential cipher was constructed. */
  readonly cipherBound: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Provider env gates — a connector binds ONLY when its OAuth-app env is set
// (mirrors hq-tool-port-bindings: NIDA binds only with NIDA_* env). The
// gate proves the PROVIDER side is provisioned; the per-tenant credential
// is the SECOND, genuine runtime gate (you cannot call Slack without a
// Slack token — that is correct, not a gap).
// ─────────────────────────────────────────────────────────────────────

/**
 * Per-connector provisioning predicate. A connector absent from this map is
 * never bound (no real adapter / not provisioning-modelled yet). Each predicate
 * reads ONLY env (no secrets in code).
 */
const PROVIDER_ENV_GATES: Readonly<
  Record<string, (env: NodeJS.ProcessEnv) => boolean>
> = Object.freeze({
  // Slack outbound (chat.postMessage / auth.test / conversations.history) needs
  // the workspace OAuth app to be configured platform-side. The per-tenant bot
  // token (from connector_credentials) is the genuine runtime credential.
  slack: (env) =>
    Boolean(env.SLACK_CLIENT_ID?.trim() && env.SLACK_CLIENT_SECRET?.trim()),
});

// ─────────────────────────────────────────────────────────────────────
// Credential load — tenant-isolated, decrypted at call time
// ─────────────────────────────────────────────────────────────────────

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = result as { rows?: ReadonlyArray<Record<string, unknown>> };
  return wrapped?.rows ?? [];
}

function toUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  // node-postgres delivers bytea as a Buffer; some drivers wrap it.
  if (
    value &&
    typeof value === 'object' &&
    'type' in (value as Record<string, unknown>) &&
    (value as { type?: unknown }).type === 'Buffer' &&
    Array.isArray((value as { data?: unknown }).data)
  ) {
    return new Uint8Array((value as { data: number[] }).data);
  }
  return null;
}

/**
 * Load + decrypt the CALLING tenant's credential for one connector. Picks the
 * most-recently-updated matching row. Throws `ConnectorNotConnectedError` when
 * no usable credential exists (the fabric maps it to `not_connected`).
 *
 * Tenant isolation: the query binds `request.tenantId` explicitly on top of the
 * FORCE-RLS policy — an invoker can ONLY ever read its own tenant's row.
 */
async function loadCredential(args: {
  readonly db: InvokerDb;
  readonly cipher: ConnectorTokenCipher;
  readonly descriptor: ConnectorDescriptor;
  readonly tenantId: string;
}): Promise<DecryptedCredential> {
  const { db, cipher, descriptor, tenantId } = args;
  const kinds = descriptor.credentialKinds as ReadonlyArray<string>;

  let rows: ReadonlyArray<Record<string, unknown>>;
  try {
    const result = await db.execute(sql`
      SELECT connector_kind, connector_account, access_token_enc, scopes, expires_at
      FROM connector_credentials
      WHERE tenant_id = ${tenantId}
        AND connector_kind = ANY(${sql`ARRAY[${sql.join(
          kinds.map((k) => sql`${k}`),
          sql`, `,
        )}]::text[]`})
      ORDER BY updated_at DESC
      LIMIT 1
    `);
    rows = rowsOf(result);
  } catch (err) {
    // Store unreachable — surface as not-connected so the fabric degrades
    // honestly rather than crashing. (Message only; no secret material.)
    throw new ConnectorNotConnectedError(
      descriptor.id,
      'credential store unreachable',
    );
  }

  const row = rows[0];
  if (!row) {
    throw new ConnectorNotConnectedError(
      descriptor.id,
      'no credential on record for this tenant',
    );
  }

  const enc = toUint8Array(row.access_token_enc);
  if (!enc || enc.length === 0) {
    throw new ConnectorNotConnectedError(
      descriptor.id,
      'stored credential has no access token',
    );
  }

  const expiresAt = row.expires_at;
  if (expiresAt instanceof Date && expiresAt.getTime() <= Date.now()) {
    throw new ConnectorNotConnectedError(
      descriptor.id,
      'stored credential has expired — reconnect required',
    );
  }

  let accessToken: string;
  try {
    accessToken = await cipher.open(enc);
  } catch {
    // Tamper / wrong key — never echo plaintext or key bytes.
    throw new ConnectorNotConnectedError(
      descriptor.id,
      'stored credential could not be decrypted',
    );
  }

  const scopesRaw = row.scopes;
  const scopes = Array.isArray(scopesRaw)
    ? Object.freeze(scopesRaw.filter((s): s is string => typeof s === 'string'))
    : Object.freeze([] as string[]);

  return Object.freeze({
    accessToken,
    account:
      typeof row.connector_account === 'string' ? row.connector_account : '',
    scopes,
    kind: typeof row.connector_kind === 'string' ? row.connector_kind : '',
  });
}

// ─────────────────────────────────────────────────────────────────────
// Invoker construction
// ─────────────────────────────────────────────────────────────────────

/**
 * Build one connector's invoker over its real action adapters. The returned
 * function: resolves the action adapter (unknown action → ConnectorActionError),
 * loads + decrypts the tenant credential, then delegates to the adapter with
 * the plaintext token. The token never escapes this closure.
 */
function buildInvoker(args: {
  readonly db: InvokerDb;
  readonly cipher: ConnectorTokenCipher;
  readonly descriptor: ConnectorDescriptor;
  readonly actions: Readonly<Record<string, ConnectorActionAdapter>>;
  readonly fetchImpl: typeof fetch;
}): ConnectorInvoker {
  const { db, cipher, descriptor, actions, fetchImpl } = args;
  return async (request: ConnectorInvokeRequest): Promise<unknown> => {
    const adapter = actions[request.action];
    if (!adapter) {
      // The fabric already guards unknown CATALOG actions; this guards an
      // action declared in the catalog but with no real adapter bound here.
      throw new ConnectorActionError(
        descriptor.id,
        `action '${request.action}' has no runtime adapter for ${descriptor.displayName}`,
      );
    }
    const credential = await loadCredential({
      db,
      cipher,
      descriptor,
      tenantId: request.tenantId,
    });
    return adapter({
      credential,
      input: request.input,
      fetchImpl,
      tenantId: request.tenantId,
      actorId: request.actorId,
    });
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public composition
// ─────────────────────────────────────────────────────────────────────

/**
 * Compose the connector invoker map. Synchronous, fail-soft: any connector
 * whose env/adapter/cipher prerequisites are unmet is simply skipped (the
 * fabric keeps its honest `not_provisioned` envelope for it).
 */
export function createConnectorInvokers(
  deps: ConnectorInvokersDeps,
): ConnectorInvokersWiring {
  const logger = deps.logger ?? createPinoLikeLogger('connector-invokers');
  const env = deps.env ?? process.env;
  const catalog = deps.catalog ?? CONNECTOR_CATALOG;
  const adapterRegistry = deps.adapters ?? CONNECTOR_ACTION_ADAPTERS;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

  // 1. Cipher — the decrypt seam. Test override wins; else env-constructed.
  const cipher = deps.cipher ?? createConnectorTokenCipher(env);
  const cipherBound = cipher !== null;

  if (!deps.db || !cipher) {
    logger.info(
      {
        wiring: 'connector-invokers',
        boundConnectorIds: [],
        cipherBound,
        dbBound: Boolean(deps.db),
        reason: !deps.db
          ? 'no credential store (db null)'
          : 'no credential cipher key (CONNECTOR_TOKEN_KEY / ENCRYPTION_MASTER_KEY unset)',
      },
      'connector-invokers: NO invokers bound — fabric keeps honest not_provisioned degradation (no external call possible without a decryptable credential)',
    );
    return Object.freeze({
      connectorInvokers: Object.freeze({}),
      boundConnectorIds: Object.freeze([]),
      cipherBound,
    });
  }

  const db = deps.db;
  const invokers: Record<string, ConnectorInvoker> = {};
  const bound: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const descriptor of catalog) {
    const actions = adapterRegistry[descriptor.id];
    if (!actions || Object.keys(actions).length === 0) {
      // No real outbound adapter ships for this connector — never fake one.
      skipped.push({ id: descriptor.id, reason: 'no runtime action adapter' });
      continue;
    }
    const gate = PROVIDER_ENV_GATES[descriptor.id];
    if (!gate || !gate(env)) {
      skipped.push({
        id: descriptor.id,
        reason: 'provider OAuth-app env not provisioned',
      });
      continue;
    }
    invokers[descriptor.id] = buildInvoker({
      db,
      cipher,
      descriptor,
      actions,
      fetchImpl,
    });
    bound.push(descriptor.id);
  }

  logger.info(
    {
      wiring: 'connector-invokers',
      boundConnectorIds: bound,
      skipped,
      cipherBound,
    },
    'connector-invokers: real credential-gated invokers composed — bound connectors execute live actions; unbound stay honest not_provisioned (governance unchanged: integration.connector.invoke still HIGH-gated upstream)',
  );

  return Object.freeze({
    connectorInvokers: Object.freeze(invokers),
    boundConnectorIds: Object.freeze(bound),
    cipherBound,
  });
}
