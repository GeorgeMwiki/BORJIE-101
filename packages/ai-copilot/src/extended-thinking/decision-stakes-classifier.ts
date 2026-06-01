/**
 * Decision-Stakes Classifier — Wave 28 Agent THINK.
 *
 * Pure, deterministic classifier that places a `DecisionContext` on the
 * four-tier stakes scale and yields a `StakesClassification` with the
 * recommended thinking budget + model tier.
 *
 * Rule order matters — we evaluate most-specific (`critical`) first and
 * fall through. Each rule has a stable `ruleId` so analytics + admin
 * tooling can answer "why did this get classified X?" without re-running.
 *
 * Rules (highest → lowest):
 *   CRIT-01  critical:  irreversible + regulated + (affectsLivelihoods OR vulnerable)
 *   HIGH-01  high:      irreversible AND regulated
 *   HIGH-02  high:      irreversible AND affectsLivelihoods
 *   HIGH-03  high:      regulated AND affectsLivelihoods
 *   HIGH-04  high:      amount above domain threshold
 *   HIGH-05  high:      publicly-visible regulated decision
 *   HIGH-06  high:      vulnerable counterparty + irreversible
 *   MED-01   medium:    autonomous decision on counterparty relationship (reversible)
 *   MED-02   medium:    non-trivial amount above medium threshold
 *   MED-03   medium:    publicly visible (marketing / procurement)
 *   LOW-01   low:       routine / reminder / sub-threshold amount
 */

import type { AutonomyDomain } from '../autonomy/types.js';
import {
  DEFAULT_MODEL_TIERS,
  DEFAULT_THINKING_BUDGETS,
  type DecisionContext,
  type DecisionStakes,
  type StakesClassification,
  type ThinkingModelTier,
} from './types.js';

// ---------------------------------------------------------------------------
// Domain thresholds — minor units (e.g. cents). Above `high` → high stakes.
// Numbers picked to match WAVE-13 autonomy policy defaults (see
// `autonomy/defaults.ts`) while staying conservative.
// ---------------------------------------------------------------------------

interface DomainThreshold {
  /** Above this → automatically `high` stakes. */
  readonly highMinorUnits: number;
  /** Above this but ≤ high → `medium` stakes. */
  readonly mediumMinorUnits: number;
}

const DEFAULT_DOMAIN_THRESHOLDS: Readonly<
  Record<AutonomyDomain, DomainThreshold>
> = Object.freeze({
  finance: { highMinorUnits: 500_000_00, mediumMinorUnits: 50_000_00 }, // > 500k units → high
  offtake: { highMinorUnits: 1_000_000_00, mediumMinorUnits: 100_000_00 },
  maintenance: { highMinorUnits: 200_000_00, mediumMinorUnits: 20_000_00 },
  compliance: { highMinorUnits: 100_000_00, mediumMinorUnits: 10_000_00 },
  communications: { highMinorUnits: Number.MAX_SAFE_INTEGER, mediumMinorUnits: Number.MAX_SAFE_INTEGER },
  marketing: { highMinorUnits: 250_000_00, mediumMinorUnits: 25_000_00 },
  hr: { highMinorUnits: 300_000_00, mediumMinorUnits: 30_000_00 },
  procurement: { highMinorUnits: 500_000_00, mediumMinorUnits: 50_000_00 },
  insurance: { highMinorUnits: 1_000_000_00, mediumMinorUnits: 100_000_00 },
  legal_proceedings: { highMinorUnits: 0, mediumMinorUnits: 0 }, // any amount → high
  community_welfare: { highMinorUnits: 200_000_00, mediumMinorUnits: 20_000_00 },
});

