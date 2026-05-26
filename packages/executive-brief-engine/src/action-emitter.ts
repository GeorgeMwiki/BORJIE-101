/**
 * @borjie/executive-brief-engine — action-emitter.
 *
 * For each surviving hypothesis, generate a RecommendedAction with
 * target_module + action + payload. We reuse Piece B's routing matrix
 * where applicable — when the hypothesis's anchor entity_type +
 * proposed intent already maps to a `routing_rules` row, that row's
 * `module_template_id` + `action` + `payload_template` is the
 * recommendation.
 *
 * Piece B may not yet be in this worktree; the action-emitter checks
 * the port for a routing rule and degrades to a built-in fallback
 * map when none is available. Both paths produce the same
 * RecommendedAction shape, so downstream callers don't care which
 * was used.
 *
 * TODO(#39): once `routing_rules` is in the worktree, wire
 *   `RoutingRulesPort.lookup({entityType, intent})` to the real table.
 */

import type { Hypothesis, RecommendedAction, Severity } from './types.js';
import type { VerifiedHypothesis } from './hypothesis-verifier.js';
import type { DebatedHypothesis } from './debate.js';

// ─────────────────────────────────────────────────────────────────────
// Routing port — TODO(#39) wire to the real routing_rules table.
// ─────────────────────────────────────────────────────────────────────

export interface RoutingRulesPort {
  /**
   * Returns the routing decision (target module + action + payload
   * template) for the given (entityType, intent) tuple, or null when
   * no rule matches.
   */
  lookup(args: {
    readonly tenantId: string;
    readonly entityType: string;
    readonly intent: string;
  }): Promise<{
    readonly moduleTemplateId: string;
    readonly action: string;
    readonly payloadTemplate: Readonly<Record<string, unknown>>;
    readonly minConfidence: number;
    readonly hitlRequired: boolean;
  } | null>;
}

// ─────────────────────────────────────────────────────────────────────
// Built-in fallback matrix — used when Piece B isn't in the worktree
// OR when the hypothesis doesn't match a tenant override.
//
// Keep this list explicit and short — the canonical routing table is
// Piece B's database, not this code.
// ─────────────────────────────────────────────────────────────────────

interface FallbackRoutingRule {
  readonly hypothesisKind: 'gap' | 'opportunity' | 'risk';
  readonly keywords: ReadonlyArray<string>;
  readonly moduleTemplateId: string;
  readonly action: string;
  readonly requiresApprovalAt: Severity;
  readonly title: (h: Hypothesis) => string;
}

const FALLBACK_RULES: ReadonlyArray<FallbackRoutingRule> = [
  // Risks → most often legal / compliance follow-up.
  // Order matters: more specific rules first so arrears doesn't get
  // swallowed by the generic 'overdue' keyword on breach.
  {
    hypothesisKind: 'risk',
    keywords: ['arrears', 'unpaid', 'default'],
    moduleTemplateId: 'FINANCE',
    action: 'open_arrears_follow_up',
    requiresApprovalAt: 'MEDIUM',
    title: (h) => `Open arrears follow-up: ${h.title}`,
  },
  {
    hypothesisKind: 'risk',
    keywords: ['expir', 'renew', 'lease', 'tenancy'],
    moduleTemplateId: 'ESTATE',
    action: 'schedule_renewal_negotiation',
    requiresApprovalAt: 'HIGH',
    title: (h) => `Schedule renewal negotiation for: ${h.title}`,
  },
  {
    hypothesisKind: 'risk',
    keywords: ['breach', 'violation', 'non-compliance'],
    moduleTemplateId: 'LEGAL',
    action: 'open_breach_case',
    requiresApprovalAt: 'HIGH',
    title: (h) => `Open breach case: ${h.title}`,
  },
  // Gaps → most often operational opens.
  {
    hypothesisKind: 'gap',
    keywords: ['collection', 'rent', 'payment'],
    moduleTemplateId: 'FINANCE',
    action: 'review_collection_performance',
    requiresApprovalAt: 'HIGH',
    title: (h) => `Review collection performance: ${h.title}`,
  },
  {
    hypothesisKind: 'gap',
    keywords: ['maintenance', 'complaint', 'incident', 'ticket'],
    moduleTemplateId: 'ESTATE',
    action: 'review_maintenance_backlog',
    requiresApprovalAt: 'MEDIUM',
    title: (h) => `Review maintenance backlog: ${h.title}`,
  },
  // Opportunities → most often financial / commercial.
  {
    hypothesisKind: 'opportunity',
    keywords: ['rent', 'price', 'rate', 'review'],
    moduleTemplateId: 'FINANCE',
    action: 'evaluate_rent_review_opportunity',
    requiresApprovalAt: 'HIGH',
    title: (h) => `Evaluate rent-review opportunity: ${h.title}`,
  },
  {
    hypothesisKind: 'opportunity',
    keywords: ['occupancy', 'vacant', 'fill'],
    moduleTemplateId: 'ESTATE',
    action: 'plan_occupancy_drive',
    requiresApprovalAt: 'MEDIUM',
    title: (h) => `Plan occupancy drive: ${h.title}`,
  },
];

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export interface EmitActionsArgs {
  readonly tenantId: string;
  readonly hypotheses: ReadonlyArray<DebatedHypothesis | VerifiedHypothesis>;
  readonly routingRules: RoutingRulesPort;
}

