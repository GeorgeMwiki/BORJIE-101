import { describe, expect, it } from 'vitest';
import {
  runNightlySweep,
  type SweepDeps,
  type CronOptions,
} from '../cron/nightly-aggregator-cron.js';
import {
  createAuditEmitter,
  createInMemoryChainStore,
} from '../audit/audit-emit.js';
import type {
  EvolutionProposal,
  FailingSignal,
  ProposedDiff,
  TabRecipeRow,
  TelemetryEvent,
} from '../types.js';
import type { LockCandidateLedger } from '../decisions/lock-decision.js';
import type { RecipeRepository } from '../storage/recipe-repository.js';
import type { ProposalRepository } from '../storage/proposal-repository.js';
import type { TelemetryRepository } from '../storage/telemetry-repository.js';
import type { NotificationSink } from '../approval/proposal-emitter.js';
import type { FormSchema } from '@borjie/dynamic-ui';

const OPTIONS: CronOptions = {
  shortWindowDays: 14,
  longWindowDays: 60,
  sustainDays: 30,
  concurrency: 2,
};

const SCHEMA: FormSchema = {
  title_en: 'Buyer KYB Start',
  title_sw: 'Mwanzo wa KYB ya Mnunuzi',
  groups: [
    {
      id: 'g1',
      title_en: 'Identity',
      title_sw: 'Utambulisho',
      fields: [
        {
          id: 'tin_number',
          kind: 'text',
          label_en: 'TIN',
          label_sw: 'TIN',
          required: true,
        },
      ],
    },
  ],
  submit_action: {
    form_id: 'buyer_kyb',
    url: '/api/gateway/forms/buyer_kyb',
    method: 'POST',
  },
  evidence_ids: ['TUMEMADINI-4.2'],
};

function recipe(over: Partial<TabRecipeRow> = {}): TabRecipeRow {
  return {
    id: over.id ?? 'buyer_kyb_start',
    version: over.version ?? 1,
    status: over.status ?? 'live',
    intent: over.intent ?? 'BuyerKYBStart',
    composeFnRef: over.composeFnRef ?? 'ref',
    authorityTier: 1,
    brand: 'borjie',
    promotedAtIso: null,
    promotedBy: null,
    lockedAtIso: null,
    createdAtIso: '2026-04-01T00:00:00.000Z',
    updatedAtIso: '2026-04-01T00:00:00.000Z',
    ...over,
  };
}

function event(over: Partial<TelemetryEvent>): TelemetryEvent {
  return {
    id: 'e-' + Math.random().toString(36).slice(2),
    tenantId: over.tenantId ?? 't1',
    tabRecipeId: over.tabRecipeId ?? 'buyer_kyb_start',
    tabRecipeVersion: over.tabRecipeVersion ?? 1,
    sessionId: over.sessionId ?? null,
    fieldId: over.fieldId ?? null,
    eventKind: over.eventKind ?? 'render',
    recordedAt: over.recordedAt ?? '2026-05-10T12:00:00.000Z',
  };
}

function recipeRepo(initial: ReadonlyArray<TabRecipeRow>): RecipeRepository & {
  rows: Map<string, TabRecipeRow>;
} {
  const rows = new Map<string, TabRecipeRow>();
  for (const r of initial) rows.set(`${r.id}:${r.version}`, r);
  return {
    rows,
    async listLive() {
      return [...rows.values()].filter((r) => r.status === 'live');
    },
    async findVersion(id, version) {
      return rows.get(`${id}:${version}`) ?? null;
    },
    async updateStatus({ id, version, nextStatus }) {
      const r = rows.get(`${id}:${version}`);
      if (!r) return;
      rows.set(`${id}:${version}`, { ...r, status: nextStatus });
    },
    async insertShadow({ id, version, intent, composeFnRef, authorityTier }) {
      rows.set(`${id}:${version}`, recipe({
        id,
        version,
        status: 'shadow',
        intent,
        composeFnRef,
        authorityTier,
      }));
    },
    async isLocked({ id, version }) {
      return rows.get(`${id}:${version}`)?.status === 'locked';
    },
  };
}

function telemetryRepo(events: ReadonlyArray<TelemetryEvent>): TelemetryRepository {
  return {
    async readEventsForRecipe({ tabRecipeId, tabRecipeVersion }) {
      return events.filter(
        (e) =>
          e.tabRecipeId === tabRecipeId &&
          e.tabRecipeVersion === tabRecipeVersion,
      );
    },
  };
}

function proposalRepo(): ProposalRepository & {
  inserted: EvolutionProposal[];
} {
  const inserted: EvolutionProposal[] = [];
  let nextId = 1;
  return {
    inserted,
    async insertPending(args) {
      const p: EvolutionProposal = {
        id: `p-${nextId++}`,
        tenantId: args.tenantId,
        tabRecipeId: args.tabRecipeId,
        currentVersion: args.currentVersion,
        proposedVersion: args.proposedVersion,
        proposedSchemaDiff: args.diff as ProposedDiff,
        signals: args.signals as ReadonlyArray<FailingSignal>,
        citations: args.citations,
        status: 'pending',
        proposedAtIso: new Date().toISOString(),
      };
      inserted.push(p);
      return p;
    },
    async hasPendingProposalFor() {
      return false;
    },
    async findById(id) {
      return inserted.find((p) => p.id === id) ?? null;
    },
    async updateStatus() {
      return undefined;
    },
  };
}

