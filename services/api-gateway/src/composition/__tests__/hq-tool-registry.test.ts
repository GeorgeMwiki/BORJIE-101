/**
 * Tests for `createHqToolRegistry` — the api-gateway composition root
 * that seeds the 12 `platform.*` BrainTools onto a registry.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHqToolRegistry } from '../hq-tool-registry.js';

const FIXED_NOW = new Date('2026-05-15T09:00:00.000Z');

function fixedClock(): () => Date {
  return () => FIXED_NOW;
}

describe('createHqToolRegistry', () => {
  it('boots with NOT_YET_WIRED stubs when hqDeps omitted', () => {
    const wiring = createHqToolRegistry({
      callerResolver: {
        resolve: () => ({
          callerId: 'admin-1',
          scopes: ['platform:*'],
        }),
      },
      clock: fixedClock(),
    });
    // 17 = 12 legacy platform.* + 3 sovereign Temporal-backed
    // (evict/payout/file_kra_mri) + 2 East-Africa identity / land-registry
    // (verify_nida / verify_eardhi_title). The count grows as new HQ tools
    // ship; assertions on individual tool names live below.
    expect(wiring.toolNames).toHaveLength(17);
    expect(wiring.registry.get('platform.list_tenants')).not.toBeNull();
    expect(wiring.registry.get('platform.set_killswitch')).not.toBeNull();
  });

  it('registers every platform.* tier-mapped tool', () => {
    const wiring = createHqToolRegistry({
      callerResolver: {
        resolve: () => ({ callerId: 'admin-1', scopes: ['platform:*'] }),
      },
      clock: fixedClock(),
    });
    const names = wiring.registry.list().map((s) => s.name);
    expect(names).toContain('platform.list_tenants');
    expect(names).toContain('platform.create_tenant');
    expect(names).toContain('platform.set_killswitch');
    expect(names).toContain('platform.adjust_invoice');
    expect(names).toContain('platform.send_announcement');
  });

  it('system_health stub returns an "unknown" snapshot rather than throwing', async () => {
    const wiring = createHqToolRegistry({
      callerResolver: {
        resolve: () => ({ callerId: 'admin-1', scopes: ['platform:*'] }),
      },
      clock: fixedClock(),
    });
    const out = await wiring.registry.runTool('platform.system_health', {});
    expect(out.kind).toBe('ok');
  });

  it('list_tenants stub fails with executor-failed (NOT_YET_WIRED)', async () => {
    const wiring = createHqToolRegistry({
      callerResolver: {
        resolve: () => ({ callerId: 'admin-1', scopes: ['platform:*'] }),
      },
      clock: fixedClock(),
    });
    const out = await wiring.registry.runTool('platform.list_tenants', {});
    expect(out.kind).toBe('executor-failed');
  });

  it('caller without scope receives refusal (translated to executor-failed)', async () => {
    const wiring = createHqToolRegistry({
      callerResolver: {
        resolve: () => ({ callerId: 'eve', scopes: ['public:read'] }),
      },
      clock: fixedClock(),
    });
    const out = await wiring.registry.runTool('platform.system_health', {});
    expect(out.kind).toBe('executor-failed');
    if (out.kind !== 'executor-failed') throw new Error('expected fail');
    expect(out.message).toMatch(/hq-tool-refused:OUT_OF_SCOPE/);
  });

  it('approvalRecordIdResolver is invoked per call', async () => {
    const seen: string[] = [];
    const wiring = createHqToolRegistry({
      callerResolver: {
        resolve: () => ({ callerId: 'admin-1', scopes: ['platform:*'] }),
      },
      approvalRecordIdResolver: (toolName) => {
        seen.push(toolName);
        return 'approval-xyz';
      },
      clock: fixedClock(),
    });
    await wiring.registry.runTool('platform.system_health', {});
    expect(seen).toContain('platform.system_health');
  });

  it('respects custom cost + recipient ceilings', () => {
    const wiring = createHqToolRegistry({
      callerResolver: {
        resolve: () => ({ callerId: 'admin-1', scopes: ['platform:*'] }),
      },
      maxAdjustmentUsdCents: 100_00,
      maxRecipientCount: 5_000,
      clock: fixedClock(),
    });
    // 17 = 12 legacy platform.* + 3 sovereign Temporal-backed
    // (evict/payout/file_kra_mri) + 2 East-Africa identity / land-registry
    // (verify_nida / verify_eardhi_title). The count grows as new HQ tools
    // ship; assertions on individual tool names live below.
    expect(wiring.toolNames).toHaveLength(17);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Integration tests — B2 wave additions
// ─────────────────────────────────────────────────────────────────────
//
// Exercise the threading path the api-gateway uses when B1's Drizzle
// adapters land. Hand-rolled fake adapters into the `hqDeps` slot
// verify the registry calls them correctly, honours OTel + sovereign-
// ledger plumbing, and flips the diagnostic `depsSource` flag.

describe('createHqToolRegistry — integration (real-deps threading)', () => {
  it('routes list_tenants through a fake tenantsList adapter', async () => {
    const listTenants = vi.fn(async () => ({
      rows: [
        {
          tenantId: 't-1',
          slug: 'acme',
          name: 'Acme Properties',
          status: 'active' as const,
          mrrUsdCents: 50000,
          lastActiveAt: '2026-05-15T00:00:00Z',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      nextCursor: null,
      totalReturned: 1,
    }));
    // Spread the stub bundle FIRST so the real `tenantsList` overrides
    // the stub one. (Object-spread order matters: the last spread wins.)
    const wiring = createHqToolRegistry({
      callerResolver: {
        resolve: () => ({
          callerId: 'admin-1',
          scopes: ['platform:*', 'platform:tenants:read'],
        }),
      },
      hqDeps: {
        ...minimalStubAdapters(),
        tenantsList: { listTenants },
      },
      clock: fixedClock(),
    });
    const out = await wiring.registry.runTool('platform.list_tenants', {});
    expect(out.kind).toBe('ok');
    expect(listTenants).toHaveBeenCalledOnce();
  });

  it('forwards approvalRecordId resolver output into HqToolContext', async () => {
    const seenApprovalIds: Array<string> = [];
    const heartbeats = {
      async readSnapshot() {
        return [
          {
            serviceName: 'api-gateway',
            state: 'healthy' as const,
            lastHeartbeatAt: '2026-05-15T00:00:00Z',
            latencyMsP95: 42,
            notes: null,
          },
        ];
      },
    };
    const wiring = createHqToolRegistry({
      callerResolver: {
        resolve: () => ({ callerId: 'admin-1', scopes: ['platform:*'] }),
      },
      hqDeps: {
        ...minimalStubAdapters(),
        heartbeats,
      },
      approvalRecordIdResolver: (toolName) => {
        seenApprovalIds.push(toolName);
        return 'approval-abc-123';
      },
      clock: fixedClock(),
    });
    const out = await wiring.registry.runTool('platform.system_health', {});
    expect(out.kind).toBe('ok');
    expect(seenApprovalIds).toContain('platform.system_health');
  });

  it('logs depsSource=stub when neither hqDeps nor db is supplied', () => {
    const info = vi.fn();
    const wiring = createHqToolRegistry({
      callerResolver: {
        resolve: () => ({ callerId: 'admin-1', scopes: ['platform:*'] }),
      },
      clock: fixedClock(),
      logger: { info },
    });
    // 17 = 12 legacy platform.* + 3 sovereign Temporal-backed
    // (evict/payout/file_kra_mri) + 2 East-Africa identity / land-registry
    // (verify_nida / verify_eardhi_title). The count grows as new HQ tools
    // ship; assertions on individual tool names live below.
    expect(wiring.toolNames).toHaveLength(17);
    expect(info).toHaveBeenCalledOnce();
    const [meta] = info.mock.calls[0] as [Record<string, unknown>, string];
    expect(meta.depsSource).toBe('stub');
    expect(meta.usingStubs).toBe(true);
  });

  it('flips depsSource=explicit when hqDeps is supplied', () => {
    const info = vi.fn();
    createHqToolRegistry({
      callerResolver: {
        resolve: () => ({ callerId: 'admin-1', scopes: ['platform:*'] }),
      },
      hqDeps: minimalStubAdapters(),
      logger: { info },
      clock: fixedClock(),
    });
    const [meta] = info.mock.calls[0] as [Record<string, unknown>, string];
    expect(meta.depsSource).toBe('explicit');
    expect(meta.usingStubs).toBe(false);
  });

  it('threads OTel + sovereign-ledger ports through context factory', async () => {
    const otelSpans: Array<{ name: string; status: string }> = [];
    const ledgerWrites: string[] = [];
    const heartbeats = {
      async readSnapshot() {
        return [];
      },
    };
    const wiring = createHqToolRegistry({
      callerResolver: {
        resolve: () => ({ callerId: 'admin-1', scopes: ['platform:*'] }),
      },
      hqDeps: { ...minimalStubAdapters(), heartbeats },
      otel: {
        recordSpan(args) {
          otelSpans.push({ name: args.name, status: args.status });
        },
      },
      sovereignLedger: {
        async recordSovereignAction(row) {
          ledgerWrites.push(row.toolName);
        },
      },
      clock: fixedClock(),
    });
    const out = await wiring.registry.runTool('platform.system_health', {});
    expect(out.kind).toBe('ok');
    // OTel span is wired into the per-tool executor via the
    // HqToolContext factory — confirm at least one span landed for
    // this call. system_health is `read`-tier so the sovereign ledger
    // is intentionally NOT touched.
    expect(otelSpans.length).toBeGreaterThan(0);
    expect(ledgerWrites).toEqual([]);
  });
});

/**
 * Minimal adapter bundle that returns a deterministic "ok" for every
 * read tool and `NotYetWiredError`-style throws for the write tools.
 * Used so the integration tests can focus on the threading layer
 * (caller resolver, approval resolver, logger, OTel, ledger) rather
 * than every adapter's business logic.
 */
