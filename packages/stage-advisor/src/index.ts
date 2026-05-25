/**
 * `@borjie/stage-advisor` — public surface.
 *
 * Stage-aware capability advisor. The platform knows what stage the
 * org is at (pre-launch → ecosystem) and proactively introduces
 * modules they need NOW, not too early, not too late.
 *
 * Composed of:
 *   - Stage taxonomy (7 named stages, each with a complete card)
 *   - Stage detection (units-managed primary + secondaries, hysteresis)
 *   - Transition watcher (narrative + capability deltas per move)
 *   - Capability gating (stage × role × jurisdiction → unlocked/hidden/previewable)
 *   - Stage onboarding playbooks (objectives + tasks + completion predicates)
 *   - Proactive nudge generator (idempotent over a lookback window)
 *   - Brain integration (wrap any advisor; conversation opener)
 *
 * The `createStageAdvisor` factory bundles everything into a single
 * object with batteries-included defaults. Callers that want fine-
 * grained control can also import the individual modules directly.
 */

// ─── Types ────────────────────────────────────────────────────────
export * from './types.js';

// ─── Stage taxonomy ───────────────────────────────────────────────
export {
  STAGE_CARDS,
  STAGE_ORDER,
  stagesUnlocking,
  firstStageUnlocking,
} from './stages/index.js';

// ─── Detection ────────────────────────────────────────────────────
export {
  detectStage,
  updateStageState,
  stageFromUnits,
  DEFAULT_SMOOTHING_DAYS,
  type DetectStageInput,
} from './detect/index.js';

// ─── Transitions ──────────────────────────────────────────────────
export { getTransition, isAdjacent } from './transitions/index.js';

// ─── Capability gating ────────────────────────────────────────────
export {
  gatedCapabilities,
  CAPABILITY_FLAG_KEYS,
} from './gating/index.js';

// ─── Playbooks ────────────────────────────────────────────────────
export {
  evaluatePlaybook,
  buildPlaybook,
  PRE_LAUNCH_PLAYBOOK,
  SEEDLING_PLAYBOOK,
  SPROUT_PLAYBOOK,
  SAPLING_PLAYBOOK,
  TREE_PLAYBOOK,
  FOREST_PLAYBOOK,
  ECOSYSTEM_PLAYBOOK,
  type EvaluatePlaybookInput,
  type PlaybookEvaluation,
  type PlaybookSeed,
  type TaskEvaluation,
} from './playbooks/index.js';

// ─── Nudges ───────────────────────────────────────────────────────
export {
  generateStageNudges,
  urgencyRank,
  DEFAULT_LOOKBACK_DAYS,
} from './nudges/index.js';

// ─── Brain integration ───────────────────────────────────────────
export {
  wrapAdvisorWithStageContext,
  seedConversationOpener,
  type AdvisorLike,
  type StageDetectorPort,
  type StageEnrichedResponse,
  type SeedConversationOpenerInput,
  type WrapAdvisorInput,
} from './brain-integration/index.js';

import { detectStage, updateStageState } from './detect/index.js';
import { generateStageNudges } from './nudges/index.js';
import { getTransition } from './transitions/index.js';
import { gatedCapabilities } from './gating/index.js';
import { evaluatePlaybook } from './playbooks/index.js';
import { STAGE_CARDS } from './stages/definitions.js';
import type {
  CapabilityGatingResult,
  DetectStageResult,
  NudgeDeliveryRecord,
  OrgMetrics,
  OrgStage,
  OrgState,
  PersistedStageState,
  StageAdvisorPort,
  StageCard,
  StageContext,
  StageNudge,
  StageRole,
  StageTransition,
  StageTriggerSink,
} from './types.js';
import type { PlaybookEvaluation } from './playbooks/index.js';

// ─── Stage advisor factory ───────────────────────────────────────

/**
 * Database port — every method is a thin wrapper over a Drizzle (or
 * any) read so the factory stays storage-agnostic. Callers in tests
 * usually pass in-memory implementations.
 */
export interface StageAdvisorDb {
  getMetrics(tenantId: string): Promise<OrgMetrics | null>;
  getOrgState(tenantId: string): Promise<OrgState | null>;
  getPersistedState(tenantId: string): Promise<PersistedStageState | null>;
  savePersistedState(state: PersistedStageState): Promise<void>;
  getNudgeHistory(
    tenantId: string,
  ): Promise<ReadonlyArray<NudgeDeliveryRecord>>;
  recordNudgeDelivery(args: {
    tenantId: string;
    record: NudgeDeliveryRecord;
  }): Promise<void>;
  /** Stored dismissals — a nudge in here is suppressed permanently. */
  isNudgeDismissed?(
    tenantId: string,
    nudgeId: string,
  ): Promise<boolean>;
  dismissNudge?(args: {
    tenantId: string;
    nudgeId: string;
  }): Promise<void>;
  /** Optional: the historical transitions for /v1/stage/history. */
  getTransitionHistory?(
    tenantId: string,
  ): Promise<ReadonlyArray<StageTransition>>;
  appendTransition?(args: {
    tenantId: string;
    transition: StageTransition;
  }): Promise<void>;
}

