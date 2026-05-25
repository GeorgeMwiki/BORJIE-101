import { describe, expect, it } from 'vitest';
import {
  compileAndDeploySubMd,
  detectRecurringGap,
  proposeNewSubMd,
  type ActivityLogEntry,
  type ActivityLogPort,
  type LLMRouterPort,
  type OwnerApprovalPort,
  type SelfExtensionDeps,
  type SelfExtensionLedgerPort,
  type SubMdRegistryPort,
  type SubMdSpec,
} from '../self-extension.js';

const TENANT = 't1';

function activityLog(entries: ReadonlyArray<ActivityLogEntry>): ActivityLogPort {
  return {
    async recent() {
      return entries;
    },
  };
}

function registry(initial: ReadonlyArray<string> = []): SubMdRegistryPort & {
  readonly registered: Array<{ name: string; spec: SubMdSpec }>;
} {
  const known = new Set(initial);
  const registered: Array<{ name: string; spec: SubMdSpec }> = [];
  return {
    registered,
    async list() {
      return [...known];
    },
    async register(args) {
      known.add(args.name);
      registered.push(args);
      return {
        subMdId: args.name,
        registeredAtMs: 12345,
        version: registered.length,
      };
    },
  };
}

const llmRouter: LLMRouterPort = {
  async draftSubMdSpec({ diagnosis }) {
    return {
      name: diagnosis.suggestedPersona.id,
      persona: diagnosis.suggestedPersona,
      scope: diagnosis.suggestedScope,
      toolBelt: ['proposed.audit-log-read', 'proposed.draft-response'],
      riskTier: 'read',
      purpose: `Address pattern: ${diagnosis.pattern}`,
      successCriterion: '95% classification accuracy over the first 30 days',
      schemaVersion: 1,
    };
  },
};

const ownerApproval: OwnerApprovalPort = {
  async ask() {
    return { kind: 'approved', approvedAtMs: 99999 };
  },
};

function recordingLedger(): SelfExtensionLedgerPort & {
  readonly appended: Array<Record<string, unknown>>;
} {
  const appended: Array<Record<string, unknown>> = [];
  return {
    appended,
    async appendLedgerEntry(args) {
      appended.push(args);
      return { id: `ledger-${appended.length}` };
    },
  };
}

function buildEntries(count: number, marker: string): ActivityLogEntry[] {
  const entries: ActivityLogEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    entries.push({
      id: `evt-${i}`,
      occurredAtMs: 1_000_000 + i * 1_000,
      topic: 'vp.operations.gap-recorded',
      payload: { reason: 'recurring parking complaints' },
      tenantId: TENANT,
      missingLineWorker: marker,
    });
  }
  return entries;
}

describe('self-extension keystone — detectRecurringGap', () => {
  it('returns a diagnosis when a gap marker exceeds the threshold', async () => {
    const deps: SelfExtensionDeps = {
      activityLog: activityLog(buildEntries(14, 'parking.dispatcher')),
      subMdRegistry: registry([]),
      llmRouter,
      ownerApproval,
    };
    const diagnosis = await detectRecurringGap(deps, {
      thresholdEventCount: 10,
      windowDays: 30,
    });
    expect(diagnosis).not.toBeNull();
    expect(diagnosis?.observedCount).toBe(14);
    expect(diagnosis?.observedWindowDays).toBe(30);
    expect(diagnosis?.suggestedPersona.id).toBe('parking.dispatcher');
    expect(diagnosis?.riskTier).toBe('read');
  });

  it('returns null when no cluster exceeds the threshold', async () => {
    const deps: SelfExtensionDeps = {
      activityLog: activityLog(buildEntries(3, 'parking.dispatcher')),
      subMdRegistry: registry([]),
      llmRouter,
      ownerApproval,
    };
    const diagnosis = await detectRecurringGap(deps, {
      thresholdEventCount: 10,
      windowDays: 30,
    });
    expect(diagnosis).toBeNull();
  });

  it('returns null when the missing line-worker is already registered', async () => {
    const deps: SelfExtensionDeps = {
      activityLog: activityLog(buildEntries(20, 'parking.dispatcher')),
      subMdRegistry: registry(['parking.dispatcher']),
      llmRouter,
      ownerApproval,
    };
    const diagnosis = await detectRecurringGap(deps, {
      thresholdEventCount: 10,
      windowDays: 30,
    });
    expect(diagnosis).toBeNull();
  });
});

