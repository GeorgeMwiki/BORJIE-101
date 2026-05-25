/**
 * NewHeadTourService — stateful lifecycle for the onboarding tour.
 *
 *   startTour(tenantId, userId, payload) → TourState
 *   advanceStep(tenantId, id, stepId, outcome) → TourResult
 *   completeTour(tenantId, id) → TourResult
 *   getTour(tenantId, userId) → TourState | null
 *
 * The service persists one state row per (tenant, newHeadUserId). Resume
 * returns the existing state; restart (explicit) clears it. Steps may be
 * skipped only when `optional: true` — attempts to skip a required step
 * throw so the UI can route the user back.
 */

import { buildInitialSteps, composeTour } from './tour-composer.js';
import type { TourComposerInputs } from './tour-composer.js';
import type {
  TourRepository,
  TourResult,
  TourState,
  TourStep,
  TourStepId,
} from './types.js';
import { TOUR_STEP_ORDER } from './types.js';

export type AdvanceOutcome = 'viewed' | 'skipped' | 'completed';

export interface NewHeadTourServiceDeps {
  readonly repository: TourRepository;
  readonly clock?: () => Date;
  readonly idFactory?: () => string;
}

export class NewHeadTourService {
  private readonly deps: NewHeadTourServiceDeps;

  constructor(deps: NewHeadTourServiceDeps) {
    this.deps = deps;
  }

  async startTour(
    tenantId: string,
    newHeadUserId: string,
    composerInputs: TourComposerInputs,
  ): Promise<TourState> {
    const existing = await this.deps.repository.findByHead(tenantId, newHeadUserId);
    if (existing && !existing.completedAt) return existing;

    const now = this.deps.clock?.() ?? new Date();
    const id = this.deps.idFactory?.() ?? `tour_${now.getTime()}_${randomSuffix()}`;
    const steps = buildInitialSteps();
    const state: TourState = {
      id,
      tenantId,
      newHeadUserId,
      steps,
      currentStepId: TOUR_STEP_ORDER[0],
      payload: composeTour(composerInputs),
      startedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      completedAt: null,
    };
    return this.deps.repository.insert(state);
  }

  async getTour(tenantId: string, userId: string): Promise<TourState | null> {
    return this.deps.repository.findByHead(tenantId, userId);
  }

  async advanceStep(
    tenantId: string,
    tourId: string,
    stepId: TourStepId,
    outcome: AdvanceOutcome,
  ): Promise<TourResult> {
    const existing = await this.requireOpen(tenantId, tourId);
    const stepIdx = existing.steps.findIndex((s) => s.id === stepId);
    if (stepIdx < 0) {
      throw new Error(`advanceStep(): unknown step ${stepId}`);
    }
    const step = existing.steps[stepIdx];
    if (outcome === 'skipped' && !step.optional) {
      throw new Error(`advanceStep(): step ${stepId} is required — cannot skip`);
    }

    const now = this.deps.clock?.() ?? new Date();
    const nextSteps: TourStep[] = existing.steps.map((s, i) => {
      if (i !== stepIdx) return s;
      const status = outcome === 'completed' ? 'completed' : outcome === 'skipped' ? 'skipped' : 'viewed';
      return { ...s, status };
    });
    // Determine the next pending step (wrap forward from the one just touched).
    let next: TourStepId | null = null;
    for (let i = stepIdx + 1; i < nextSteps.length; i++) {
      if (nextSteps[i].status === 'pending') {
        next = nextSteps[i].id;
        break;
      }
    }
    if (!next) {
      // No pending step after idx — scan from top to catch earlier skipped-but-pending.
      for (let i = 0; i < nextSteps.length; i++) {
        if (nextSteps[i].status === 'pending') {
          next = nextSteps[i].id;
          break;
        }
      }
    }
    const allTerminal = nextSteps.every(
      (s) => s.status === 'completed' || s.status === 'skipped' || s.status === 'viewed',
    );
    const completedAt = allTerminal ? now.toISOString() : null;
    const updated = await this.deps.repository.update(tenantId, tourId, {
      steps: nextSteps,
      currentStepId: allTerminal ? null : next,
      updatedAt: now.toISOString(),
      completedAt,
    });
    return {
      state: updated,
      outcome: allTerminal ? 'completed' : 'in_progress',
      nextStepId: allTerminal ? null : next,
    };
  }

  async completeTour(tenantId: string, tourId: string): Promise<TourResult> {
    const existing = await this.requireOpen(tenantId, tourId);
    const now = this.deps.clock?.() ?? new Date();
    const steps: TourStep[] = existing.steps.map((s) =>
      s.status === 'pending' ? { ...s, status: s.optional ? 'skipped' : 'completed' } : s,
    );
    const updated = await this.deps.repository.update(tenantId, tourId, {
      steps,
      currentStepId: null,
      updatedAt: now.toISOString(),
      completedAt: now.toISOString(),
    });
    return { state: updated, outcome: 'completed', nextStepId: null };
  }

  private async requireOpen(tenantId: string, tourId: string): Promise<TourState> {
    const existing = await this.findById(tenantId, tourId);
    if (!existing) throw new Error(`Tour ${tourId} not found`);
    if (existing.completedAt) throw new Error(`Tour ${tourId} already completed`);
    return existing;
  }

  private async findById(tenantId: string, tourId: string): Promise<TourState | null> {
    // The repo's primary lookup is by head; scan via the helper below.
    // Postgres binding overrides this with a proper primary-key query.
    const repoWithFind = this.deps.repository as TourRepository & {
      findById?: (tenantId: string, id: string) => Promise<TourState | null>;
    };
    if (typeof repoWithFind.findById === 'function') {
      return repoWithFind.findById(tenantId, tourId);
    }
    // InMemory fallback: force a findByHead via a scan. Callers know their
    // own userId, so we skip that path — the in-memory repo below exposes
    // findById for tests.
    throw new Error('Repository does not implement findById(tenantId, id)');
  }
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------------
// In-memory repository for tests + degraded mode.
// ---------------------------------------------------------------------------

export class InMemoryTourRepository implements TourRepository {
  private readonly store = new Map<string, TourState>();

  async insert(state: TourState): Promise<TourState> {
    this.store.set(key(state.tenantId, state.id), state);
    return state;
  }

  async findByHead(tenantId: string, userId: string): Promise<TourState | null> {
    for (const v of this.store.values()) {
      if (v.tenantId === tenantId && v.newHeadUserId === userId) return v;
    }
    return null;
  }

  async findById(tenantId: string, id: string): Promise<TourState | null> {
    return this.store.get(key(tenantId, id)) ?? null;
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<TourState>,
  ): Promise<TourState> {
    const existing = this.store.get(key(tenantId, id));
    if (!existing) throw new Error(`Tour ${id} not found`);
    const next: TourState = { ...existing, ...patch };
    this.store.set(key(tenantId, id), next);
    return next;
  }
}

function key(tenantId: string, id: string): string {
  return `${tenantId}::${id}`;
}
