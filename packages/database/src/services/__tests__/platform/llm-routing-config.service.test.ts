/**
 * Unit tests — createPlatformLlmRoutingConfigService.
 *
 * Mirrors the feature-flags service contract:
 *   - read()           : parses the JSONB config; empty/missing → null config
 *   - read()           : degrades to null config on DB error (fail-safe → the
 *                        router falls back to the static TASK_LADDER)
 *   - setRouting()     : inserts when none exists (previousConfig=null),
 *                        captures previousConfig on update, stamps the actor
 *   - setRouting()     : RE-THROWS on DB error (sovereign-grade write contract)
 *   - restoreRouting() : deletes when previousConfig=null; updates otherwise;
 *                        RE-THROWS on DB error
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createPlatformLlmRoutingConfigService,
  type RoutingConfigDocument,
} from '../../platform/llm-routing-config.service.js';
import { makeStubDb } from './_stub-db.js';

const deps = { resolveActor: () => 'admin-7' };

const sampleConfig: RoutingConfigDocument = {
  coreModel: 'anthropic/claude-opus-4-8',
  orderedFallbacks: ['anthropic/claude-sonnet-4-6'],
  ensemble: {
    enabled: true,
    members: ['anthropic/claude-opus-4-8', 'openai/gpt-5'],
    combineStrategy: 'judge-synthesis',
    judgeModel: 'anthropic/claude-opus-4-8',
  },
  perUseCase: { casual_chat: 'anthropic/claude-haiku-4-5' },
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('platform.llmRoutingConfig — read', () => {
  it('returns the parsed config + lastSetAt for a scope', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([
      { config: sampleConfig, lastSetAt: new Date('2026-06-01T00:00:00Z') },
    ]);
    const svc = createPlatformLlmRoutingConfigService(stub.client, deps);
    const out = await svc.read('global');
    expect(out.scope).toBe('global');
    expect(out.config?.coreModel).toBe('anthropic/claude-opus-4-8');
    expect(out.config?.ensemble?.combineStrategy).toBe('judge-synthesis');
    expect(out.lastSetAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('returns null config when no row exists', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([]);
    const svc = createPlatformLlmRoutingConfigService(stub.client, deps);
    const out = await svc.read('tenant:acme');
    expect(out.config).toBeNull();
    expect(out.lastSetAt).toBeNull();
  });

  it('degrades to null config on a DB error (fail-safe)', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('db down'));
    const svc = createPlatformLlmRoutingConfigService(stub.client, deps);
    const out = await svc.read('global');
    expect(out.config).toBeNull();
  });

  it('treats a corrupt (non-object) config as null', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([{ config: 'not-an-object', lastSetAt: new Date() }]);
    const svc = createPlatformLlmRoutingConfigService(stub.client, deps);
    const out = await svc.read('global');
    expect(out.config).toBeNull();
  });
});

describe('platform.llmRoutingConfig — setRouting', () => {
  it('inserts a new row with previousConfig=null + stamps the actor', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([]); // existing read returns empty
    const svc = createPlatformLlmRoutingConfigService(stub.client, deps);
    const out = await svc.setRouting({ scope: 'global', config: sampleConfig });
    expect(out.previousConfig).toBeNull();
    expect(out.config.coreModel).toBe('anthropic/claude-opus-4-8');
    const insert = stub.ops.find((o) => o.op === 'insert');
    expect(insert?.values?.scope).toBe('global');
    expect(insert?.values?.createdBy).toBe('admin-7');
    expect(insert?.values?.lastSetBy).toBe('admin-7');
  });

  it('updates an existing row + captures the previousConfig', async () => {
    const stub = makeStubDb();
    const prev: RoutingConfigDocument = { coreModel: 'old/core', orderedFallbacks: [] };
    stub.setSelectRows([{ config: prev }]);
    const svc = createPlatformLlmRoutingConfigService(stub.client, deps);
    const out = await svc.setRouting({
      scope: 'tenant:acme',
      config: sampleConfig,
    });
    expect(out.previousConfig?.coreModel).toBe('old/core');
    const update = stub.ops.find((o) => o.op === 'update');
    expect(update?.set?.lastSetBy).toBe('admin-7');
  });

  it('RE-THROWS on a DB write error (sovereign-grade contract)', async () => {
    const stub = makeStubDb();
    stub.setSelectRows([]);
    stub.setNextThrow(new Error('write fail'));
    const svc = createPlatformLlmRoutingConfigService(stub.client, deps);
    await expect(
      svc.setRouting({ scope: 'global', config: sampleConfig }),
    ).rejects.toThrow();
  });

  it('rejects an empty scope', async () => {
    const stub = makeStubDb();
    const svc = createPlatformLlmRoutingConfigService(stub.client, deps);
    await expect(
      svc.setRouting({ scope: '' as never, config: sampleConfig }),
    ).rejects.toThrow();
  });
});

describe('platform.llmRoutingConfig — restoreRouting', () => {
  it('deletes the row when previousConfig is null', async () => {
    const stub = makeStubDb();
    const svc = createPlatformLlmRoutingConfigService(stub.client, deps);
    await svc.restoreRouting({ scope: 'global', previousConfig: null });
    expect(stub.ops.some((o) => o.op === 'delete')).toBe(true);
  });

  it('updates the row when previousConfig is supplied', async () => {
    const stub = makeStubDb();
    const svc = createPlatformLlmRoutingConfigService(stub.client, deps);
    await svc.restoreRouting({ scope: 'global', previousConfig: sampleConfig });
    const update = stub.ops.find((o) => o.op === 'update');
    expect(update?.set?.lastSetBy).toBe('admin-7');
  });

  it('RE-THROWS on a DB error', async () => {
    const stub = makeStubDb();
    stub.setNextThrow(new Error('restore fail'));
    const svc = createPlatformLlmRoutingConfigService(stub.client, deps);
    await expect(
      svc.restoreRouting({ scope: 'global', previousConfig: sampleConfig }),
    ).rejects.toThrow();
  });
});
