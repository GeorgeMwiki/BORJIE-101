/**
 * Autonomy-ladder enforcement.
 *
 * Six levels (SAE J3016-inspired):
 *   L0 — surface info only
 *   L1 — suggestions; human approves each
 *   L2 — partial autonomy on low-stakes; high-stakes need approval
 *   L3 — conditional autonomy within envelope; escalate exceptions
 *   L4 — high autonomy; periodic reports
 *   L5 — full autonomy; only escalate failures
 *
 * Each (agent, domain, jurisdiction) tuple has a configured level, capped
 * by jurisdiction-specific regulatory ceilings.
 */

import type {
  AutonomyLevel,
  Jurisdiction,
  JurisdictionAutonomyCap,
  RiskClass,
} from '../types.js';
import { AUTONOMY_LEVELS } from '../types.js';

/** Numeric rank for ordering (0..5). */
export function levelRank(level: AutonomyLevel): number {
  return AUTONOMY_LEVELS.indexOf(level);
}

/** Higher rank = more autonomous. */
export function levelGte(a: AutonomyLevel, b: AutonomyLevel): boolean {
  return levelRank(a) >= levelRank(b);
}

export function levelMin(
  a: AutonomyLevel,
  b: AutonomyLevel,
): AutonomyLevel {
  return levelRank(a) <= levelRank(b) ? a : b;
}

/**
 * Default jurisdiction caps reflect regulator posture as of 2026-05.
 * Override at runtime via the registry.
 *
 * Rationale (TZ / KE):
 *   - "critical" risk class (e.g. binding financial commitments, legal
 *     contracts, regulator filings) is capped at L3 — agent must escalate
 *     exceptions to a human for the foreseeable future.
 *   - "high" risk caps at L4 — periodic human review required.
 *   - "med" + "low" go to L5.
 *
 * GLOBAL is the fallback when no jurisdiction-specific cap is configured.
 */
export const DEFAULT_JURISDICTION_CAPS: ReadonlyArray<JurisdictionAutonomyCap> =
  [
    // TZ — BoT + Capital Markets Authority posture (conservative)
    {
      jurisdiction: 'TZ',
      riskClass: 'critical',
      maxLevel: 'L3',
      rationale: 'BoT requires human-in-loop for binding financial decisions.',
    },
    {
      jurisdiction: 'TZ',
      riskClass: 'high',
      maxLevel: 'L4',
      rationale: 'Periodic human review required for high-risk actions.',
    },
    { jurisdiction: 'TZ', riskClass: 'med', maxLevel: 'L5', rationale: 'OK' },
    { jurisdiction: 'TZ', riskClass: 'low', maxLevel: 'L5', rationale: 'OK' },
    // KE — Central Bank of Kenya + CMA posture (very similar)
    {
      jurisdiction: 'KE',
      riskClass: 'critical',
      maxLevel: 'L3',
      rationale: 'CBK requires human-in-loop for binding financial decisions.',
    },
    {
      jurisdiction: 'KE',
      riskClass: 'high',
      maxLevel: 'L4',
      rationale: 'Periodic human review required for high-risk actions.',
    },
    { jurisdiction: 'KE', riskClass: 'med', maxLevel: 'L5', rationale: 'OK' },
    { jurisdiction: 'KE', riskClass: 'low', maxLevel: 'L5', rationale: 'OK' },
    // UG
    {
      jurisdiction: 'UG',
      riskClass: 'critical',
      maxLevel: 'L3',
      rationale: 'BoU posture — human-in-loop for binding actions.',
    },
    {
      jurisdiction: 'UG',
      riskClass: 'high',
      maxLevel: 'L4',
      rationale: 'Periodic human review.',
    },
    { jurisdiction: 'UG', riskClass: 'med', maxLevel: 'L5', rationale: 'OK' },
    { jurisdiction: 'UG', riskClass: 'low', maxLevel: 'L5', rationale: 'OK' },
    // GLOBAL fallback — strict by default
    {
      jurisdiction: 'GLOBAL',
      riskClass: 'critical',
      maxLevel: 'L3',
      rationale: 'Conservative global fallback.',
    },
    {
      jurisdiction: 'GLOBAL',
      riskClass: 'high',
      maxLevel: 'L4',
      rationale: 'Conservative global fallback.',
    },
    {
      jurisdiction: 'GLOBAL',
      riskClass: 'med',
      maxLevel: 'L5',
      rationale: 'OK',
    },
    {
      jurisdiction: 'GLOBAL',
      riskClass: 'low',
      maxLevel: 'L5',
      rationale: 'OK',
    },
  ];

/** Lookup the jurisdiction cap for a (jurisdiction, riskClass) pair. */
export function lookupJurisdictionCap(
  jurisdiction: Jurisdiction,
  riskClass: RiskClass,
  caps: ReadonlyArray<JurisdictionAutonomyCap> = DEFAULT_JURISDICTION_CAPS,
): JurisdictionAutonomyCap {
  const exact = caps.find(
    (c) => c.jurisdiction === jurisdiction && c.riskClass === riskClass,
  );
  if (exact) return exact;
  const fallback = caps.find(
    (c) => c.jurisdiction === 'GLOBAL' && c.riskClass === riskClass,
  );
  if (fallback) return fallback;
  return {
    jurisdiction: 'GLOBAL',
    riskClass,
    maxLevel: 'L3',
    rationale: 'Hard-coded conservative default — no caps configured.',
  };
}

