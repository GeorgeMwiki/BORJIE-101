import { describe, expect, it } from 'vitest';
import {
  approveProposal,
  applyLock,
  markLockCandidate,
  rejectProposal,
} from '../approval/promotion.js';
import {
  createAuditEmitter,
  createInMemoryChainStore,
} from '../audit/audit-emit.js';
import type {
  EvolutionProposal,
  ProposedDiff,
  TabRecipeRow,
  TabRecipeStatus,
} from '../types.js';
import type { RecipeRepository } from '../storage/recipe-repository.js';
import type { ProposalRepository } from '../storage/proposal-repository.js';

/* -------------------------------------------------------------------------
 * In-memory recipe + proposal stores — let us assert the state machine
 * outcomes without a database.
 * ------------------------------------------------------------------------- */

interface RecipeStoreState {
  rows: Map<string, TabRecipeRow>; // key = `${id}:${version}`
}

function key(id: string, version: number): string {
  return `${id}:${version}`;
}

function makeRecipe(over: Partial<TabRecipeRow>): TabRecipeRow {
  return {
    id: over.id ?? 'buyer_kyb_start',
    version: over.version ?? 1,
    status: over.status ?? 'live',
    intent: over.intent ?? 'BuyerKYBStart',
    composeFnRef: over.composeFnRef ?? '@borjie/dynamic-ui/recipes/buyer-kyb-start',
    authorityTier: over.authorityTier ?? 1,
    brand: 'borjie',
    promotedAtIso: over.promotedAtIso ?? null,
    promotedBy: over.promotedBy ?? null,
    lockedAtIso: over.lockedAtIso ?? null,
    createdAtIso: over.createdAtIso ?? '2026-04-01T00:00:00.000Z',
    updatedAtIso: over.updatedAtIso ?? '2026-04-01T00:00:00.000Z',
  };
}

function inMemoryRecipeRepo(initial: ReadonlyArray<TabRecipeRow>): RecipeRepository & {
  readonly state: RecipeStoreState;
} {
  const state: RecipeStoreState = { rows: new Map() };
  for (const row of initial) state.rows.set(key(row.id, row.version), row);
  return {
    state,
    async listLive() {
      return [...state.rows.values()].filter((r) => r.status === 'live');
    },
    async findVersion(id, version) {
      return state.rows.get(key(id, version)) ?? null;
    },
    async updateStatus({ id, version, nextStatus, promotedBy, lockedAtIso }) {
      const k = key(id, version);
      const row = state.rows.get(k);
      if (!row) throw new Error(`recipe ${id} v${version} not found`);
      const nowIso = new Date().toISOString();
      const updated: TabRecipeRow = {
        ...row,
        status: nextStatus as TabRecipeStatus,
        promotedAtIso: nextStatus === 'live' ? nowIso : row.promotedAtIso,
        promotedBy: nextStatus === 'live' ? (promotedBy ?? row.promotedBy) : row.promotedBy,
        lockedAtIso:
          nextStatus === 'locked'
            ? lockedAtIso ?? nowIso
            : row.lockedAtIso,
        updatedAtIso: nowIso,
      };
      state.rows.set(k, updated);
    },
    async insertShadow({ id, version, intent, composeFnRef, authorityTier }) {
      const k = key(id, version);
      state.rows.set(k, makeRecipe({
        id,
        version,
        status: 'shadow',
        intent,
        composeFnRef,
        authorityTier,
      }));
    },
    async isLocked({ id, version }) {
      return state.rows.get(key(id, version))?.status === 'locked';
    },
  };
}

interface ProposalStoreState {
  rows: Map<string, EvolutionProposal>;
}

function makeProposal(over: Partial<EvolutionProposal>): EvolutionProposal {
  const diff: ProposedDiff = {
    ops: [
      {
        op: 'rename_label',
        fieldId: 'tin_number',
        labelEnBefore: 'TIN',
        labelEnAfter: 'Tax ID',
        labelSwBefore: 'TIN',
        labelSwAfter: 'Kitambulisho cha Kodi',
      },
    ],
    rationaleEn: 'Operators stumble on the TIN label.',
    rationaleSw: 'Watumiaji wana shida na lebo ya TIN.',
  };
  return {
    id: over.id ?? 'prop-1',
    tenantId: over.tenantId ?? 't1',
    tabRecipeId: over.tabRecipeId ?? 'buyer_kyb_start',
    currentVersion: over.currentVersion ?? 1,
    proposedVersion: over.proposedVersion ?? 2,
    proposedSchemaDiff: over.proposedSchemaDiff ?? diff,
    signals: over.signals ?? [],
    citations: over.citations ?? ['TUMEMADINI-4.2'],
    status: over.status ?? 'pending',
    proposedAtIso: over.proposedAtIso ?? '2026-05-10T02:00:00.000Z',
  };
}

