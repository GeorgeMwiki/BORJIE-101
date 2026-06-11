/**
 * connector-invokers-wiring.test.ts — locks the connector-invoker un-darking:
 *
 *   1. honest degrade: no db OR no cipher key → ZERO invokers bound (the fabric
 *      keeps its not_provisioned envelope; the boot log says why);
 *   2. provider env gate: a connector with a real adapter but no provider env
 *      stays unbound;
 *   3. live dispatch: with a stubbed decrypted credential + a fake adapter, the
 *      bound invoker loads the CALLING tenant's row, decrypts, and dispatches to
 *      the adapter — and the connector fabric maps an `ok` outcome end-to-end;
 *   4. missing credential → typed ConnectorNotConnectedError → the fabric maps a
 *      not_connected (route envelope intact), never a crash;
 *   5. tenant isolation: the credential query binds the calling tenantId;
 *   6. the cipher round-trips (seal → open) and fails closed on tamper.
 */

import { describe, expect, it } from 'vitest';

import {
  createConnectorInvokers,
  type InvokerDb,
} from '../connector-invokers-wiring.js';
import {
  ConnectorNotConnectedError,
  type ConnectorActionAdapter,
} from '../connector-action-adapters.js';
import {
  createConnectorTokenCipherFromKey,
  createConnectorTokenCipher,
  ConnectorTokenDecryptError,
  type ConnectorTokenCipher,
} from '../connector-token-cipher.js';
import {
  createConnectorFabric,
  type FabricDb,
} from '../connector-fabric.js';
import type { ConnectorDescriptor } from '../connector-catalog.js';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function silentLogger(): PinoLikeLogger {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

const SLACK_DESCRIPTOR: ConnectorDescriptor = Object.freeze({
  id: 'slack',
  displayName: 'Slack',
  category: 'communication',
  description: 'test',
  packageName: '@borjie/connector-slack',
  credentialKinds: Object.freeze(['slack']),
  actions: Object.freeze([
    { id: 'sync.pull', description: 'pull', isWrite: false },
    { id: 'connection.test', description: 'test', isWrite: false },
    { id: 'message.post', description: 'post', isWrite: true },
  ]),
});

const TEST_CATALOG: ReadonlyArray<ConnectorDescriptor> = Object.freeze([
  SLACK_DESCRIPTOR,
]);

/** A stub cipher whose `open` returns a deterministic plaintext. */
function stubCipher(plaintext = 'xoxb-stub-token'): ConnectorTokenCipher {
  return {
    seal: async () => new Uint8Array([1, 2, 3]),
    open: async () => plaintext,
  };
}

/**
 * Fake db that returns a single credential row for the tenant. Records the
 * executed query so we can assert the tenant binding.
 */
function fakeDbWithCredential(): {
  db: InvokerDb;
  calls: Array<{ chunksJson: string }>;
} {
  const calls: Array<{ chunksJson: string }> = [];
  const db: InvokerDb = {
    execute: async (query: unknown) => {
      // Drizzle SQL objects carry their template values in `queryChunks`
      // (Param nodes). Serialise so the test can assert the tenant binding.
      const q = query as { queryChunks?: unknown };
      calls.push({ chunksJson: JSON.stringify(q.queryChunks ?? []) });
      return {
        rows: [
          {
            connector_kind: 'slack',
            connector_account: 'T-WORKSPACE',
            access_token_enc: new Uint8Array([9, 9, 9]),
            scopes: ['chat:write'],
            expires_at: null,
          },
        ],
      };
    },
  };
  return { db, calls };
}

/** Fake db with NO matching credential row. */
function fakeDbEmpty(): InvokerDb {
  return { execute: async () => ({ rows: [] }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createConnectorInvokers — honest degrade', () => {
  it('binds ZERO invokers when db is null', () => {
    const wiring = createConnectorInvokers({
      db: null,
      cipher: stubCipher(),
      env: { SLACK_CLIENT_ID: 'x', SLACK_CLIENT_SECRET: 'y' },
      catalog: TEST_CATALOG,
      logger: silentLogger(),
    });
    expect(wiring.boundConnectorIds).toEqual([]);
    expect(Object.keys(wiring.connectorInvokers)).toEqual([]);
  });

  it('binds ZERO invokers when no cipher key is configured', () => {
    const { db } = fakeDbWithCredential();
    const wiring = createConnectorInvokers({
      db,
      // No cipher override + an env with no CONNECTOR_TOKEN_KEY/ENCRYPTION_MASTER_KEY
      env: { SLACK_CLIENT_ID: 'x', SLACK_CLIENT_SECRET: 'y' },
      catalog: TEST_CATALOG,
      logger: silentLogger(),
    });
    expect(wiring.cipherBound).toBe(false);
    expect(wiring.boundConnectorIds).toEqual([]);
  });

  it('leaves a connector unbound when its provider env gate is unmet', () => {
    const { db } = fakeDbWithCredential();
    const wiring = createConnectorInvokers({
      db,
      cipher: stubCipher(),
      env: {}, // no SLACK_CLIENT_ID / SECRET
      catalog: TEST_CATALOG,
      logger: silentLogger(),
    });
    expect(wiring.boundConnectorIds).toEqual([]);
  });

  it('leaves a connector unbound when no real action adapter ships', () => {
    const { db } = fakeDbWithCredential();
    const wiring = createConnectorInvokers({
      db,
      cipher: stubCipher(),
      env: { SLACK_CLIENT_ID: 'x', SLACK_CLIENT_SECRET: 'y' },
      catalog: TEST_CATALOG,
      adapters: {}, // no adapters registered
      logger: silentLogger(),
    });
    expect(wiring.boundConnectorIds).toEqual([]);
  });
});

describe('createConnectorInvokers — live dispatch', () => {
  it('dispatches to a fake adapter with the stubbed decrypted credential', async () => {
    const { db, calls } = fakeDbWithCredential();
    const seen: Array<{ token: string; input: unknown; tenantId: string }> = [];
    const fakeAdapter: ConnectorActionAdapter = async (ctx) => {
      seen.push({
        token: ctx.credential.accessToken,
        input: ctx.input,
        tenantId: ctx.tenantId,
      });
      return { ok: true, echoed: ctx.input };
    };

    const wiring = createConnectorInvokers({
      db,
      cipher: stubCipher('xoxb-LIVE'),
      env: { SLACK_CLIENT_ID: 'x', SLACK_CLIENT_SECRET: 'y' },
      catalog: TEST_CATALOG,
      adapters: { slack: { 'message.post': fakeAdapter } },
      logger: silentLogger(),
    });

    expect(wiring.boundConnectorIds).toEqual(['slack']);

    const invoker = wiring.connectorInvokers['slack'];
    expect(invoker).toBeDefined();
    const result = await invoker!({
      tenantId: 'tnt-1',
      actorId: 'usr-1',
      connectorId: 'slack',
      action: 'message.post',
      input: { channel: 'C1', text: 'hi' },
    });

    expect(result).toEqual({ ok: true, echoed: { channel: 'C1', text: 'hi' } });
    // The adapter received the DECRYPTED token (never the ciphertext).
    expect(seen[0]?.token).toBe('xoxb-LIVE');
    expect(seen[0]?.tenantId).toBe('tnt-1');
    // Tenant isolation: the executed credential query bound the calling tenant.
    expect(calls.some((c) => c.chunksJson.includes('tnt-1'))).toBe(true);
  });

  it('drives the full connector fabric to an `ok` outcome via the bound invoker', async () => {
    const { db } = fakeDbWithCredential();
    const wiring = createConnectorInvokers({
      db,
      cipher: stubCipher(),
      env: { SLACK_CLIENT_ID: 'x', SLACK_CLIENT_SECRET: 'y' },
      catalog: TEST_CATALOG,
      adapters: {
        slack: { 'message.post': async () => ({ posted: true }) },
      },
      logger: silentLogger(),
    });

    const fabric = createConnectorFabric({
      db: db as unknown as FabricDb,
      invokers: wiring.connectorInvokers,
      catalog: TEST_CATALOG,
    });

    const outcome = await fabric.invoke({
      tenantId: 'tnt-1',
      actorId: 'usr-1',
      connectorId: 'slack',
      action: 'message.post',
      input: { channel: 'C1', text: 'hi' },
    });

    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.data).toEqual({ posted: true });
    }
  });
});

