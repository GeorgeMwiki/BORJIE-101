/**
 * FlowAutonomyPort — the workflow-engine's read/write seam for the
 * flow-keyed autonomy posture (migration 0308 / `flow_autonomy_prefs`).
 *
 * Each created flow / workflow carries a sticky `auto | gated` posture.
 * The engine reads this seam to decide whether the per-run human-approval
 * step is SKIPPED (posture='auto') or BLOCKS (posture='gated', the
 * fail-safe default). On flow CREATION the engine records a pending
 * "auto-vs-gated?" confirmation so the creation-time confirmation
 * surfaces (trust-calibration).
 *
 * HARD RULE (additive only): a flow set to AUTO only widens the autonomy
 * POLICY. The inviolable rails (policy-gate / four-eye / sovereign /
 * kill_switch / money-path) STILL gate per action — rail-gate ALWAYS
 * wins. This seam can only ADD gating, never remove a rail. The engine
 * applies the AUTO skip ONLY when the definition itself does not hard-
 * require human approval (`definition.humanApprovalRequired`); a
 * definition that demands approval is never auto-skipped regardless of
 * posture.
 */

export const FLOW_AUTONOMY_POSTURES = ['gated', 'auto'] as const;
export type FlowAutonomyPosture = (typeof FLOW_AUTONOMY_POSTURES)[number];

export const FLOW_CONFIRMATION_STATES = ['pending', 'confirmed'] as const;
export type FlowConfirmationState = (typeof FLOW_CONFIRMATION_STATES)[number];

/** The sticky per-flow autonomy preference row. */
export interface FlowAutonomyPref {
  readonly tenantId: string;
  readonly flowId: string;
  readonly posture: FlowAutonomyPosture;
  readonly confirmationState: FlowConfirmationState;
  readonly riskCeiling: string | null;
  readonly amountThreshold: number | null;
  readonly createdBy: string;
  readonly promotedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Input for the creation-time pending confirmation record. */
export interface RecordFlowCreationInput {
  readonly tenantId: string;
  readonly flowId: string;
  readonly createdBy: string;
  readonly riskCeiling?: string | null;
  readonly amountThreshold?: number | null;
}

/** Input for setting a flow's posture (the auto-vs-gated decision). */
export interface SetFlowPostureInput {
  readonly tenantId: string;
  readonly flowId: string;
  readonly posture: FlowAutonomyPosture;
  readonly actorUserId: string;
  readonly riskCeiling?: string | null;
  readonly amountThreshold?: number | null;
}

export interface FlowAutonomyRepository {
  /**
   * Record (or no-op if already present) the creation-time pending
   * confirmation for a flow. Idempotent: a second call for the same
   * (tenantId, flowId) leaves the existing row untouched so an already-
   * answered confirmation is never reset to pending.
   */
  recordFlowCreation(input: RecordFlowCreationInput): Promise<FlowAutonomyPref>;
  /** Set the posture (auto-vs-gated decision); marks confirmation confirmed. */
  setPosture(input: SetFlowPostureInput): Promise<FlowAutonomyPref>;
  /** Read a single flow's preference (null when none recorded yet). */
  get(tenantId: string, flowId: string): Promise<FlowAutonomyPref | null>;
  /** List all preference rows for a tenant. */
  list(tenantId: string): Promise<ReadonlyArray<FlowAutonomyPref>>;
  /** List rows still awaiting the creation-time confirmation. */
  listPending(tenantId: string): Promise<ReadonlyArray<FlowAutonomyPref>>;
}

/**
 * Resolve whether a flow is AUTO-eligible to skip the per-run human
 * approval. A flow is AUTO only when its posture is 'auto' AND its
 * creation-time confirmation has been explicitly confirmed. A missing
 * row (no recorded preference) resolves to GATED — the fail-safe
 * default. This is a PURE predicate; it never relaxes a rail.
 */
export function isFlowAuto(pref: FlowAutonomyPref | null): boolean {
  if (!pref) return false;
  return pref.posture === 'auto' && pref.confirmationState === 'confirmed';
}
