/**
 * self-extension-cron.test.ts — proves the governed, propose-only driver:
 *   1. A recurring gap (yielded by a mock ActivityLogPort) flows
 *      detectRecurringGap → proposeNewSubMd → a FOUR-EYE pending proposal.
 *   2. It ALSO drives the propose-only self-build edge (driveGapToProposal).
 *   3. It NEVER calls a real deploy/apply (compileAndDeploySubMd is a spy that
 *      must never be invoked).
 *   4. Honest-degrade: a throwing port → no crash, structured zero-ish result.
 *
 * The cron injects its own ActivityLogPort PER TENANT, so to exercise the
 * keystone with a recurring gap we inject a `subMdRegistry` + `llmRouter` and
 * stub the DB `execute` to return the gap rows the Drizzle ActivityLogPort
 * reads. We assert behaviour through the four-eye spy + self-build spy.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { orchestrator } from '@borjie/central-intelligence';
import {
  createSelfExtensionCron,
  type FourEyeEnqueuePort,
  type SelfExtensionCronDeps,
} from '../self-extension-cron.js';
import type {
  SelfBuildOrchestrator,
  DriveGapResult,
} from '../self-build/index.js';

// ─────────────────────────────────────────────────────────────────────
// Fakes
// ─────────────────────────────────────────────────────────────────────

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * A DB whose `execute` returns the tenant list, then a fat cluster of explicit
 * capability-gap rows for `md_commitments` (so the detector's
 * `missingLineWorker` cluster clears the threshold). decision_traces +
 * audit_events return empty.
 */
function makeGapDb(args: {
  readonly tenantId: string;
  readonly gapCount: number;
}): { execute: (q: unknown) => Promise<unknown> } {
  const gapRows = Array.from({ length: args.gapCount }, (_, i) => ({
    id: `gap-${i}`,
    kind: 'royalty.reconcile',
    gap_kind: 'unwired_organ',
    competence_domain: 'royalty',
    created_at: new Date(),
  }));
  return {
    async execute(q: unknown) {
      const text = JSON.stringify(q);
      if (text.includes('FROM tenants')) {
        return { rows: [{ id: args.tenantId }] };
      }
      if (text.includes('md_commitments')) {
        return { rows: gapRows };
      }
      // decision_traces + audit_events → no rows.
      return { rows: [] };
    },
  };
}

/**
 * The registry whose `register` is the ONLY thing `compileAndDeploySubMd`
 * (the runtime-apply path) ever calls. Spying on it is the most robust
 * "deploy never happened" assertion: if `register` is untouched, no sub-MD was
 * compiled/deployed/activated — the apply path stayed UNMOUNTED.
 */
function makeRegistrySpy(): {
  readonly port: orchestrator.SubMdRegistryPort;
  readonly register: ReturnType<typeof vi.fn>;
} {
  const register = vi.fn(async () => ({
    subMdId: 'should-never-register',
    registeredAtMs: 0,
    version: 1,
  }));
  return {
    register,
    port: {
      async list() {
        return [];
      },
      register: register as never,
    },
  };
}

function makeLlmRouter(): orchestrator.SelfExtensionLLMRouterPort {
  return {
    async draftSubMdSpec({ diagnosis }) {
      return {
        name: 'royalty_reconciler',
        persona: diagnosis.suggestedPersona,
        scope: diagnosis.suggestedScope,
        toolBelt: [],
        riskTier: 'read',
        purpose: 'Reconcile recurring royalty discrepancies.',
        successCriterion: '95%-reconciliation-accuracy',
        schemaVersion: 1,
      };
    },
  };
}

function makeSelfBuildSpy(): {
  readonly orchestrator: SelfBuildOrchestrator;
  readonly drive: ReturnType<typeof vi.fn>;
} {
  const drive = vi.fn(
    async (): Promise<DriveGapResult> =>
      Object.freeze({
        ok: true as const,
        moduleId: 'mod_x',
        specId: 'mspec_x',
        moduleSlug: 'royalty_capability_x',
        specStatus: 'proposed' as const,
        dryRun: { tableCount: 1, workflowCount: 1, uiSectionCount: 3, moneyFieldCount: 0 },
      }),
  );
  return {
    drive,
    orchestrator: {
      driveGapToProposal: drive as never,
      async listProposals() {
        return [];
      },
      async getProposal() {
        return null;
      },
      async recordApproval() {
        return false;
      },
    },
  };
}

function makeFourEyeSpy(): {
  readonly port: FourEyeEnqueuePort;
  readonly enqueue: ReturnType<typeof vi.fn>;
} {
  const enqueue = vi.fn(async () => ({ requestId: 'req_1' }));
  return { port: { enqueue: enqueue as never }, enqueue };
}

type FakeDb = { execute: (q: unknown) => Promise<unknown> };