export interface CreateStageAdvisorInput {
  readonly db: StageAdvisorDb;
  readonly triggers?: StageTriggerSink;
}

export interface StageAdvisor {
  /** Cheap port-style call — returns the stage context only. */
  readonly port: StageAdvisorPort;
  /** Full detection round trip — runs + persists state. */
  detectAndPersist(args: {
    tenantId: string;
    nowIso?: string;
  }): Promise<{
    readonly detection: DetectStageResult;
    readonly state: PersistedStageState;
    readonly transition: StageTransition | null;
  }>;
  /** Get the current playbook + completion view for the active stage. */
  getPlaybookView(tenantId: string): Promise<{
    readonly stage: OrgStage;
    readonly card: StageCard;
    readonly evaluation: PlaybookEvaluation;
  } | null>;
  /** Get capability gating for a role at the org's current stage. */
  getGatingForRole(
    tenantId: string,
    role: StageRole,
    jurisdiction?: string,
  ): Promise<CapabilityGatingResult | null>;
  /** Generate (and optionally emit) the active nudges for an org. */
  generateNudges(args: {
    tenantId: string;
    lookbackDays?: number;
    nowIso?: string;
    /** When true, send each high-urgency nudge through the trigger sink. */
    emit?: boolean;
  }): Promise<ReadonlyArray<StageNudge>>;
  /** Dismiss a nudge so it won't fire again. */
  dismissNudge(args: { tenantId: string; nudgeId: string }): Promise<void>;
  /** Get historical transitions (most recent first). */
  getHistory(tenantId: string): Promise<ReadonlyArray<StageTransition>>;
}

export function createStageAdvisor(
  input: CreateStageAdvisorInput,
): StageAdvisor {
  const db = input.db;

  async function buildStageContext(
    tenantId: string,
  ): Promise<StageContext | null> {
    const metrics = await db.getMetrics(tenantId);
    if (!metrics) return null;
    const prev = await db.getPersistedState(tenantId);
    const detection = detectStage({
      metrics,
      previousState: prev ?? null,
    });
    const card = STAGE_CARDS[detection.stage];
    return {
      tenantId,
      stage: detection.stage,
      confidence: detection.confidence,
      evidence: detection.evidence,
      focusAreas: card.focusAreas,
      capabilitiesUnlocked: card.capabilitiesUnlocked,
    };
  }

  const port: StageAdvisorPort = {
    async getCurrentStage(tenantId: string) {
      return buildStageContext(tenantId);
    },
  };

  return {
    port,

    async detectAndPersist({ tenantId, nowIso }) {
      const metrics = await db.getMetrics(tenantId);
      if (!metrics) {
        throw new Error(
          `stage-advisor: cannot detectAndPersist — no metrics for tenant ${tenantId}`,
        );
      }
      const prev = await db.getPersistedState(tenantId);
      const detection = detectStage({
        metrics,
        previousState: prev ?? null,
      });
      const now = nowIso ?? metrics.observedAt;
      const state = updateStageState(prev ?? null, detection, now, tenantId);
      await db.savePersistedState(state);
      const transition =
        prev && prev.currentStage !== state.currentStage
          ? getTransition(prev.currentStage, state.currentStage)
          : null;
      if (transition && db.appendTransition) {
        await db.appendTransition({ tenantId, transition });
      }
      return { detection, state, transition };
    },

    async getPlaybookView(tenantId) {
      const metrics = await db.getMetrics(tenantId);
      if (!metrics) return null;
      const prev = await db.getPersistedState(tenantId);
      const detection = detectStage({
        metrics,
        previousState: prev ?? null,
      });
      const card = STAGE_CARDS[detection.stage];
      const orgState =
        (await db.getOrgState(tenantId)) ?? defaultOrgState(tenantId);
      const evaluation = evaluatePlaybook({
        playbook: card.stageOnboardingPlaybook,
        orgState,
      });
      return { stage: detection.stage, card, evaluation };
    },

    async getGatingForRole(tenantId, role, jurisdiction) {
      const metrics = await db.getMetrics(tenantId);
      if (!metrics) return null;
      const prev = await db.getPersistedState(tenantId);
      const detection = detectStage({
        metrics,
        previousState: prev ?? null,
      });
      const stage = detection.stage;
      // `exactOptionalPropertyTypes`: omit `jurisdiction` when undefined.
      return jurisdiction !== undefined
        ? gatedCapabilities({ stage, role, jurisdiction })
        : gatedCapabilities({ stage, role });
    },

    async generateNudges({ tenantId, lookbackDays, nowIso, emit }) {
      const metrics = await db.getMetrics(tenantId);
      if (!metrics) return [];
      const prev = await db.getPersistedState(tenantId);
      const detection = detectStage({
        metrics,
        previousState: prev ?? null,
      });
      const orgState =
        (await db.getOrgState(tenantId)) ?? defaultOrgState(tenantId);
      const history = await db.getNudgeHistory(tenantId);
      const nudges = generateStageNudges({
        orgState,
        metrics,
        detection,
        lastDeliveredAt: history,
        ...(lookbackDays !== undefined ? { lookbackDays } : {}),
        ...(nowIso !== undefined ? { nowIso } : {}),
      });
      // Filter out dismissed.
      const allowed: StageNudge[] = [];
      for (const n of nudges) {
        if (db.isNudgeDismissed) {
          const isDismissed = await db.isNudgeDismissed(tenantId, n.id);
          if (isDismissed) continue;
        }
        allowed.push(n);
      }
      if (emit) {
        for (const n of allowed) {
          if (n.urgency === 'high' || n.urgency === 'critical') {
            if (input.triggers) {
              await input.triggers.emit({
                tenantId,
                stage: detection.stage,
                nudge: n,
              });
            }
            await db.recordNudgeDelivery({
              tenantId,
              record: {
                nudgeId: n.id,
                deliveredAt: n.generatedAt,
              },
            });
          }
        }
      }
      return allowed;
    },

    async dismissNudge({ tenantId, nudgeId }) {
      if (db.dismissNudge) {
        await db.dismissNudge({ tenantId, nudgeId });
      }
    },

    async getHistory(tenantId) {
      if (db.getTransitionHistory) {
        return db.getTransitionHistory(tenantId);
      }
      return [];
    },
  };
}

