/**
 * Connector fabric + catalog registry-shape tests.
 *
 * The catalog is the ONE generative seam over the 21 connector packages:
 * these tests pin the shape invariants every entry (and every FUTURE
 * 22nd entry) must satisfy, plus the fabric's honest-degradation
 * dispatch semantics.
 */

import { describe, expect, it } from 'vitest';

import {
  CONNECTOR_CATALOG,
  getConnectorDescriptor,
} from '../connector-catalog.js';
import {
  createConnectorFabric,
  type FabricDb,
} from '../connector-fabric.js';

const KEBAB = /^[a-z0-9][a-z0-9-]*$/;

describe('CONNECTOR_CATALOG registry shape', () => {
  it('enumerates all 21 dormant connector packages', () => {
    expect(CONNECTOR_CATALOG).toHaveLength(21);
  });

  it('has globally-unique kebab-case ids', () => {
    const ids = CONNECTOR_CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(KEBAB);
    }
  });

  it('every entry references its workspace package + credential kinds', () => {
    for (const entry of CONNECTOR_CATALOG) {
      expect(entry.packageName).toBe(`@borjie/connector-${entry.id}`);
      expect(entry.credentialKinds.length).toBeGreaterThan(0);
      expect(entry.displayName.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it('every entry declares well-formed, per-connector-unique actions', () => {
    for (const entry of CONNECTOR_CATALOG) {
      expect(entry.actions.length).toBeGreaterThan(0);
      const actionIds = entry.actions.map((a) => a.id);
      expect(new Set(actionIds).size).toBe(actionIds.length);
      for (const action of entry.actions) {
        expect(action.id.length).toBeGreaterThan(0);
        expect(action.description.length).toBeGreaterThan(0);
        expect(typeof action.isWrite).toBe('boolean');
      }
      // Every connector ships the universal read pair.
      expect(actionIds).toContain('sync.pull');
      expect(actionIds).toContain('connection.test');
    }
  });

  it('batch-1 connectors keep their provider-level credential kinds', () => {
    expect(getConnectorDescriptor('calendar')?.credentialKinds).toEqual([
      'google_calendar',
      'outlook_calendar',
    ]);
    expect(getConnectorDescriptor('email')?.credentialKinds).toEqual([
      'gmail',
      'outlook_mail',
    ]);
    expect(getConnectorDescriptor('slack')?.credentialKinds).toEqual(['slack']);
  });

  it('is deeply frozen (immutability)', () => {
    expect(Object.isFrozen(CONNECTOR_CATALOG)).toBe(true);
    for (const entry of CONNECTOR_CATALOG) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.actions)).toBe(true);
      expect(Object.isFrozen(entry.credentialKinds)).toBe(true);
    }
  });

  it('getConnectorDescriptor returns null for unknown ids', () => {
    expect(getConnectorDescriptor('not-a-connector')).toBeNull();
  });
});

function dbReturning(rows: Array<Record<string, unknown>>): FabricDb {
  return {
    async execute() {
      return { rows };
    },
  };
}

const SLACK_ROW = {
  connector_kind: 'slack',
  connector_account: 'T-WS1',
  scopes: ['chat:write'],
  expires_at: null,
};

describe('createConnectorFabric dispatch semantics', () => {
  it('reports connected only for matching credential kinds', async () => {
    const fabric = createConnectorFabric({ db: dbReturning([SLACK_ROW]) });
    const entries = await fabric.list('t-1');
    const byId = new Map(entries.map((e) => [e.id, e]));
    expect(byId.get('slack')?.connected).toBe(true);
    expect(byId.get('github')?.connected).toBe(false);
  });

  it('degrades honestly when db is null (no crash, explicit reason)', async () => {
    const fabric = createConnectorFabric({ db: null });
    const status = await fabric.status('t-1', 'slack');
    expect(status?.connected).toBe(false);
    expect(status?.storeAvailable).toBe(false);
    expect(status?.reason).toMatch(/store unreachable/i);
  });

  it('invoke → unknown_connector for ids outside the catalog', async () => {
    const fabric = createConnectorFabric({ db: dbReturning([]) });
    const outcome = await fabric.invoke({
      tenantId: 't-1',
      actorId: 'u-1',
      connectorId: 'nope',
      action: 'sync.pull',
      input: {},
    });
    expect(outcome.kind).toBe('unknown_connector');
  });

  it('invoke → unknown_action lists the available actions', async () => {
    const fabric = createConnectorFabric({ db: dbReturning([SLACK_ROW]) });
    const outcome = await fabric.invoke({
      tenantId: 't-1',
      actorId: 'u-1',
      connectorId: 'slack',
      action: 'nuke.workspace',
      input: {},
    });
    expect(outcome.kind).toBe('unknown_action');
    if (outcome.kind === 'unknown_action') {
      expect(outcome.availableActions).toContain('message.post');
    }
  });

  it('invoke → not_connected before any invoker is consulted', async () => {
    let invokerCalled = false;
    const fabric = createConnectorFabric({
      db: dbReturning([]),
      invokers: {
        slack: async () => {
          invokerCalled = true;
          return {};
        },
      },
    });
    const outcome = await fabric.invoke({
      tenantId: 't-1',
      actorId: 'u-1',
      connectorId: 'slack',
      action: 'sync.pull',
      input: {},
    });
    expect(outcome.kind).toBe('not_connected');
    expect(invokerCalled).toBe(false);
  });

  it('invoke → not_provisioned when connected but no invoker bound', async () => {
    const fabric = createConnectorFabric({ db: dbReturning([SLACK_ROW]) });
    const outcome = await fabric.invoke({
      tenantId: 't-1',
      actorId: 'u-1',
      connectorId: 'slack',
      action: 'sync.pull',
      input: {},
    });
    expect(outcome.kind).toBe('not_provisioned');
    if (outcome.kind === 'not_provisioned') {
      expect(outcome.reason).toMatch(/no data was fabricated/i);
    }
  });

  it('invoke → ok routes through the bound invoker generically', async () => {
    const seen: unknown[] = [];
    const fabric = createConnectorFabric({
      db: dbReturning([SLACK_ROW]),
      invokers: {
        slack: async (req) => {
          seen.push(req);
          return { delivered: true };
        },
      },
    });
    const outcome = await fabric.invoke({
      tenantId: 't-1',
      actorId: 'u-1',
      connectorId: 'slack',
      action: 'message.post',
      input: { text: 'habari' },
    });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') {
      expect(outcome.data).toEqual({ delivered: true });
    }
    expect(seen[0]).toMatchObject({
      tenantId: 't-1',
      connectorId: 'slack',
      action: 'message.post',
    });
  });

  it('invoke → invoker_error wraps thrown errors (message only)', async () => {
    const fabric = createConnectorFabric({
      db: dbReturning([SLACK_ROW]),
      invokers: {
        slack: async () => {
          throw new Error('rate limited');
        },
      },
    });
    const outcome = await fabric.invoke({
      tenantId: 't-1',
      actorId: 'u-1',
      connectorId: 'slack',
      action: 'sync.pull',
      input: {},
    });
    expect(outcome.kind).toBe('invoker_error');
    if (outcome.kind === 'invoker_error') {
      expect(outcome.reason).toBe('rate limited');
    }
  });
});
