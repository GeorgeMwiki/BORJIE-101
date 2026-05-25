/**
 * Public types for `@borjie/stage-advisor`.
 *
 * The stage advisor models the org's lifecycle as a series of named
 * stages (`pre-launch` through `ecosystem`) keyed primarily off units
 * managed. Every stage has:
 *
 *   - a set of `focusAreas` the org should be solving for right now
 *   - a `capabilitiesUnlocked` allow-list (visible + functional in UI)
 *   - a `capabilitiesHidden` deny-list (not shown — avoid overwhelm)
 *   - a `recommendedTabs` ordering for the dashboard
 *   - a `recommendedReports` cadence
 *   - a `recommendedAdvisors` short-list (which sub-advisors to surface)
 *   - a `stageOnboardingPlaybook` of 3-5 objectives + tasks per stage
 *
 * Pure type module — no runtime. Every type is `readonly` end-to-end
 * so consumers cannot mutate stage definitions after they're produced.
 */

// ─────────────────────────────────────────────────────────────────────
// Stage taxonomy
// ─────────────────────────────────────────────────────────────────────

export const ORG_STAGES = [
  'pre-launch',
  'seedling',
  'sprout',
  'sapling',
  'tree',
  'forest',
  'ecosystem',
] as const;

export type OrgStage = (typeof ORG_STAGES)[number];

/**
 * Coarse role bucket — matches `role-aware-advisor` exactly so callers
 * can pass through the same role they already have. Kept as a string
 * literal union to avoid a runtime dep on role-aware-advisor here.
 */
export const STAGE_ROLES = [
  'admin',
  'property-manager',
  'estate-manager',
  'owner',
  'tenant',
  'prospect',
  'service-provider',
] as const;

export type StageRole = (typeof STAGE_ROLES)[number];

/**
 * The closed set of capability ids the advisor reasons about. New
 * capabilities MUST be added here AND to each stage's unlocked/hidden
 * list — silently widening a stage card is a UX regression (we'd start
 * exposing complex modules to seedling-stage orgs).
 *
 * Each id should also map to a feature-flag key when one exists; we
 * keep the names ASCII-friendly so they can be reused verbatim as
 * flag keys (lowercase + hyphens).
 */