function baseDeps(
  overrides: Partial<SelfExtensionCronDeps> & { db?: FakeDb } = {},
): SelfExtensionCronDeps {
  const { db: dbOverride, ...rest } = overrides;
  const db: FakeDb = dbOverride ?? makeGapDb({ tenantId: 'tnt-1', gapCount: 12 });
  return {
    // Identity service-role wrapper over the fake db (no real GUC in tests).
    withServiceRole: (<T,>(fn: (tx: FakeDb) => Promise<T>) => fn(db)) as SelfExtensionCronDeps['withServiceRole'],
    logger: silentLogger,
    fourEye: makeFourEyeSpy().port,
    subMdRegistry: makeRegistrySpy().port,
    llmRouter: makeLlmRouter(),
    enabled: false,
    clock: () => 1_700_000_000_000,
    ...rest,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

describe('createSelfExtensionCron — governed, propose-only', () => {
  it('drives recurring gap → four-eye proposal + self-build edge, never deploys', async () => {
    const fourEye = makeFourEyeSpy();
    const selfBuild = makeSelfBuildSpy();
    // The registry's `register` is the ONLY thing compileAndDeploySubMd calls.
    // If it stays untouched, the runtime-apply path was never reached.
    const registry = makeRegistrySpy();

    const cron = createSelfExtensionCron(
      baseDeps({
        db: makeGapDb({ tenantId: 'tnt-1', gapCount: 12 }),
        fourEye: fourEye.port,
        selfBuild: selfBuild.orchestrator,
        subMdRegistry: registry.port,
        thresholdEventCount: 10,
      }),
    );

    const result = await cron.tickOnce();

    expect(result.tenantsScanned).toBe(1);
    expect(result.diagnosed).toBe(1);
    expect(result.proposalsEnqueued).toBe(1);
    expect(result.buildProposalsDriven).toBe(1);
    expect(result.errored).toBe(0);

    // Routed to the FOUR-EYE inbox as a propose-only pending approval.
    expect(fourEye.enqueue).toHaveBeenCalledTimes(1);
    const enqueueArg = fourEye.enqueue.mock.calls[0]![0] as {
      actionType: string;
      payload: Record<string, unknown>;
    };
    expect(enqueueArg.actionType).toBe('self_extension.sub_md.propose');
    expect(enqueueArg.payload.applied).toBe(false);
    expect(enqueueArg.payload.subMdName).toBe('royalty_reconciler');

    // Detect→build edge fired (propose-only dry-run).
    expect(selfBuild.drive).toHaveBeenCalledTimes(1);

    // ── ABSOLUTE GOVERNANCE ASSERTION — the deploy/apply path is UNMOUNTED.
    // No sub-MD was registered → compileAndDeploySubMd was never invoked.
    expect(registry.register).not.toHaveBeenCalled();
  });

  it('SOURCE: the cron never imports or CALLS the runtime-apply primitive', () => {
    const here = fileURLToPath(import.meta.url);
    const src = readFileSync(
      here.replace('__tests__/self-extension-cron.test.ts', 'self-extension-cron.ts'),
      'utf8',
    );
    // The docstring may NAME compileAndDeploySubMd to explain what stays
    // unmounted, but there must be NO call expression and NO orchestrator
    // member access that would reach the runtime-apply path.
    expect(src).not.toMatch(/compileAndDeploySubMd\s*\(/);
    expect(src).not.toContain('orchestrator.compileAndDeploySubMd');
    expect(src).not.toMatch(/import[^;]*compileAndDeploySubMd/);
  });

  it('no recurring gap (below threshold) → no proposal, no deploy', async () => {
    const fourEye = makeFourEyeSpy();
    const registry = makeRegistrySpy();
    const cron = createSelfExtensionCron(
      baseDeps({
        db: makeGapDb({ tenantId: 'tnt-1', gapCount: 3 }), // < threshold
        fourEye: fourEye.port,
        subMdRegistry: registry.port,
        thresholdEventCount: 10,
      }),
    );

    const result = await cron.tickOnce();

    expect(result.diagnosed).toBe(0);
    expect(result.proposalsEnqueued).toBe(0);
    expect(fourEye.enqueue).not.toHaveBeenCalled();
    expect(registry.register).not.toHaveBeenCalled();
  });

  it('honest-degrade: a throwing DB never crashes the tick', async () => {
    const throwingDb = {
      async execute() {
        throw new Error('db is down');
      },
    };
    const fourEye = makeFourEyeSpy();
    const cron = createSelfExtensionCron(
      baseDeps({ db: throwingDb, fourEye: fourEye.port }),
    );

    // Must resolve (never throw) and report a clean zero scan.
    const result = await cron.tickOnce();
    expect(result.tenantsScanned).toBe(0);
    expect(result.diagnosed).toBe(0);
    expect(fourEye.enqueue).not.toHaveBeenCalled();
  });

  it('honest-degrade: a throwing four-eye port does not crash the tick', async () => {
    const fourEye: FourEyeEnqueuePort = {
      async enqueue() {
        throw new Error('four-eye sink down');
      },
    };
    const registry = makeRegistrySpy();
    const cron = createSelfExtensionCron(
      baseDeps({
        db: makeGapDb({ tenantId: 'tnt-1', gapCount: 12 }),
        fourEye,
        subMdRegistry: registry.port,
        thresholdEventCount: 10,
      }),
    );

    const result = await cron.tickOnce();
    // Diagnosed, but the enqueue failed gracefully → counted, not crashed.
    expect(result.diagnosed).toBe(1);
    expect(result.proposalsEnqueued).toBe(0);
    expect(result.errored).toBe(0);
    expect(registry.register).not.toHaveBeenCalled();
  });

  it('disabled cron: start() is a no-op (CI-inert)', () => {
    const cron = createSelfExtensionCron(baseDeps({ enabled: false }));
    // Should not throw and should not arm a timer (no observable effect).
    expect(() => cron.start()).not.toThrow();
    expect(() => cron.stop()).not.toThrow();
  });
});
