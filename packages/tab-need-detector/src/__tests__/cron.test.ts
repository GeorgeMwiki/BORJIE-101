/**
 * Tests for cron.ts — end-to-end pipeline against an in-memory
 * NeedDetectorRepository fake.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCron, scanTenant, type NeedDetectorRepository } from '../cron.js';
import { observeConversation } from '../signal-observers/index.js';
import type {
  DetectorStateConfig,
  ModuleTemplateId,
  ProposalRow,
  SignalRow,
} from '../types.js';
import type { ProposalHistoryEntry } from '../proposal-emitter.js';

// ─────────────────────────────────────────────────────────────────────────
// In-memory repository fake.
// ─────────────────────────────────────────────────────────────────────────

interface FakeState {
  tenants: string[];
  signals: SignalRow[];
  proposals: ProposalRow[];
  installed: Map<string, Set<ModuleTemplateId>>;
  detectorStates: Map<string, {
    lastScanAt: Date | null;
    totalSignalsScanned: number;
    totalProposalsEmitted: number;
    config: DetectorStateConfig;
  }>;
}

function makeRepo(state: FakeState): NeedDetectorRepository {
  return {
    listTenants: async (): Promise<readonly string[]> => state.tenants,
    getDetectorState: async (tenantId) =>
      state.detectorStates.get(tenantId) ?? {
        lastScanAt: null,
        totalSignalsScanned: 0,
        totalProposalsEmitted: 0,
        config: {},
      },
    fetchSignalsSince: async (tenantId, since) =>
      state.signals.filter(
        (s) => s.tenantId === tenantId && s.createdAt >= since,
      ),
    getInstalledModuleTemplateIds: async (tenantId) =>
      state.installed.get(tenantId) ?? new Set<ModuleTemplateId>(),
    fetchProposalHistory: async (tenantId, sinceDecidedAfter): Promise<readonly ProposalHistoryEntry[]> =>
      state.proposals
        .filter(
          (p) =>
            p.tenantId === tenantId &&
            (p.decidedAt ?? p.createdAt) >= sinceDecidedAfter,
        )
        .map((p) => ({
          userId: p.userId,
          suggestedModuleTemplateId: p.suggestedModuleTemplateId,
          status: p.status,
          decidedAt: p.decidedAt,
          createdAt: p.createdAt,
        })),
    fetchExpiredPending: async (tenantId, now) =>
      state.proposals
        .filter(
          (p) =>
            p.tenantId === tenantId &&
            p.status === 'pending' &&
            p.expiresAt <= now,
        )
        .map((p) => ({ id: p.id, expiresAt: p.expiresAt })),
    insertProposals: async (rows) => {
      state.proposals.push(...rows);
    },
    markExpired: async (tenantId, ids, now) => {
      for (const id of ids) {
        const row = state.proposals.find(
          (p) => p.id === id && p.tenantId === tenantId,
        );
        if (row && row.status === 'pending') {
          (row as { status: ProposalRow['status'] }).status = 'expired';
          (row as { decidedAt: Date | null }).decidedAt = now;
        }
      }
    },
    upsertDetectorState: async (input) => {
      state.detectorStates.set(input.tenantId, {
        lastScanAt: input.lastScanAt,
        totalSignalsScanned: input.signalsScanned,
        totalProposalsEmitted: input.proposalsEmitted,
        config: input.config,
      });
    },
  };
}

let idCounter = 0;
function fakeId(): string {
  idCounter += 1;
  return `prop-${idCounter}`;
}

const NOW = new Date('2026-05-22T00:00:00Z');

let state: FakeState;

beforeEach(() => {
  idCounter = 0;
  state = {
    tenants: ['tnt-1'],
    signals: [],
    proposals: [],
    installed: new Map(),
    detectorStates: new Map(),
  };
});

// ─────────────────────────────────────────────────────────────────────────
// Tests.
// ─────────────────────────────────────────────────────────────────────────

describe('scanTenant', () => {
  it('emits zero proposals for empty signal set', async () => {
    const summary = await scanTenant('tnt-1', {
      repo: makeRepo(state),
      now: NOW,
      generateId: fakeId,
    });
    expect(summary.signalsScanned).toBe(0);
    expect(summary.proposalsEmitted).toBe(0);
  });

  it('emits a proposal when signals push score above default threshold', async () => {
    // Seed 5+ matching signals so the score crosses the default 5.0.
    state.signals = Array.from({ length: 8 }, (_, i): SignalRow => ({
      id: `s-${i}`,
      tenantId: 'tnt-1',
      userId: 'usr-1',
      signalKind: 'conversation_intent',
      signalPayload: {},
      suggestedModuleTemplateId: 'COMPLIANCE',
      weight: 1.5,
      createdAt: new Date(NOW.getTime() - i * 24 * 60 * 60 * 1000),
    }));

    const summary = await scanTenant('tnt-1', {
      repo: makeRepo(state),
      now: NOW,
      generateId: fakeId,
    });

    expect(summary.signalsScanned).toBe(8);
    expect(summary.proposalsEmitted).toBe(1);
    expect(state.proposals).toHaveLength(1);
    expect(state.proposals[0]?.suggestedModuleTemplateId).toBe('COMPLIANCE');
    expect(state.proposals[0]?.status).toBe('pending');
  });

  it('does NOT re-propose if user declined within snooze window', async () => {
    state.signals = Array.from({ length: 10 }, (_, i): SignalRow => ({
      id: `s-${i}`,
      tenantId: 'tnt-1',
      userId: 'usr-1',
      signalKind: 'conversation_intent',
      signalPayload: {},
      suggestedModuleTemplateId: 'COMPLIANCE',
      weight: 1.5,
      createdAt: new Date(NOW.getTime() - i * 24 * 60 * 60 * 1000),
    }));
    state.proposals = [
      {
        id: 'old-prop',
        tenantId: 'tnt-1',
        userId: 'usr-1',
        suggestedModuleTemplateId: 'COMPLIANCE',
        score: 7,
        topSignalIds: [],
        proposalMessage: 'x',
        status: 'declined',
        decidedAt: new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000),
        createdAt: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000),
      },
    ];

    const summary = await scanTenant('tnt-1', {
      repo: makeRepo(state),
      now: NOW,
      generateId: fakeId,
    });

    expect(summary.proposalsEmitted).toBe(0);
    // Original declined proposal still present.
    expect(state.proposals.filter((p) => p.status === 'declined')).toHaveLength(1);
    // No new pending proposal.
    expect(state.proposals.filter((p) => p.status === 'pending')).toHaveLength(0);
  });

  it('re-proposes after 30+ days from a previous decline', async () => {
    state.signals = Array.from({ length: 10 }, (_, i): SignalRow => ({
      id: `s-${i}`,
      tenantId: 'tnt-1',
      userId: 'usr-1',
      signalKind: 'conversation_intent',
      signalPayload: {},
      suggestedModuleTemplateId: 'COMPLIANCE',
      weight: 1.5,
      createdAt: new Date(NOW.getTime() - i * 24 * 60 * 60 * 1000),
    }));
    state.proposals = [
      {
        id: 'old-prop',
        tenantId: 'tnt-1',
        userId: 'usr-1',
        suggestedModuleTemplateId: 'COMPLIANCE',
        score: 7,
        topSignalIds: [],
        proposalMessage: 'x',
        status: 'declined',
        decidedAt: new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000),
        createdAt: new Date(NOW.getTime() - 70 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(NOW.getTime() - 56 * 24 * 60 * 60 * 1000),
      },
    ];

    // History fetch is scoped to the snooze window (30d) so a 60-day-old
    // decline won't be returned at all — emitter sees no blocking history.
    const summary = await scanTenant('tnt-1', {
      repo: makeRepo(state),
      now: NOW,
      generateId: fakeId,
    });

    expect(summary.proposalsEmitted).toBe(1);
  });

  it('skips already-installed modules', async () => {
    state.signals = Array.from({ length: 10 }, (_, i): SignalRow => ({
      id: `s-${i}`,
      tenantId: 'tnt-1',
      userId: 'usr-1',
      signalKind: 'conversation_intent',
      signalPayload: {},
      suggestedModuleTemplateId: 'COMPLIANCE',
      weight: 1.5,
      createdAt: new Date(NOW.getTime() - i * 24 * 60 * 60 * 1000),
    }));
    state.installed.set('tnt-1', new Set(['COMPLIANCE'] as ModuleTemplateId[]));

    const summary = await scanTenant('tnt-1', {
      repo: makeRepo(state),
      now: NOW,
      generateId: fakeId,
    });

    expect(summary.proposalsEmitted).toBe(0);
    expect(summary.skipped).toBe(1);
  });

  it('expires overdue pending proposals', async () => {
    state.proposals = [
      {
        id: 'p1',
        tenantId: 'tnt-1',
        userId: 'usr-1',
        suggestedModuleTemplateId: 'COMPLIANCE',
        score: 7,
        topSignalIds: [],
        proposalMessage: 'x',
        status: 'pending',
        decidedAt: null,
        createdAt: new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000),
      },
    ];

    const summary = await scanTenant('tnt-1', {
      repo: makeRepo(state),
      now: NOW,
      generateId: fakeId,
    });

    expect(summary.expired).toBe(1);
    expect(state.proposals[0]?.status).toBe('expired');
  });

  it('upserts detector state with bumped totals', async () => {
    state.signals = [
      {
        id: 's1',
        tenantId: 'tnt-1',
        userId: 'usr-1',
        signalKind: 'doc_upload',
        signalPayload: {},
        suggestedModuleTemplateId: 'COMPLIANCE',
        weight: 1,
        createdAt: NOW,
      },
    ];

    await scanTenant('tnt-1', {
      repo: makeRepo(state),
      now: NOW,
      generateId: fakeId,
    });

    const st = state.detectorStates.get('tnt-1');
    expect(st).toBeDefined();
    expect(st?.lastScanAt).toEqual(NOW);
    expect(st?.totalSignalsScanned).toBe(1);
  });

  it('respects per-tenant config overrides via state.config', async () => {
    state.signals = Array.from({ length: 4 }, (_, i): SignalRow => ({
      id: `s-${i}`,
      tenantId: 'tnt-1',
      userId: 'usr-1',
      signalKind: 'conversation_intent',
      signalPayload: {},
      suggestedModuleTemplateId: 'COMPLIANCE',
      weight: 1.5,
      createdAt: NOW,
    }));
    // Lower threshold via state config so 6 ~ already past threshold.
    state.detectorStates.set('tnt-1', {
      lastScanAt: null,
      totalSignalsScanned: 0,
      totalProposalsEmitted: 0,
      config: { scoreThreshold: 3.0 },
    });

    const summary = await scanTenant('tnt-1', {
      repo: makeRepo(state),
      now: NOW,
      generateId: fakeId,
    });
    expect(summary.proposalsEmitted).toBe(1);
  });
});

describe('runCron', () => {
  it('processes multiple tenants and isolates failures', async () => {
    state.tenants = ['tnt-1', 'tnt-2'];
    state.signals = [];

    const summary = await runCron({
      repo: makeRepo(state),
      now: NOW,
      generateId: fakeId,
    });

    expect(summary.tenantsProcessed).toBe(2);
    expect(summary.perTenant.map((t) => t.tenantId)).toEqual([
      'tnt-1',
      'tnt-2',
    ]);
  });

  it('catches per-tenant errors and continues', async () => {
    state.tenants = ['tnt-good', 'tnt-bad'];
    const wrappedRepo = makeRepo(state);
    const failingRepo: NeedDetectorRepository = {
      ...wrappedRepo,
      fetchSignalsSince: async (tenantId, since) => {
        if (tenantId === 'tnt-bad') {
          throw new Error('boom');
        }
        return wrappedRepo.fetchSignalsSince(tenantId, since);
      },
    };

    const logs: Array<{ level: string; msg: string }> = [];
    const summary = await runCron({
      repo: failingRepo,
      now: NOW,
      generateId: fakeId,
      log: (level, msg): void => {
        logs.push({ level, msg });
      },
    });

    expect(summary.tenantsProcessed).toBe(2);
    // Both tenants attempted, one logged an error.
    expect(logs.some((l) => l.level === 'error' && l.msg.includes('tnt-bad'))).toBe(true);
  });
});

describe('observer → cron pipeline integration', () => {
  it('observed events feed the cron pipeline and trigger a proposal', async () => {
    // Observe a few conversation events.
    const signalsToInsert = [
      ...observeConversation({
        tenantId: 'tnt-1',
        userId: 'usr-1',
        messageId: 'm1',
        entities: [['COMPLIANCE', 'tax']],
      }),
      ...observeConversation({
        tenantId: 'tnt-1',
        userId: 'usr-1',
        messageId: 'm2',
        entities: [['AUDIT', 'fy24']],
      }),
      ...observeConversation({
        tenantId: 'tnt-1',
        userId: 'usr-1',
        messageId: 'm3',
        entities: [['KRA', 'review']],
      }),
      ...observeConversation({
        tenantId: 'tnt-1',
        userId: 'usr-1',
        messageId: 'm4',
        intent: 'compliance_query',
        entities: [],
      }),
    ];
    state.signals = signalsToInsert.map((s, i) => ({
      id: `s-${i}`,
      tenantId: s.tenantId,
      userId: s.userId,
      signalKind: s.signalKind,
      signalPayload: s.signalPayload,
      suggestedModuleTemplateId: s.suggestedModuleTemplateId,
      weight: s.weight,
      createdAt: NOW,
    }));

    const summary = await scanTenant('tnt-1', {
      repo: makeRepo(state),
      now: NOW,
      generateId: fakeId,
    });

    expect(summary.signalsScanned).toBe(signalsToInsert.length);
    // 1.5 (COMPLIANCE) + 1.4 (AUDIT) + 1.5 (KRA) + 1.0 (intent) = 5.4 > 5
    expect(summary.proposalsEmitted).toBe(1);
  });
});