// Public for tests + admin UI rendering.
export function getDomainThresholds(
  domain: AutonomyDomain,
): DomainThreshold {
  return DEFAULT_DOMAIN_THRESHOLDS[domain];
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

interface ClassifierConfig {
  readonly thresholds?: Readonly<Record<AutonomyDomain, DomainThreshold>>;
  readonly budgets?: Readonly<Record<DecisionStakes, number>>;
  readonly models?: Readonly<Record<DecisionStakes, ThinkingModelTier>>;
}

export function classifyStakes(
  ctx: DecisionContext,
  config: ClassifierConfig = {},
): StakesClassification {
  const thresholds = config.thresholds ?? DEFAULT_DOMAIN_THRESHOLDS;
  const budgets = config.budgets ?? DEFAULT_THINKING_BUDGETS;
  const models = config.models ?? DEFAULT_MODEL_TIERS;
  const amount = ctx.amountMinorUnits ?? 0;
  const domainT = thresholds[ctx.domain];

  // ---------- CRITICAL ----------
  if (
    !ctx.reversible &&
    ctx.regulated &&
    (ctx.affectsLivelihoods || ctx.counterpartyIsVulnerable)
  ) {
    return buildClassification(
      'critical',
      'CRIT-01',
      'Irreversible + regulated + (affects livelihoods OR vulnerable counterparty). Deep deliberation required; cost is irrelevant vs regret.',
      budgets,
      models,
    );
  }

  // ---------- HIGH ----------
  if (!ctx.reversible && ctx.regulated) {
    return buildClassification(
      'high',
      'HIGH-01',
      'Irreversible and regulated — tribunal-adjacent permanence.',
      budgets,
      models,
    );
  }
  if (!ctx.reversible && ctx.affectsLivelihoods) {
    return buildClassification(
      'high',
      'HIGH-02',
      'Irreversible and affects livelihoods — wrong outcome shuts down an operator.',
      budgets,
      models,
    );
  }
  if (ctx.regulated && ctx.affectsLivelihoods) {
    return buildClassification(
      'high',
      'HIGH-03',
      'Regulated livelihoods decision — compliance + welfare both at stake.',
      budgets,
      models,
    );
  }
  if (domainT && amount > domainT.highMinorUnits) {
    return buildClassification(
      'high',
      'HIGH-04',
      `Amount ${amount} exceeds ${ctx.domain} high-threshold ${domainT.highMinorUnits}.`,
      budgets,
      models,
    );
  }
  if (ctx.publiclyVisible && ctx.regulated) {
    return buildClassification(
      'high',
      'HIGH-05',
      'Publicly-visible regulated decision — reputational + compliance exposure.',
      budgets,
      models,
    );
  }
  if (!ctx.reversible && ctx.counterpartyIsVulnerable) {
    return buildClassification(
      'high',
      'HIGH-06',
      'Irreversible action against a vulnerable counterparty.',
      budgets,
      models,
    );
  }

  // ---------- MEDIUM ----------
  if (affectsCounterpartyRelationship(ctx)) {
    return buildClassification(
      'medium',
      'MED-01',
      `Autonomous ${ctx.domain} decision affects counterparty relationship.`,
      budgets,
      models,
    );
  }
  if (domainT && amount > domainT.mediumMinorUnits) {
    return buildClassification(
      'medium',
      'MED-02',
      `Amount ${amount} exceeds ${ctx.domain} medium-threshold ${domainT.mediumMinorUnits}.`,
      budgets,
      models,
    );
  }
  if (ctx.publiclyVisible) {
    return buildClassification(
      'medium',
      'MED-03',
      'Publicly-visible output (marketing / listing / procurement).',
      budgets,
      models,
    );
  }

  // ---------- LOW ----------
  return buildClassification(
    'low',
    'LOW-01',
    'Routine decision — no regulatory, livelihoods, public, or amount triggers.',
    budgets,
    models,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildClassification(
  stakes: DecisionStakes,
  ruleId: string,
  reasoning: string,
  budgets: Readonly<Record<DecisionStakes, number>>,
  models: Readonly<Record<DecisionStakes, ThinkingModelTier>>,
): StakesClassification {
  return Object.freeze({
    stakes,
    ruleId,
    reasoning,
    thinkingBudgetTokens: budgets[stakes],
    recommendedModel: models[stakes],
  });
}

/**
 * `medium` MED-01 — the decision affects the counterparty relationship. These
 * are the domains where a wrong autonomous move erodes trust even if it
 * is technically reversible.
 */
function affectsCounterpartyRelationship(ctx: DecisionContext): boolean {
  if (ctx.domain === 'offtake' || ctx.domain === 'community_welfare') return true;
  if (ctx.domain === 'communications' && ctx.counterpartyIsVulnerable) return true;
  if (ctx.domain === 'finance' && ctx.counterpartyIsVulnerable) return true;
  return false;
}