/**
 * Cap a requested level by the jurisdiction ceiling. Returns the
 * effective autonomy level + which cap was applied (if any).
 */
export interface CapResult {
  readonly effective: AutonomyLevel;
  readonly requested: AutonomyLevel;
  readonly capApplied: JurisdictionAutonomyCap | null;
}

export function applyJurisdictionCap(args: {
  readonly requested: AutonomyLevel;
  readonly jurisdiction: Jurisdiction;
  readonly riskClass: RiskClass;
  readonly caps?: ReadonlyArray<JurisdictionAutonomyCap>;
}): CapResult {
  const cap = lookupJurisdictionCap(args.jurisdiction, args.riskClass, args.caps);
  if (levelGte(args.requested, cap.maxLevel)) {
    if (args.requested === cap.maxLevel) {
      return { effective: cap.maxLevel, requested: args.requested, capApplied: cap };
    }
    // requested exceeds cap — cap it
    return {
      effective: cap.maxLevel,
      requested: args.requested,
      capApplied: cap,
    };
  }
  return { effective: args.requested, requested: args.requested, capApplied: null };
}

/**
 * Decision shape for an action against a configured autonomy level.
 */
export type ActionEvaluation =
  | { readonly decision: 'allow'; readonly reason: string }
  | { readonly decision: 'require_approval'; readonly reason: string }
  | { readonly decision: 'block'; readonly reason: string };

/**
 * `evaluateAction` — pure function.
 *
 * Per-level semantics:
 *   L0 — block any agent-initiated mutation (always require approval to mutate)
 *   L1 — every mutation requires approval
 *   L2 — low-stakes mutations allowed; high-stakes require approval
 *   L3 — within-envelope allowed; out-of-envelope requires approval
 *   L4 — allowed; high-cost or anomalous actions require approval
 *   L5 — allowed; only catastrophic actions blocked
 */
export interface EvaluateActionArgs {
  readonly autonomyLevel: AutonomyLevel;
  readonly action: {
    readonly kind: 'read' | 'mutate' | 'communicate' | 'billing' | 'destroy';
    readonly stakes: 'low' | 'med' | 'high' | 'critical';
    readonly inEnvelope: boolean;
    readonly costUsdCents: number;
    readonly anomalyScore?: number; // 0..1
  };
  /** USD-cents threshold above which agent must escalate. */
  readonly costEscalationCeilingUsdCents?: number;
  /** Anomaly score above which agent must escalate. */
  readonly anomalyEscalationThreshold?: number;
}

export function evaluateAction(args: EvaluateActionArgs): ActionEvaluation {
  const { autonomyLevel: lvl, action } = args;
  const costCeiling = args.costEscalationCeilingUsdCents ?? 100_000; // USD $1k default
  const anomalyCeiling = args.anomalyEscalationThreshold ?? 0.8;

  // destroy actions: only L5 may execute; everyone else requires approval
  if (action.kind === 'destroy' && lvl !== 'L5') {
    return {
      decision: 'require_approval',
      reason: `destroy actions require approval below L5 (current: ${lvl})`,
    };
  }

  // read actions: always allowed at any level
  if (action.kind === 'read') {
    return { decision: 'allow', reason: 'read actions allowed at any level' };
  }

  switch (lvl) {
    case 'L0':
      return {
        decision: 'block',
        reason: 'L0: agent surfaces info only; mutations blocked',
      };
    case 'L1':
      return {
        decision: 'require_approval',
        reason: 'L1: every mutation requires human approval',
      };
    case 'L2':
      if (action.stakes === 'low') {
        return { decision: 'allow', reason: 'L2: low-stakes mutation allowed' };
      }
      return {
        decision: 'require_approval',
        reason: `L2: ${action.stakes}-stakes mutation requires approval`,
      };
    case 'L3':
      if (!action.inEnvelope) {
        return {
          decision: 'require_approval',
          reason: 'L3: out-of-envelope action requires approval',
        };
      }
      if (action.stakes === 'critical') {
        return {
          decision: 'require_approval',
          reason: 'L3: critical-stakes action requires approval',
        };
      }
      return { decision: 'allow', reason: 'L3: in-envelope action allowed' };
    case 'L4':
      if (action.costUsdCents > costCeiling) {
        return {
          decision: 'require_approval',
          reason: `L4: action cost ${action.costUsdCents}c exceeds ceiling ${costCeiling}c`,
        };
      }
      if (
        action.anomalyScore !== undefined &&
        action.anomalyScore > anomalyCeiling
      ) {
        return {
          decision: 'require_approval',
          reason: `L4: anomaly score ${action.anomalyScore} exceeds ${anomalyCeiling}`,
        };
      }
      return { decision: 'allow', reason: 'L4: action allowed' };
    case 'L5':
      return { decision: 'allow', reason: 'L5: action allowed' };
    default: {
      const _exhaustive: never = lvl;
      void _exhaustive;
      return {
        decision: 'block',
        reason: `Unknown autonomy level: ${String(lvl)}`,
      };
    }
  }
}
