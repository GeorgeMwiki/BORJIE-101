/**
 * Auto-Populate — Confidence Gate
 *
 * Decide, per entity, whether the extractor is sure enough to persist it
 * silently OR whether the MD should prompt the owner for confirmation
 * via the confirm-needed SSE event.
 *
 * Rules (default thresholds; configurable per call):
 *   - confidence >= 0.7  → AUTO_PERSIST (silent)
 *   - confidence >= 0.4  → CONFIRM_NEEDED ("I heard you say X — record this?")
 *   - confidence <  0.4  → DROP (too noisy to even surface)
 *
 * Pure function. No I/O. The MD core picks up the CONFIRM_NEEDED bucket
 * and decides whether to surface a prompt — we just classify.
 */

import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  type ExtractedEntity,
} from "./entity-types";

export type GateDecision = "auto_persist" | "confirm_needed" | "drop";

export interface GateOptions {
  /** Min confidence for silent persistence. Default 0.7. */
  readonly autoThreshold?: number;
  /** Min confidence to ask the owner. Default 0.4. */
  readonly confirmThreshold?: number;
}

export interface GatedEntity {
  readonly entity: ExtractedEntity;
  readonly decision: GateDecision;
  readonly threshold: number;
}

const DEFAULT_CONFIRM_THRESHOLD = 0.4;

/** Classify a single entity. Pure. */
export function gateEntity(
  entity: ExtractedEntity,
  options?: GateOptions,
): GatedEntity {
  const autoThreshold = options?.autoThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const confirmThreshold =
    options?.confirmThreshold ?? DEFAULT_CONFIRM_THRESHOLD;

  if (entity.confidence >= autoThreshold) {
    return { entity, decision: "auto_persist", threshold: autoThreshold };
  }
  if (entity.confidence >= confirmThreshold) {
    return { entity, decision: "confirm_needed", threshold: confirmThreshold };
  }
  return { entity, decision: "drop", threshold: confirmThreshold };
}

/** Classify a batch and return the three buckets. Pure. */
export function gateBatch(
  entities: ReadonlyArray<ExtractedEntity>,
  options?: GateOptions,
): {
  readonly autoPersist: ReadonlyArray<GatedEntity>;
  readonly confirmNeeded: ReadonlyArray<GatedEntity>;
  readonly dropped: ReadonlyArray<GatedEntity>;
} {
  const autoPersist: GatedEntity[] = [];
  const confirmNeeded: GatedEntity[] = [];
  const dropped: GatedEntity[] = [];

  for (const e of entities) {
    const gated = gateEntity(e, options);
    if (gated.decision === "auto_persist") autoPersist.push(gated);
    else if (gated.decision === "confirm_needed") confirmNeeded.push(gated);
    else dropped.push(gated);
  }

  return { autoPersist, confirmNeeded, dropped };
}

/**
 * Render a single confirm-needed prompt the MD can stream to the owner via
 * the confirm-needed SSE event. Examples:
 *   - "I heard you mention Acme Corp as a customer — should I record it?"
 *   - "Was that a new hire (Sarah)?"
 * Returns null when the gate decision is not confirm_needed.
 */
export function renderConfirmPrompt(gated: GatedEntity): string | null {
  if (gated.decision !== "confirm_needed") return null;
  const { entity } = gated;
  const noun = friendlyEntityNoun(entity.kind);
  return `I heard you mention ${entity.displayName} as a ${noun}. Want me to record that?`;
}

function friendlyEntityNoun(kind: ExtractedEntity["kind"]): string {
  switch (kind) {
    case "employee":
      return "team member";
    case "customer":
      return "customer";
    case "product":
      return "product";
    case "supplier":
      return "supplier";
    case "meeting":
      return "meeting";
    case "decision":
      return "decision";
    case "feedback":
      return "piece of feedback";
    case "goal":
      return "goal";
    case "project":
      return "project";
    case "risk":
      return "risk";
    case "opportunity":
      return "opportunity";
  }
}