function inMemoryProposalRepo(initial: ReadonlyArray<EvolutionProposal>): ProposalRepository & {
  readonly state: ProposalStoreState;
} {
  const state: ProposalStoreState = { rows: new Map() };
  for (const p of initial) state.rows.set(p.id, p);
  return {
    state,
    async insertPending(args) {
      const p = makeProposal({
        id: `prop-${state.rows.size + 1}`,
        tenantId: args.tenantId,
        tabRecipeId: args.tabRecipeId,
        currentVersion: args.currentVersion,
        proposedVersion: args.proposedVersion,
        proposedSchemaDiff: args.diff,
        signals: args.signals,
        citations: args.citations,
        status: 'pending',
      });
      state.rows.set(p.id, p);
      return p;
    },
    async hasPendingProposalFor({ tenantId, tabRecipeId, currentVersion }) {
      for (const p of state.rows.values()) {
        if (
          p.tenantId === tenantId &&
          p.tabRecipeId === tabRecipeId &&
          p.currentVersion === currentVersion &&
          p.status === 'pending'
        )
          return true;
      }
      return false;
    },
    async findById(id) {
      return state.rows.get(id) ?? null;
    },
    async updateStatus({ id, nextStatus, reviewedBy, reviewerReason, rolloutStrategy, approvalAuditHash }) {
      const p = state.rows.get(id);
      if (!p) throw new Error(`proposal ${id} not found`);
      const updated: EvolutionProposal = {
        ...p,
        status: nextStatus,
        ...(reviewedBy ? { reviewedBy } : {}),
        ...(reviewerReason ? { reviewerReason } : {}),
        ...(rolloutStrategy ? { rolloutStrategy } : {}),
        ...(approvalAuditHash ? { approvalAuditHash } : {}),
        reviewedAtIso: new Date().toISOString(),
      };
      state.rows.set(id, updated);
    },
  };
}

/* -------------------------------------------------------------------------
 * Tests
 * ------------------------------------------------------------------------- */