export interface EmitActionsResult {
  /** RecommendedActions in the order their source hypothesis appears. */
  readonly actions: ReadonlyArray<RecommendedAction>;
  /**
   * citationIndices is filled relative to the final brief's citations
   * array — the assembler resolves these once it knows the global
   * citation order. Until then we keep a `sourceHypothesisIndex`
   * pointer so the assembler can stitch it together.
   */
  readonly sourceMap: ReadonlyArray<{ readonly hypothesisIndex: number }>;
}

export async function emitRecommendedActions(
  args: EmitActionsArgs,
): Promise<EmitActionsResult> {
  const actions: RecommendedAction[] = [];
  const sourceMap: Array<{ hypothesisIndex: number }> = [];

  for (let i = 0; i < args.hypotheses.length; i += 1) {
    const h = args.hypotheses[i]!.hypothesis;
    const tenantRouted = await safeRoutingLookup(args.routingRules, {
      tenantId: args.tenantId,
      entityType: deriveEntityType(h),
      intent: deriveIntent(h),
    });

    if (tenantRouted) {
      const requiresApproval =
        tenantRouted.hitlRequired ||
        severityRank(h.severity) >= severityRank('HIGH');
      actions.push({
        title: titleFromHypothesis(h),
        targetModule: tenantRouted.moduleTemplateId,
        action: tenantRouted.action,
        payload: hydratePayload(tenantRouted.payloadTemplate, h),
        confidence: clamp01(0.6 + 0.05 * severityRank(h.severity)),
        citationIndices: [], // resolved by brief-assembler
        requiresApproval,
      });
      sourceMap.push({ hypothesisIndex: i });
      continue;
    }

    // Fallback path — built-in rule match.
    const rule = matchFallback(h);
    if (!rule) continue;

    const requiresApproval =
      severityRank(h.severity) >= severityRank(rule.requiresApprovalAt);
    actions.push({
      title: rule.title(h),
      targetModule: rule.moduleTemplateId,
      action: rule.action,
      payload: {
        hypothesis_title: h.title,
        hypothesis_kind: h.kind,
        severity: h.severity,
      },
      confidence: clamp01(0.55 + 0.05 * severityRank(h.severity)),
      citationIndices: [], // resolved later
      requiresApproval,
    });
    sourceMap.push({ hypothesisIndex: i });
  }

  return { actions, sourceMap };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function matchFallback(h: Hypothesis): FallbackRoutingRule | null {
  const text = `${h.title} ${h.description}`.toLowerCase();
  for (const rule of FALLBACK_RULES) {
    if (rule.hypothesisKind !== h.kind) continue;
    for (const kw of rule.keywords) {
      if (text.includes(kw.toLowerCase())) return rule;
    }
  }
  return null;
}

function deriveEntityType(h: Hypothesis): string {
  const entity = h.evidenceRefs.find((r) => r.kind === 'entity');
  if (!entity) return 'Unknown';
  // The evidence ref id will be a core_entity.id; the routing rule
  // typically matches on the entity_type slug. Without a lookup in this
  // worktree we return a generic placeholder; Piece B's port will know.
  return 'CoreEntity';
}

function deriveIntent(h: Hypothesis): string {
  switch (h.kind) {
    case 'risk':
      return 'RISK_OBSERVED';
    case 'opportunity':
      return 'OPPORTUNITY_OBSERVED';
    case 'gap':
    default:
      return 'GAP_OBSERVED';
  }
}

function titleFromHypothesis(h: Hypothesis): string {
  switch (h.kind) {
    case 'risk':
      return `Mitigate risk: ${h.title}`;
    case 'opportunity':
      return `Pursue opportunity: ${h.title}`;
    case 'gap':
    default:
      return `Close gap: ${h.title}`;
  }
}

function hydratePayload(
  template: Readonly<Record<string, unknown>>,
  h: Hypothesis,
): Record<string, unknown> {
  return {
    ...template,
    hypothesis_title: h.title,
    hypothesis_kind: h.kind,
    severity: h.severity,
    evidence_refs: h.evidenceRefs,
  };
}

function severityRank(s: Severity): number {
  return { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 }[s];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

async function safeRoutingLookup(
  port: RoutingRulesPort,
  args: { tenantId: string; entityType: string; intent: string },
): Promise<Awaited<ReturnType<RoutingRulesPort['lookup']>>> {
  try {
    return await port.lookup(args);
  } catch {
    return null;
  }
}