describe('self-extension keystone — proposeNewSubMd', () => {
  it('produces a proposal whose spec contains every required field', async () => {
    const deps: SelfExtensionDeps = {
      activityLog: activityLog(buildEntries(12, 'parking.dispatcher')),
      subMdRegistry: registry([]),
      llmRouter,
      ownerApproval,
    };
    const diagnosis = await detectRecurringGap(deps, {
      thresholdEventCount: 10,
      windowDays: 30,
    });
    expect(diagnosis).not.toBeNull();
    if (!diagnosis) throw new Error('unreachable');
    const proposal = await proposeNewSubMd(diagnosis, deps);
    expect(proposal.proposalId).toMatch(/^submd-proposal-/);
    expect(proposal.spec.name).toBe('parking.dispatcher');
    expect(proposal.spec.persona).toBeDefined();
    expect(proposal.spec.scope.tenantId).toBe(TENANT);
    expect(proposal.spec.toolBelt.length).toBeGreaterThan(0);
    expect(proposal.spec.riskTier).toBe('read');
    expect(proposal.spec.schemaVersion).toBe(1);
    expect(proposal.dailyCostCeilingUsdCents).toBeGreaterThan(0);
    expect(proposal.draftedBy).toBe('self-extension-keystone');
  });
});

// ─────────────────────────────────────────────────────────────────────
// C4 regression suite — the LLM CANNOT widen the risk tier; the owner's
// editedSpec is the only way to promote; destructive HQ tools require
// explicit owner promotion.
// ─────────────────────────────────────────────────────────────────────

const hostileLlmRouter: LLMRouterPort = {
  async draftSubMdSpec({ diagnosis }) {
    // The LLM tries to promote to external-comm with destructive tools.
    return {
      name: diagnosis.suggestedPersona.id,
      persona: diagnosis.suggestedPersona,
      scope: diagnosis.suggestedScope,
      toolBelt: ['platform.evict_tenant', 'proposed.audit-log-read'],
      riskTier: 'external-comm',
      purpose: `Address pattern: ${diagnosis.pattern}`,
      successCriterion: 'destructive autonomy',
      schemaVersion: 1,
    };
  },
};