/**
 * Sentinel org state with every counter at 0 — used when the db has
 * no row yet for a brand-new tenant. Keeps the playbook evaluator
 * happy without forcing every caller to provide an empty struct.
 */
export function defaultOrgState(tenantId: string): OrgState {
  return {
    tenantId,
    orgSetupComplete: false,
    propertyCount: 0,
    unitsManaged: 0,
    leaseCount: 0,
    paymentMethodsConfigured: 0,
    maintenanceCategoriesDefined: 0,
    scheduledInspectionsConfigured: 0,
    vendorCount: 0,
    inventoryLocationsCount: 0,
    rfqCount: 0,
    fleetVehicleCount: 0,
    reportCadenceCount: 0,
    regionsConfigured: 0,
    treasuryAccountCount: 0,
    jurisdictionsConfigured: 0,
  };
}

// In-memory db for tests / dev.
export function createInMemoryStageAdvisorDb(
  initial?: Partial<{
    metrics: Record<string, OrgMetrics>;
    orgStates: Record<string, OrgState>;
    persistedStates: Record<string, PersistedStageState>;
    nudgeHistory: Record<string, NudgeDeliveryRecord[]>;
    dismissed: Record<string, Set<string>>;
    transitions: Record<string, StageTransition[]>;
  }>,
): StageAdvisorDb {
  const metrics = new Map<string, OrgMetrics>(
    Object.entries(initial?.metrics ?? {}),
  );
  const orgStates = new Map<string, OrgState>(
    Object.entries(initial?.orgStates ?? {}),
  );
  const persistedStates = new Map<string, PersistedStageState>(
    Object.entries(initial?.persistedStates ?? {}),
  );
  const nudgeHistory = new Map<string, NudgeDeliveryRecord[]>(
    Object.entries(initial?.nudgeHistory ?? {}),
  );
  const dismissed = new Map<string, Set<string>>(
    Object.entries(initial?.dismissed ?? {}),
  );
  const transitions = new Map<string, StageTransition[]>(
    Object.entries(initial?.transitions ?? {}),
  );

  return {
    async getMetrics(tenantId) {
      return metrics.get(tenantId) ?? null;
    },
    async getOrgState(tenantId) {
      return orgStates.get(tenantId) ?? null;
    },
    async getPersistedState(tenantId) {
      return persistedStates.get(tenantId) ?? null;
    },
    async savePersistedState(state) {
      persistedStates.set(state.tenantId, state);
    },
    async getNudgeHistory(tenantId) {
      return nudgeHistory.get(tenantId) ?? [];
    },
    async recordNudgeDelivery({ tenantId, record }) {
      const list = nudgeHistory.get(tenantId) ?? [];
      nudgeHistory.set(tenantId, [...list, record]);
    },
    async isNudgeDismissed(tenantId, nudgeId) {
      return dismissed.get(tenantId)?.has(nudgeId) ?? false;
    },
    async dismissNudge({ tenantId, nudgeId }) {
      const set = dismissed.get(tenantId) ?? new Set<string>();
      set.add(nudgeId);
      dismissed.set(tenantId, set);
    },
    async getTransitionHistory(tenantId) {
      return transitions.get(tenantId) ?? [];
    },
    async appendTransition({ tenantId, transition }) {
      const list = transitions.get(tenantId) ?? [];
      transitions.set(tenantId, [transition, ...list]);
    },
  };
}