function inMemoryLedger(): LockCandidateLedger {
  const state = new Map<string, string>();
  return {
    async readFirstCandidateAt({ tabRecipeId, tabRecipeVersion }) {
      return state.get(`${tabRecipeId}:${tabRecipeVersion}`) ?? null;
    },
    async writeFirstCandidateAt({ tabRecipeId, tabRecipeVersion, atIso }) {
      const k = `${tabRecipeId}:${tabRecipeVersion}`;
      if (!state.has(k)) state.set(k, atIso);
    },
    async clearCandidacy({ tabRecipeId, tabRecipeVersion }) {
      state.delete(`${tabRecipeId}:${tabRecipeVersion}`);
    },
  };
}

function silentSink(): NotificationSink {
  return { async emit() { return undefined; } };
}

function buildDeps(over: {
  recipes: RecipeRepository;
  telemetry: TelemetryRepository;
  proposals: ProposalRepository;
  fetchTenants?: SweepDeps['fetchTenantsForRecipe'];
  fetchSchema?: SweepDeps['fetchCurrentSchema'];
  fetchCitations?: SweepDeps['fetchKnownCitations'];
}): SweepDeps {
  return {
    recipes: over.recipes,
    telemetry: over.telemetry,
    proposals: over.proposals,
    notifications: silentSink(),
    audit: createAuditEmitter({ store: createInMemoryChainStore() }),
    ledger: inMemoryLedger(),
    fetchCurrentSchema:
      over.fetchSchema ?? (async () => SCHEMA),
    fetchKnownCitations:
      over.fetchCitations ?? (async () => ['TUMEMADINI-4.2']),
    fetchTenantsForRecipe:
      over.fetchTenants ?? (async () => ['t1']),
    llm: { disabled: true },
  };
}

describe('runNightlySweep', () => {
  it('returns zero-result summary when no live recipes', async () => {
    const deps = buildDeps({
      recipes: recipeRepo([]),
      telemetry: telemetryRepo([]),
      proposals: proposalRepo(),
    });
    const summary = await runNightlySweep(deps, OPTIONS);
    expect(summary.recipesProcessed).toBe(0);
    expect(summary.proposalsEmitted).toBe(0);
  });

  it('emits a proposal when telemetry says improve_candidate', async () => {
    // 100 renders, 30 submits → completion 30% (< 50% threshold)
    const events: TelemetryEvent[] = [];
    for (let i = 0; i < 100; i += 1) {
      events.push(event({ eventKind: 'render', sessionId: `s${i}` }));
    }
    for (let i = 0; i < 30; i += 1) {
      events.push(event({ eventKind: 'submit', sessionId: `s${i}` }));
    }
    // Some focus events so we have a field record.
    for (let i = 0; i < 50; i += 1) {
      events.push(event({ eventKind: 'focus', fieldId: 'tin_number', sessionId: `s${i}` }));
    }
    const proposals = proposalRepo();
    const recipes = recipeRepo([recipe({ status: 'live' })]);
    const deps = buildDeps({
      recipes,
      telemetry: telemetryRepo(events),
      proposals,
    });
    const summary = await runNightlySweep(deps, OPTIONS);
    expect(summary.proposalsEmitted).toBeGreaterThanOrEqual(1);
    expect(proposals.inserted.length).toBeGreaterThanOrEqual(1);
  });

  it('marks the lock candidate the first time thresholds pass (no immediate lock)', async () => {
    const events: TelemetryEvent[] = [];
    // 100 renders / 90 submits → 90% completion (above 80% lock threshold)
    for (let i = 0; i < 100; i += 1) {
      events.push(event({ eventKind: 'render', sessionId: `s${i}` }));
    }
    for (let i = 0; i < 90; i += 1) {
      events.push(event({ eventKind: 'submit', sessionId: `s${i}` }));
    }
    // Single field with low error + low abandonment.
    for (let i = 0; i < 100; i += 1) {
      events.push(event({ eventKind: 'focus', fieldId: 'tin_number', sessionId: `s${i}` }));
    }
    const recipes = recipeRepo([recipe({ status: 'live' })]);
    const proposals = proposalRepo();
    const summary = await runNightlySweep(
      buildDeps({
        recipes,
        telemetry: telemetryRepo(events),
        proposals,
      }),
      OPTIONS,
    );
    // First time → mark candidacy, not lock.
    expect(summary.locksApplied).toBe(0);
    expect(proposals.inserted.length).toBe(0); // lock candidates don't get proposals
  });

  it('does not propose when the recipe is locked', async () => {
    const events: TelemetryEvent[] = [];
    for (let i = 0; i < 100; i += 1) {
      events.push(event({ eventKind: 'render', sessionId: `s${i}` }));
    }
    for (let i = 0; i < 30; i += 1) {
      events.push(event({ eventKind: 'submit', sessionId: `s${i}` }));
    }
    const recipes = recipeRepo([recipe({ status: 'locked' })]);
    const proposals = proposalRepo();
    const summary = await runNightlySweep(
      buildDeps({
        recipes,
        telemetry: telemetryRepo(events),
        proposals,
      }),
      OPTIONS,
    );
    // listLive() filters out locked recipes, so it's never processed.
    expect(summary.recipesProcessed).toBe(0);
    expect(proposals.inserted).toHaveLength(0);
  });

  it('handles failing telemetry reads with status=error per recipe', async () => {
    const recipes = recipeRepo([recipe({ status: 'live' })]);
    const failingTelemetry: TelemetryRepository = {
      async readEventsForRecipe() {
        throw new Error('boom');
      },
    };
    const deps = buildDeps({
      recipes,
      telemetry: failingTelemetry,
      proposals: proposalRepo(),
    });
    const summary = await runNightlySweep(deps, OPTIONS);
    expect(summary.errored).toBeGreaterThanOrEqual(1);
    expect(summary.results[0]?.status).toBe('error');
  });
});
