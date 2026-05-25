/**
 * Tests for `seedHqBrainTools` — the composition entry point that
 * wires all 12 HQ tools onto a `BrainToolRegistry`.
 */
import { describe, it, expect } from 'vitest';
import {
  createBrainToolRegistry,
  type BrainToolRegistry,
} from '../../../tool-spec.js';
import {
  HQ_TOOL_NAMES,
  HQ_TOOL_TIERS,
  brainTierForRiskTier,
  seedHqBrainTools,
  type SeedHqBrainToolsDeps,
} from '../index.js';
import { buildCtx, makeInMemoryOtel } from './test-rig.js';

function makeStubDeps(): SeedHqBrainToolsDeps {
  const otel = makeInMemoryOtel();
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
      async read(flagName) {
        return { flagName, globalValue: null, tenantOverrides: [] };
      },
    },
    tenantsCreate: {
      async slugExists() {
        return false;
      },
      async provisionTenant(args) {
        return {
          tenantId: `t-${args.slug}`,
          slug: args.slug,
          name: args.name,
          plan: args.plan,
          ownerUserId: 'u-1',
          ownerEmail: args.ownerEmail,
          createdAt: '2026-05-15T09:00:00.000Z',
        };
      },
      async rollbackTenantProvision() {
        return;
      },
    },
    usersCreate: {
      async tenantExists() {
        return true;
      },
      async emailExistsOnTenant() {
        return false;
      },
      async createUser(args) {
        return {
          userId: 'u-x',
          tenantId: args.tenantId,
          email: args.email,
          role: args.role,
          status: 'active',
          invitedAt: null,
          createdAt: '2026-05-15T09:00:00.000Z',
        };
      },
      async deactivateUser() {
        return;
      },
    },
    flagsWrite: {
      async setFlag(args) {
        return {
          flagName: args.flagName,
          scope: args.scope,
          previousValue: null,
          value: args.value,
          updatedAt: '2026-05-15T09:00:00.000Z',
        };
      },
      async restoreFlag() {
        return;
      },
    },
    consolidation: {
      async runTick(args) {
        return {
          tickId: 't',
          tenantId: args.tenantId,
          applied: !args.dryRun,
          startedAt: '2026-05-15T09:00:00.000Z',
          finishedAt: '2026-05-15T09:00:01.000Z',
          factsExtracted: 0,
          patternsDetected: 0,
          digestsWritten: 0,
          decayedEntries: 0,
          snapshotId: null,
        };
      },
      async rollbackToSnapshot() {
        return;
      },
    },
    killswitchWrite: {
      async writeKillswitch(args) {
        return {
          scope: args.scope,
          level: args.level,
          reasonCode: args.reasonCode,
          note: args.note,
          previous: null,
          updatedAt: '2026-05-15T09:00:00.000Z',
        };
      },
      async restoreKillswitch() {
        return;
      },
    },
    invoices: {
      async loadInvoice(invoiceId) {
        return { invoiceId, tenantId: 't-alpha', balanceCents: 100_00 };
      },
      async applyAdjustment(args) {
        return {
          invoiceId: args.invoiceId,
          tenantId: 't-alpha',
          adjustmentId: 'adj-1',
          adjustmentCents: args.adjustmentCents,
          category: args.category,
          reason: args.reason,
          newBalanceCents: 100_00 + args.adjustmentCents,
          appliedAt: '2026-05-15T09:00:00.000Z',
        };
      },
      async reverseAdjustment() {
        return;
      },
    },
    announcements: {
      async send(args) {
        return {
          announcementId: 'ann-1',
          scope: args.scope,
          channel: args.channel,
          subject: args.subject,
          recipientCount: 1,
          scheduledFor: args.scheduleAt ?? '2026-05-15T09:00:00.000Z',
          status: 'queued',
        };
      },
      async recall() {
        return;
      },
    },
    evictionDispatcher: {
      async start(args) {
        return {
          workflowId: `eviction-${args.leaseId}`,
          runId: 'run-1',
        };
      },
      async withdraw() {
        return;
      },
    },
    ownerPayoutDispatcher: {
      async start(args) {
        return {
          workflowId: `owner-payout-${args.ownerId}-${args.periodEnd}`,
          runId: 'run-1',
        };
      },
      async refund() {
        return;
      },
      async estimateUsdCents() {
        return 100_00; // $100 — well under any ceiling
      },
    },
    kraMriDispatcher: {
      async start(args) {
        return {
          workflowId: `kra-mri-${args.tenantId}-${args.taxPeriodMonth}`,
          runId: 'run-1',
        };
      },
      async requestRetraction() {
        return;
      },
    },
    maxAdjustmentUsdCents: 500_00,
    maxRecipientCount: 10_000,
    maxPayoutUsdCents: 100_000_00, // $100k
    contextFactory: () => buildCtx({ otel }),
  };
}

describe('seedHqBrainTools', () => {
  let registry: BrainToolRegistry;

  it('registers all platform.* tools advertised in HQ_TOOL_NAMES', () => {
    registry = createBrainToolRegistry();
    const names = seedHqBrainTools(registry, makeStubDeps());
    // Length-agnostic: source of truth is HQ_TOOL_NAMES.
    expect(names).toHaveLength(HQ_TOOL_NAMES.length);
    for (const expected of HQ_TOOL_NAMES) {
      expect(registry.get(expected)).not.toBeNull();
    }
  });

  it('maps risk-tiers onto BrainTool tier classes', () => {
    expect(brainTierForRiskTier('read')).toBe('free');
    expect(brainTierForRiskTier('mutate')).toBe('pro');
    expect(brainTierForRiskTier('destroy')).toBe('enterprise');
    expect(brainTierForRiskTier('billing')).toBe('enterprise');
    expect(brainTierForRiskTier('external-comm')).toBe('enterprise');
  });

  it('every HQ_TOOL_TIERS entry has matching name in HQ_TOOL_NAMES', () => {
    expect(Object.keys(HQ_TOOL_TIERS).sort()).toEqual([...HQ_TOOL_NAMES].sort());
  });

  it('runTool surfaces input validation', async () => {
    registry = createBrainToolRegistry();
    seedHqBrainTools(registry, makeStubDeps());
    const out = await registry.runTool('platform.list_tenants', { limit: 500 });
    expect(out.kind).toBe('input-invalid');
  });

  it('runTool happy-path for platform.system_health', async () => {
    registry = createBrainToolRegistry();
    seedHqBrainTools(registry, makeStubDeps());
    const out = await registry.runTool('platform.system_health', {});
    expect(out.kind).toBe('ok');
  });
});