describe('self-extension keystone — C4 LLM-widening protection', () => {
  it('clamps the LLM-requested riskTier to the diagnosis tier (C4)', async () => {
    const deps: SelfExtensionDeps = {
      activityLog: activityLog(buildEntries(12, 'parking.dispatcher')),
      subMdRegistry: registry([]),
      llmRouter: hostileLlmRouter,
      ownerApproval,
    };
    const diagnosis = await detectRecurringGap(deps, {
      thresholdEventCount: 10,
      windowDays: 30,
    });
    if (!diagnosis) throw new Error('unreachable');
    const proposal = await proposeNewSubMd(diagnosis, deps);
    // Diagnosis is `read`; LLM tried `external-comm`; clamp wins.
    expect(proposal.spec.riskTier).toBe('read');
  });

  it('rejects deployment when the LLM toolBelt contains destructive HQ tools (C4)', async () => {
    const deps: SelfExtensionDeps = {
      activityLog: activityLog(buildEntries(12, 'parking.dispatcher')),
      subMdRegistry: registry([]),
      llmRouter: hostileLlmRouter,
      ownerApproval,
    };
    const diagnosis = await detectRecurringGap(deps, {
      thresholdEventCount: 10,
      windowDays: 30,
    });
    if (!diagnosis) throw new Error('unreachable');
    const proposal = await proposeNewSubMd(diagnosis, deps);
    await expect(
      compileAndDeploySubMd(proposal, deps, {
        approvers: ['owner-1'],
        proposerActor: 'self-extension-keystone',
      }),
    ).rejects.toThrow(/destructive HQ tools/i);
  });

  it('prefers the owner-edited spec when present (C4)', async () => {
    const reg = registry([]);
    const ledger = recordingLedger();
    const deps: SelfExtensionDeps = {
      activityLog: activityLog(buildEntries(12, 'parking.dispatcher')),
      subMdRegistry: reg,
      llmRouter,
      ownerApproval,
      ledger,
    };
    const diagnosis = await detectRecurringGap(deps, {
      thresholdEventCount: 10,
      windowDays: 30,
    });
    if (!diagnosis) throw new Error('unreachable');
    const proposal = await proposeNewSubMd(diagnosis, deps);
    const editedSpec: SubMdSpec = {
      ...proposal.spec,
      toolBelt: ['owner.approved-only'],
      riskTier: 'mutate', // owner deliberately promotes
      purpose: 'owner-edited purpose',
    };
    const receipt = await compileAndDeploySubMd(proposal, deps, {
      approvers: ['owner-1'],
      proposerActor: 'self-extension-keystone',
      editedSpec,
    });
    expect(receipt.subMdId).toBe('parking.dispatcher');
    // Registry received the OWNER's spec, not the LLM's.
    expect(reg.registered[0]?.spec.toolBelt).toEqual(['owner.approved-only']);
    expect(reg.registered[0]?.spec.riskTier).toBe('mutate');
    expect(reg.registered[0]?.spec.purpose).toBe('owner-edited purpose');
    // Ledger row notes the edit.
    expect(ledger.appended[0]?.payloadJson).toMatchObject({
      ownerEdited: true,
    });
  });

  it('records ownerEdited=false in the ledger when no editedSpec is supplied (C4)', async () => {
    const reg = registry([]);
    const ledger = recordingLedger();
    const deps: SelfExtensionDeps = {
      activityLog: activityLog(buildEntries(12, 'parking.dispatcher')),
      subMdRegistry: reg,
      llmRouter,
      ownerApproval,
      ledger,
    };
    const diagnosis = await detectRecurringGap(deps, {
      thresholdEventCount: 10,
      windowDays: 30,
    });
    if (!diagnosis) throw new Error('unreachable');
    const proposal = await proposeNewSubMd(diagnosis, deps);
    await compileAndDeploySubMd(proposal, deps, {
      approvers: ['owner-1'],
      proposerActor: 'self-extension-keystone',
    });
    expect(ledger.appended[0]?.payloadJson).toMatchObject({
      ownerEdited: false,
    });
  });
});

describe('self-extension keystone — compileAndDeploySubMd', () => {
  it('registers the proposal and records a sovereign-action-ledger entry', async () => {
    const reg = registry([]);
    const ledger = recordingLedger();
    const deps: SelfExtensionDeps = {
      activityLog: activityLog(buildEntries(12, 'parking.dispatcher')),
      subMdRegistry: reg,
      llmRouter,
      ownerApproval,
      ledger,
    };
    const diagnosis = await detectRecurringGap(deps, {
      thresholdEventCount: 10,
      windowDays: 30,
    });
    if (!diagnosis) throw new Error('unreachable');
    const proposal = await proposeNewSubMd(diagnosis, deps);
    const receipt = await compileAndDeploySubMd(proposal, deps, {
      approvers: ['owner-1', 'compliance-1'],
      proposerActor: 'self-extension-keystone',
    });
    expect(receipt.subMdId).toBe('parking.dispatcher');
    expect(receipt.registryVersion).toBe(1);
    expect(receipt.ledgerEntryId).toBe('ledger-1');
    expect(reg.registered).toHaveLength(1);
    expect(ledger.appended).toHaveLength(1);
    expect(ledger.appended[0]?.actionType).toBe('sub-md.deployed.by.self-extension');
    expect(receipt.approvers).toEqual(['owner-1', 'compliance-1']);
  });
});