describe('promotion state machine', () => {
  it('exposes five recipe states (draft / shadow / live / locked / deprecated)', () => {
    const allStates: ReadonlyArray<TabRecipeStatus> = [
      'draft',
      'shadow',
      'live',
      'locked',
      'deprecated',
    ];
    expect(allStates).toHaveLength(5);
  });

  it('approveProposal promotes v2 to live AND deprecates v1', async () => {
    const v1 = makeRecipe({ version: 1, status: 'live' });
    const v2Shadow = makeRecipe({ version: 2, status: 'shadow' });
    const recipes = inMemoryRecipeRepo([v1, v2Shadow]);
    const proposals = inMemoryProposalRepo([
      makeProposal({ id: 'p1', currentVersion: 1, proposedVersion: 2 }),
    ]);
    const audit = createAuditEmitter({ store: createInMemoryChainStore() });
    const proposal = await proposals.findById('p1');
    expect(proposal).not.toBeNull();

    const outcome = await approveProposal({
      proposal: proposal!,
      currentRecipe: v1,
      reviewerId: 'owner-user-id',
      rolloutStrategy: 'gradual',
      recipeRepository: recipes,
      proposalRepository: proposals,
      auditEmitter: audit,
    });

    expect(outcome.tabRecipeId).toBe('buyer_kyb_start');
    expect(outcome.oldVersion).toBe(1);
    expect(outcome.newVersion).toBe(2);
    expect(outcome.auditHash).toMatch(/^[a-f0-9]{64}$/);

    // v1 must now be deprecated (NOT deleted).
    const v1After = recipes.state.rows.get(key('buyer_kyb_start', 1));
    expect(v1After).toBeDefined();
    expect(v1After?.status).toBe('deprecated');

    // v2 must be live.
    const v2After = recipes.state.rows.get(key('buyer_kyb_start', 2));
    expect(v2After?.status).toBe('live');

    // Proposal is approved.
    const pAfter = await proposals.findById('p1');
    expect(pAfter?.status).toBe('approved');
    expect(pAfter?.approvalAuditHash).toBeDefined();
    expect(pAfter?.rolloutStrategy).toBe('gradual');
  });

  it('approveProposal self-heals when the shadow row is missing', async () => {
    const v1 = makeRecipe({ version: 1, status: 'live' });
    const recipes = inMemoryRecipeRepo([v1]); // NO shadow row
    const proposals = inMemoryProposalRepo([
      makeProposal({ id: 'p1', currentVersion: 1, proposedVersion: 2 }),
    ]);
    const audit = createAuditEmitter({ store: createInMemoryChainStore() });
    const p = (await proposals.findById('p1'))!;
    const outcome = await approveProposal({
      proposal: p,
      currentRecipe: v1,
      reviewerId: 'owner-user-id',
      rolloutStrategy: 'full',
      recipeRepository: recipes,
      proposalRepository: proposals,
      auditEmitter: audit,
    });
    expect(outcome.newVersion).toBe(2);
    const v2After = recipes.state.rows.get(key('buyer_kyb_start', 2));
    expect(v2After?.status).toBe('live');
  });

  it('refuses to approve over a locked recipe', async () => {
    const v1Locked = makeRecipe({ version: 1, status: 'locked' });
    const recipes = inMemoryRecipeRepo([v1Locked]);
    const proposals = inMemoryProposalRepo([
      makeProposal({ id: 'p1', currentVersion: 1, proposedVersion: 2 }),
    ]);
    const audit = createAuditEmitter({ store: createInMemoryChainStore() });
    const p = (await proposals.findById('p1'))!;
    await expect(
      approveProposal({
        proposal: p,
        currentRecipe: v1Locked,
        reviewerId: 'owner',
        rolloutStrategy: 'gradual',
        recipeRepository: recipes,
        proposalRepository: proposals,
        auditEmitter: audit,
      }),
    ).rejects.toThrow(/locked/);
  });

  it('applyLock flips live → locked and writes audit', async () => {
    const v1 = makeRecipe({ version: 1, status: 'live' });
    const recipes = inMemoryRecipeRepo([v1]);
    const auditStore = createInMemoryChainStore();
    const audit = createAuditEmitter({ store: auditStore });
    const outcome = await applyLock({
      recipe: v1,
      recipeRepository: recipes,
      auditEmitter: audit,
      reason: 'sustained 30 days',
    });
    expect(outcome.newStatus).toBe('locked');
    expect(recipes.state.rows.get(key('buyer_kyb_start', 1))?.status).toBe(
      'locked',
    );
    // Audit chain has at least one entry.
    let total = 0;
    for (const v of auditStore.entries.values()) total += v.length;
    expect(total).toBeGreaterThanOrEqual(1);
  });

  it('applyLock refuses if not currently live', async () => {
    const v1 = makeRecipe({ version: 1, status: 'shadow' });
    const recipes = inMemoryRecipeRepo([v1]);
    const audit = createAuditEmitter({ store: createInMemoryChainStore() });
    await expect(
      applyLock({
        recipe: v1,
        recipeRepository: recipes,
        auditEmitter: audit,
        reason: 'nope',
      }),
    ).rejects.toThrow(/live/);
  });

  it('rejectProposal closes the proposal without touching recipes', async () => {
    const v1 = makeRecipe({ version: 1, status: 'live' });
    const recipes = inMemoryRecipeRepo([v1]);
    const proposals = inMemoryProposalRepo([
      makeProposal({ id: 'p1', currentVersion: 1, proposedVersion: 2 }),
    ]);
    const audit = createAuditEmitter({ store: createInMemoryChainStore() });
    const p = (await proposals.findById('p1'))!;
    const hash = await rejectProposal({
      proposal: p,
      reviewerId: 'owner',
      reviewerReason: 'Brand collision — defer for redesign.',
      proposalRepository: proposals,
      auditEmitter: audit,
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect((await proposals.findById('p1'))?.status).toBe('rejected');
    expect(recipes.state.rows.get(key('buyer_kyb_start', 1))?.status).toBe(
      'live',
    );
  });

  it('markLockCandidate writes audit but does not change recipe status', async () => {
    const v1 = makeRecipe({ version: 1, status: 'live' });
    const auditStore = createInMemoryChainStore();
    const audit = createAuditEmitter({ store: auditStore });
    const recipes = inMemoryRecipeRepo([v1]);
    const hash = await markLockCandidate({
      recipe: v1,
      auditEmitter: audit,
      reason: '14d sustained',
    });
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(recipes.state.rows.get(key('buyer_kyb_start', 1))?.status).toBe(
      'live',
    );
  });

  it('audit chain entries link prev → cur correctly', async () => {
    const v1 = makeRecipe({ version: 1, status: 'live' });
    const auditStore = createInMemoryChainStore();
    const audit = createAuditEmitter({ store: auditStore });
    const recipes = inMemoryRecipeRepo([v1]);
    const proposals = inMemoryProposalRepo([
      makeProposal({ id: 'p1', currentVersion: 1, proposedVersion: 2 }),
    ]);

    await markLockCandidate({
      recipe: v1,
      auditEmitter: audit,
      reason: 'first marker',
    });
    const p = (await proposals.findById('p1'))!;
    await rejectProposal({
      proposal: p,
      reviewerId: 'owner',
      reviewerReason: 'No.',
      proposalRepository: proposals,
      auditEmitter: audit,
    });

    // Two chains expected: one global (mark_lock_candidate), one
    // tenant-scoped (proposal.rejected for tenant t1).
    const chains = [...auditStore.entries.keys()].sort();
    expect(chains).toContain('global');
    expect(chains).toContain('tenant:t1');

    const globalChain = auditStore.entries.get('global') ?? [];
    expect(globalChain.length).toBeGreaterThanOrEqual(1);
    expect(globalChain[0]?.prevHash).toBe('GENESIS');
  });
});