export const CAPABILITY_IDS = [
  'org-setup',
  'first-property',
  'lease-lifecycle',
  'payment-basics',
  'communications',
  'maintenance-taxonomy',
  'scheduled-inspections',
  'basic-reporting',
  'procurement-coordination',
  'inventory-management',
  'vendor-management',
  'fleet-management',
  'advanced-reporting',
  'dedicated-pm-teams',
  'regional-ops',
  'treasury',
  'expansion-planning',
  'multi-jurisdiction',
  'ir-aor-reports',
  'enterprise-stack',
  'ops-command',
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

// ─────────────────────────────────────────────────────────────────────
// Stage card
// ─────────────────────────────────────────────────────────────────────

/**
 * The unit-count band the stage covers. `[min, max]` inclusive; `max`
 * is `null` when the band is open-ended at the top.
 */
export interface UnitsRange {
  readonly min: number;
  readonly max: number | null;
}

/**
 * A single stage's complete card — what the org cares about, what the
 * UI should show, and the onboarding playbook to walk through.
 */
export interface StageCard {
  readonly name: OrgStage;
  readonly displayName: string;
  readonly range: UnitsRange;
  readonly focusAreas: ReadonlyArray<string>;
  readonly capabilitiesUnlocked: ReadonlyArray<CapabilityId>;
  readonly capabilitiesHidden: ReadonlyArray<CapabilityId>;
  readonly recommendedTabs: ReadonlyArray<string>;
  readonly recommendedReports: ReadonlyArray<string>;
  readonly recommendedAdvisors: ReadonlyArray<string>;
  readonly stageOnboardingPlaybook: StagePlaybook;
}

// ─────────────────────────────────────────────────────────────────────
// Onboarding playbook
// ─────────────────────────────────────────────────────────────────────

/**
 * One objective inside a stage's onboarding playbook. Tasks are the
 * concrete things the org actually does; objectives group them under
 * a theme.
 */
export interface PlaybookObjective {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tasks: ReadonlyArray<PlaybookTask>;
}

/**
 * A single playbook task. `completionPredicate` is run against the
 * org's state — if it returns `true` the task is considered done.
 */
export interface PlaybookTask {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly requiredCapability: CapabilityId;
  readonly completionPredicate: (orgState: OrgState) => boolean;
}

export interface StagePlaybook {
  readonly stage: OrgStage;
  readonly objectives: ReadonlyArray<PlaybookObjective>;
}

// ─────────────────────────────────────────────────────────────────────
// Org metrics + org state
// ─────────────────────────────────────────────────────────────────────

/**
 * Snapshot of the org metrics the detector reads. Primary axis is
 * `unitsManaged`. Secondaries break ties and add confidence.
 */
export interface OrgMetrics {
  readonly tenantId: string;
  /** Primary axis. */
  readonly unitsManaged: number;
  readonly activeUsers: number;
  readonly monthlyRevenue: number;
  readonly currency: string;
  /** Months since first property was created. */
  readonly ageMonths: number;
  /** Distinct geographic regions the org operates in. */
  readonly regionCount: number;
  /** Rolling 90d churn rate (0-1). */
  readonly tenantChurnRate: number;
  /** Observation date — used by the smoothing window. */
  readonly observedAt: string;
}

/**
 * Persisted state the org carries across stage detections. Stores the
 * last classified stage + the date we first observed the candidate
 * stage (so the hysteresis window can be measured).
 */
export interface PersistedStageState {
  readonly tenantId: string;
  readonly currentStage: OrgStage;
  readonly currentStageSince: string;
  readonly candidateStage: OrgStage | null;
  readonly candidateStageSince: string | null;
}

/**
 * Aggregate snapshot of the org's operational state — used by playbook
 * task completion predicates. Each field is loose on purpose; the
 * predicate decides what counts as "done".
 */
export interface OrgState {
  readonly tenantId: string;
  readonly orgSetupComplete: boolean;
  readonly propertyCount: number;
  readonly unitsManaged: number;
  readonly leaseCount: number;
  readonly paymentMethodsConfigured: number;
  readonly maintenanceCategoriesDefined: number;
  readonly scheduledInspectionsConfigured: number;
  readonly vendorCount: number;
  readonly inventoryLocationsCount: number;
  readonly rfqCount: number;
  readonly fleetVehicleCount: number;
  readonly reportCadenceCount: number;
  readonly regionsConfigured: number;
  readonly treasuryAccountCount: number;
  readonly jurisdictionsConfigured: number;
  /** Extension bag for callers that want extra signals. */
  readonly extra?: Readonly<Record<string, number | string | boolean>>;
}

// ─────────────────────────────────────────────────────────────────────
// Detection + transitions
// ─────────────────────────────────────────────────────────────────────

export interface DetectStageResult {
  readonly stage: OrgStage;
  readonly confidence: number;
  readonly evidence: ReadonlyArray<string>;
  /** Whether smoothing held us back from the raw classification. */
  readonly smoothingActive: boolean;
  /** The raw stage the metrics suggested before hysteresis. */
  readonly rawStage: OrgStage;
}

export type TransitionKind = 'grow' | 'shrink' | 'same';

export interface StageTransition {
  readonly from: OrgStage;
  readonly to: OrgStage;
  readonly kind: TransitionKind;
  readonly introductionMessage: string;
  readonly recommendedNextSteps: ReadonlyArray<string>;
  readonly capabilitiesToUnlock: ReadonlyArray<CapabilityId>;
  readonly capabilitiesToReview: ReadonlyArray<CapabilityId>;
}

// ─────────────────────────────────────────────────────────────────────
// Capability gating
// ─────────────────────────────────────────────────────────────────────

export interface CapabilityGatingInput {
  readonly stage: OrgStage;
  readonly role: StageRole;
  readonly jurisdiction?: string;
}

export interface CapabilityGatingResult {
  readonly unlocked: ReadonlyArray<CapabilityId>;
  readonly hidden: ReadonlyArray<CapabilityId>;
  readonly previewable: ReadonlyArray<CapabilityId>;
  /** Feature-flag keys we'd recommend enabling for this stage. */
  readonly recommendedFlagKeys: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Nudges
// ─────────────────────────────────────────────────────────────────────

export type NudgeUrgency = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface StageNudge {
  readonly id: string;
  readonly urgency: NudgeUrgency;
  readonly title: string;
  readonly message: string;
  readonly suggestedActionPrompt: string;
  readonly evidence: ReadonlyArray<string>;
  readonly dismissable: boolean;
  /** Stage the nudge is associated with. */
  readonly stage: OrgStage;
  /** ISO timestamp this nudge was generated. */
  readonly generatedAt: string;
}

export interface NudgeDeliveryRecord {
  readonly nudgeId: string;
  readonly deliveredAt: string;
}

export interface NudgeGenerationInput {
  readonly orgState: OrgState;
  readonly metrics: OrgMetrics;
  readonly detection: DetectStageResult;
  readonly lastDeliveredAt: ReadonlyArray<NudgeDeliveryRecord>;
  readonly lookbackDays?: number;
  /** ISO timestamp — used as the nudge generatedAt. Defaults to now. */
  readonly nowIso?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Trigger sink (optional integration with proactive-triggers-worker)
// ─────────────────────────────────────────────────────────────────────

/**
 * Stage-specific trigger emitter — pluggable adapter that wires into
 * the `services/proactive-triggers-worker/` sink so high-urgency stage
 * nudges can fan out through the same notification path as the rest of
 * the proactive system.
 *
 * Optional dep — the package works fine without it; nudges still come
 * back from `generateStageNudges` and the caller can deliver them
 * however it wants.
 */
export interface StageTriggerSink {
  emit(args: {
    readonly tenantId: string;
    readonly stage: OrgStage;
    readonly nudge: StageNudge;
  }): Promise<void> | void;
}

// ─────────────────────────────────────────────────────────────────────
// Brain integration
// ─────────────────────────────────────────────────────────────────────

/**
 * Stage context that gets attached to advisor calls. Consumed by the
 * `wrapAdvisorWithStageContext` middleware so the brain can frame its
 * answers in stage-appropriate language.
 */
export interface StageContext {
  readonly tenantId: string;
  readonly stage: OrgStage;
  readonly confidence: number;
  readonly evidence: ReadonlyArray<string>;
  readonly focusAreas: ReadonlyArray<string>;
  readonly capabilitiesUnlocked: ReadonlyArray<CapabilityId>;
}

/**
 * Port-style adapter exposed to consumers (notably role-aware-advisor)
 * that lets them ask "what stage is this tenant at" without depending
 * on the full advisor surface.
 */
export interface StageAdvisorPort {
  getCurrentStage(tenantId: string): Promise<StageContext | null>;
}