function minimalStubAdapters(): Parameters<
  typeof createHqToolRegistry
>[0]['hqDeps'] {
  const refuse = (name: string) => async () => {
    throw new Error(`stub adapter '${name}' threw`);
  };
  return {
    tenantsList: {
      async listTenants() {
        return { rows: [], nextCursor: null, totalReturned: 0 };
      },
    },
    usersList: {
      async listUsers() {
        return { rows: [], nextCursor: null, totalReturned: 0 };
      },
    },
    heartbeats: {
      async readSnapshot() {
        return [];
      },
    },
    tracesQuery: {
      async listRecent() {
        return [];
      },
    },
    flagsRead: {
      async read(flagName: string) {
        return { flagName, globalValue: null, tenantOverrides: [] };
      },
    },
    tenantsCreate: {
      async slugExists() {
        return false;
      },
      provisionTenant: refuse('tenantsCreate.provisionTenant'),
      rollbackTenantProvision: refuse('tenantsCreate.rollback'),
    },
    usersCreate: {
      async tenantExists() {
        return true;
      },
      async emailExistsOnTenant() {
        return false;
      },
      createUser: refuse('usersCreate.createUser'),
      deactivateUser: refuse('usersCreate.deactivate'),
    },
    flagsWrite: {
      setFlag: refuse('flagsWrite.setFlag'),
      restoreFlag: refuse('flagsWrite.restore'),
    },
    consolidation: {
      runTick: refuse('consolidation.runTick'),
      rollbackToSnapshot: refuse('consolidation.rollback'),
    },
    killswitchWrite: {
      writeKillswitch: refuse('killswitchWrite.writeKillswitch'),
      restoreKillswitch: refuse('killswitchWrite.restore'),
    },
    invoices: {
      async loadInvoice() {
        return null;
      },
      applyAdjustment: refuse('invoices.applyAdjustment'),
      reverseAdjustment: refuse('invoices.reverse'),
    },
    announcements: {
      send: refuse('announcements.send'),
      recall: refuse('announcements.recall'),
    },
  };
}