describe('createConnectorInvokers — missing credential is honest', () => {
  it('throws ConnectorNotConnectedError when the tenant has no credential row', async () => {
    const wiring = createConnectorInvokers({
      db: fakeDbEmpty(),
      cipher: stubCipher(),
      env: { SLACK_CLIENT_ID: 'x', SLACK_CLIENT_SECRET: 'y' },
      catalog: TEST_CATALOG,
      adapters: { slack: { 'message.post': async () => ({ posted: true }) } },
      logger: silentLogger(),
    });
    const invoker = wiring.connectorInvokers['slack']!;
    await expect(
      invoker({
        tenantId: 'tnt-1',
        actorId: 'usr-1',
        connectorId: 'slack',
        action: 'message.post',
        input: {},
      }),
    ).rejects.toBeInstanceOf(ConnectorNotConnectedError);
  });

  it('the fabric maps an invoker throw to invoker_error (envelope intact, no crash)', async () => {
    // The fabric checks `connected` first; with the empty db it returns
    // not_connected BEFORE calling the invoker — the route's honest envelope.
    const emptyDb = fakeDbEmpty();
    const wiring = createConnectorInvokers({
      db: emptyDb,
      cipher: stubCipher(),
      env: { SLACK_CLIENT_ID: 'x', SLACK_CLIENT_SECRET: 'y' },
      catalog: TEST_CATALOG,
      adapters: { slack: { 'message.post': async () => ({ posted: true }) } },
      logger: silentLogger(),
    });
    const fabric = createConnectorFabric({
      db: emptyDb as unknown as FabricDb,
      invokers: wiring.connectorInvokers,
      catalog: TEST_CATALOG,
    });
    const outcome = await fabric.invoke({
      tenantId: 'tnt-1',
      actorId: 'usr-1',
      connectorId: 'slack',
      action: 'message.post',
      input: {},
    });
    expect(outcome.kind).toBe('not_connected');
  });
});

describe('ConnectorTokenCipher', () => {
  it('round-trips seal → open', async () => {
    const cipher = createConnectorTokenCipherFromKey('a'.repeat(64)); // hex 32B
    const sealed = await cipher.seal('xoxb-secret');
    expect(sealed).toBeInstanceOf(Uint8Array);
    expect(await cipher.open(sealed)).toBe('xoxb-secret');
  });

  it('fails closed on tamper', async () => {
    const cipher = createConnectorTokenCipherFromKey('passphrase-derived-key');
    const sealed = await cipher.seal('xoxb-secret');
    const tampered = new Uint8Array(sealed);
    tampered[tampered.length - 1] ^= 0xff;
    await expect(cipher.open(tampered)).rejects.toBeInstanceOf(
      ConnectorTokenDecryptError,
    );
  });

  it('returns null from env when no key is configured', () => {
    expect(createConnectorTokenCipher({})).toBeNull();
  });

  it('constructs from CONNECTOR_TOKEN_KEY env', () => {
    const cipher = createConnectorTokenCipher({
      CONNECTOR_TOKEN_KEY: 'b'.repeat(64),
    });
    expect(cipher).not.toBeNull();
  });
});
