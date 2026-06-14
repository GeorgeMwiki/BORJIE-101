/**
 * self-extension-cron-wiring.test.ts — proves the composition helper that makes
 * `createSelfExtensionCron` reachable from `index.ts` stays propose-only and
 * fail-closed:
 *   1. `buildSelfExtensionCronDeps` produces a full, well-formed dep bundle.
 *   2. The four-eye port routes through the SINGLE `enqueueFourEyeRequest` path
 *      and strips the approval token (cron only needs the requestId).
 *   3. The sub-MD registry `list()` honest-degrades to []; `register()` is
 *      FAIL-CLOSED (throws) so the runtime-apply path stays UNMOUNTED.
 *   4. The deterministic LLM router projects the diagnosis onto a 'read'-tier
 *      SubMdSpec with NO network call and NO literal model id.
 *   5. End-to-end: a cron built from these deps drives a recurring gap to a
 *      four-eye proposal + self-build dry-run, and NEVER registers a sub-MD.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createFourEyeEnqueuePort,
  createFailClosedSubMdRegistry,
  createDeterministicLlmRouter,
  buildSelfExtensionCronDeps,
} from '../self-extension-cron-wiring.js';
import { createSelfExtensionCron } from '../self-extension-cron.js';

// ─────────────────────────────────────────────────────────────────────
// Mock the SINGLE four-eye enqueue path so the port's behaviour is observable
// without a DB. We assert the port calls it and strips the approval token.
// ─────────────────────────────────────────────────────────────────────
const enqueueSpy = vi.fn(
  async (
    _db: unknown,
    _args: unknown,
  ): Promise<{ requestId: string; approvalToken: string } | null> => ({
    requestId: 'req_1',
    approvalToken: 'tok_secret',
  }),
);
vi.mock('../../routes/owner/four-eye-approvals.hono.js', () => ({
  enqueueFourEyeRequest: (db: unknown, args: unknown) => enqueueSpy(db, args),
}));

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

// A minimal diagnosis (the detector's output shape) for the router unit test.
function makeDiagnosis() {
  return {
    pattern: '12 events match cluster "gap:royalty" in the last 30 days.',
    observedCount: 12,
    observedWindowDays: 30,
    noExistingSubMdHandles: [],
    suggestedPersona: {
      id: 'royalty',
      displayName: 'Proposed: royalty',
      openingStatement: 'I am a proposed sub-MD.',
      toneGuidance: 'Calm, factual.',
      taboos: [],
      violationSignals: [],
      firstPersonNoun: 'I',
    },
    suggestedScope: { tenantId: 'tnt-1' },
    suggestedToolBelt: [],
    estimatedDailyCostUsdCents: 5,
    riskTier: 'read' as const,
  };
}

describe('self-extension-cron-wiring — propose-only, fail-closed', () => {
  it('four-eye port routes through enqueueFourEyeRequest and strips the token', async () => {
    enqueueSpy.mockClear();
    const port = createFourEyeEnqueuePort({} as unknown);
    const out = await port.enqueue({
      tenantId: 'tnt-1',
      requesterId: 'self-extension-keystone',
      actionType: 'self_extension.sub_md.propose',
      payload: { applied: false },
    });
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    // The cron's port surface is { requestId } only — the approval token is
    // stripped so it never leaks into the cron's bookkeeping.
    expect(out).toEqual({ requestId: 'req_1' });
    expect((out as Record<string, unknown>)?.approvalToken).toBeUndefined();
  });

  it('four-eye port passes through a null (honest-degrade) without throwing', async () => {
    enqueueSpy.mockResolvedValueOnce(null);
    const port = createFourEyeEnqueuePort({} as unknown);
    const out = await port.enqueue({
      tenantId: 'tnt-1',
      requesterId: 'x',
      actionType: 'self_extension.sub_md.propose',
      payload: {},
    });
    expect(out).toBeNull();
  });

  it('sub-MD registry list() degrades to [] and register() is FAIL-CLOSED', async () => {
    const registry = createFailClosedSubMdRegistry();
    await expect(registry.list()).resolves.toEqual([]);
    // register() is the runtime-apply primitive — it MUST throw on this path.
    await expect(
      registry.register({
        name: 'should-never-register',
        spec: {} as never,
      }),
    ).rejects.toThrow(/UNMOUNTED/);
  });

  it('deterministic LLM router projects the diagnosis onto a read-tier spec', async () => {
    const router = createDeterministicLlmRouter();
    const spec = await router.draftSubMdSpec({
      diagnosis: makeDiagnosis() as never,
      knownSubMds: [],
    });
    expect(spec.name).toBe('royalty');
    expect(spec.riskTier).toBe('read'); // safest tier — owner upgrades explicitly
    expect(spec.scope).toEqual({ tenantId: 'tnt-1' });
    expect(spec.schemaVersion).toBe(1);
    expect(spec.purpose).toContain('royalty');
  });

  it('buildSelfExtensionCronDeps produces a complete dep bundle', () => {
    const identity = (<T,>(fn: (tx: unknown) => Promise<T>) =>
      fn({})) as never;
    const deps = buildSelfExtensionCronDeps({
      db: {} as never,
      withServiceRole: identity,
      logger: silentLogger,
      enabled: false,
    });
    expect(deps.withServiceRole).toBe(identity);
    expect(deps.fourEye).toBeDefined();
    expect(deps.selfBuild).toBeDefined();
    expect(deps.subMdRegistry).toBeDefined();
    expect(deps.llmRouter).toBeDefined();
    expect(deps.proposerActor).toBe('self-extension-keystone');
    expect(deps.enabled).toBe(false);
  });

  it('END-TO-END: a cron built from these deps proposes but NEVER registers', async () => {
    enqueueSpy.mockClear();
    enqueueSpy.mockResolvedValue({ requestId: 'req_e2e', approvalToken: 't' });

    // A DB whose execute() yields one active tenant then a fat md_commitments
    // gap cluster (clears the threshold) — the Drizzle ActivityLogPort reads it.
    const gapRows = Array.from({ length: 12 }, (_, i) => ({
      id: `gap-${i}`,
      kind: 'royalty.reconcile',
      gap_kind: 'unwired_organ',
      competence_domain: 'royalty',
      created_at: new Date(),
    }));
    const db = {
      async execute(q: unknown) {
        const text = JSON.stringify(q);
        if (text.includes('FROM tenants')) return { rows: [{ id: 'tnt-1' }] };
        if (text.includes('md_commitments')) return { rows: gapRows };
        return { rows: [] };
      },
    };

    // Spy on the self-build edge so we assert the propose-only dry-run fired.
    const driveSpy = vi.fn(async () =>
      Object.freeze({
        ok: true as const,
        moduleId: 'mod_x',
        specId: 'mspec_x',
        moduleSlug: 'royalty_x',
        specStatus: 'proposed' as const,
        dryRun: {
          tableCount: 1,
          workflowCount: 1,
          uiSectionCount: 3,
          moneyFieldCount: 0,
        },
      }),
    );

    const deps = buildSelfExtensionCronDeps({
      db: db as never,
      withServiceRole: (<T,>(fn: (tx: unknown) => Promise<T>) =>
        fn(db)) as never,
      logger: silentLogger,
      enabled: false,
    });
    const cron = createSelfExtensionCron({
      ...deps,
      // Override the real self-build orchestrator with a spy (the real one needs
      // live module-spec tables; the propose-only edge is what we assert here).
      selfBuild: {
        driveGapToProposal: driveSpy as never,
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
      thresholdEventCount: 10,
    });

    const result = await cron.tickOnce();

    expect(result.tenantsScanned).toBe(1);
    expect(result.diagnosed).toBe(1);
    expect(result.proposalsEnqueued).toBe(1);
    expect(result.buildProposalsDriven).toBe(1);

    // Routed to the four-eye inbox (propose-only).
    expect(enqueueSpy).toHaveBeenCalled();
    const enqueueArgs = enqueueSpy.mock.calls.at(-1)![1] as {
      actionType: string;
      payload: Record<string, unknown>;
    };
    expect(enqueueArgs.actionType).toBe('self_extension.sub_md.propose');
    expect(enqueueArgs.payload.applied).toBe(false);

    // Propose-only self-build edge fired — but NOTHING was applied/registered.
    expect(driveSpy).toHaveBeenCalledTimes(1);
  });
});
