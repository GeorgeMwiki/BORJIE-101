/**
 * Per-tenant policy engine. NemoClaw governance equivalent.
 *
 * Each tenant has a list of rules. Rules are evaluated in priority
 * order (lower priority number = checked first). The first matching
 * rule wins. If no rule matches, the default for the current autonomy
 * level applies.
 *
 * Per-jurisdiction overlays let regulators inject ceiling rules without
 * tenants having to opt in (e.g. TZ may forbid agent-billing in certain
 * categories regardless of tenant config).
 */

import type {
  AutonomyLevel,
  Jurisdiction,
  PolicyDecision,
  PolicyDecisionKind,
  PolicyRule,
} from '../types.js';
import { evaluateCondition, parseCondition, type DslContext } from './dsl.js';

export interface DefineAgentPolicyArgs {
  readonly tenantId: string;
  readonly agentId: string;
  readonly rules: ReadonlyArray<PolicyRule>;
}

export interface AgentPolicy {
  readonly tenantId: string;
  readonly agentId: string;
  readonly rules: ReadonlyArray<PolicyRule>;
}

/** Store port — wire to your tenant config store downstream. */
export interface PolicyStore {
  putPolicy(policy: AgentPolicy): Promise<void>;
  getPolicy(args: {
    tenantId: string;
    agentId: string;
  }): Promise<AgentPolicy | null>;
}

export class InMemoryPolicyStore implements PolicyStore {
  readonly #policies = new Map<string, AgentPolicy>();

  private key(args: { tenantId: string; agentId: string }): string {
    return `${args.tenantId}::${args.agentId}`;
  }

  async putPolicy(policy: AgentPolicy): Promise<void> {
    this.#policies.set(this.key(policy), policy);
  }

  async getPolicy(args: {
    tenantId: string;
    agentId: string;
  }): Promise<AgentPolicy | null> {
    return this.#policies.get(this.key(args)) ?? null;
  }
}

export function defineAgentPolicy(args: DefineAgentPolicyArgs): AgentPolicy {
  // Validate every rule parses
  for (const rule of args.rules) {
    parseCondition(rule.when);
  }
  return {
    tenantId: args.tenantId,
    agentId: args.agentId,
    rules: [...args.rules].sort((a, b) => a.priority - b.priority),
  };
}

/** Default decision for each autonomy level. Override per tenant. */
export const DEFAULT_DECISION_BY_LEVEL: Readonly<
  Record<AutonomyLevel, PolicyDecisionKind>
> = {
  L0: 'deny',
  L1: 'require_approval',
  L2: 'require_approval',
  L3: 'allow',
  L4: 'allow',
  L5: 'allow',
};

/**
 * Per-jurisdiction overlay rules. These run BEFORE tenant rules and
 * cannot be overridden by tenants — they encode regulator ceilings.
 *
 * Example: a deny rule for "action.kind == billing and action.amount > 1000000"
 * in TZ would block any agent from booking a >TZS 1m payment regardless of
 * tenant config.
 */
export interface JurisdictionOverlay {
  readonly jurisdiction: Jurisdiction;
  readonly rules: ReadonlyArray<PolicyRule>;
}

export const DEFAULT_JURISDICTION_OVERLAYS: ReadonlyArray<JurisdictionOverlay> = [
  {
    jurisdiction: 'TZ',
    rules: [
      {
        id: 'tz-bot-large-billing-escalate',
        when: 'action.kind == "billing" and action.amount > 1000000',
        then: 'escalate',
        reason: 'BoT: agent-billed amount > TZS 1m must be human-approved.',
        priority: 1,
      },
    ],
  },
  {
    jurisdiction: 'KE',
    rules: [
      {
        id: 'ke-cbk-large-billing-escalate',
        when: 'action.kind == "billing" and action.amount > 1000000',
        then: 'escalate',
        reason: 'CBK: agent-billed amount > KES 1m must be human-approved.',
        priority: 1,
      },
    ],
  },
];

export interface EvaluatePolicyArgs {
  readonly tenantId: string;
  readonly agentId: string;
  readonly action: DslContext;
  readonly context?: DslContext;
  readonly autonomyLevel: AutonomyLevel;
  readonly jurisdiction?: Jurisdiction;
  readonly policy: AgentPolicy | null;
  readonly overlays?: ReadonlyArray<JurisdictionOverlay>;
}

export function evaluatePolicy(args: EvaluatePolicyArgs): PolicyDecision {
  const dslContext: DslContext = {
    ...flattenForDsl('action', args.action),
    ...(args.context ? flattenForDsl('context', args.context) : {}),
    tenant_id: args.tenantId,
    agent_id: args.agentId,
    autonomy_level: args.autonomyLevel,
  };

  // 1. Jurisdiction overlay rules first
  if (args.jurisdiction !== undefined) {
    const overlays = args.overlays ?? DEFAULT_JURISDICTION_OVERLAYS;
    const matching = overlays.find((o) => o.jurisdiction === args.jurisdiction);
    if (matching) {
      const sorted = [...matching.rules].sort((a, b) => a.priority - b.priority);
      for (const rule of sorted) {
        if (evaluateCondition(parseCondition(rule.when), dslContext)) {
          return {
            decision: rule.then,
            matchedRuleId: rule.id,
            reason: `[jurisdiction-overlay:${args.jurisdiction}] ${rule.reason}`,
            autonomyLevelInForce: args.autonomyLevel,
          };
        }
      }
    }
  }

  // 2. Tenant rules
  if (args.policy) {
    for (const rule of args.policy.rules) {
      if (evaluateCondition(parseCondition(rule.when), dslContext)) {
        return {
          decision: rule.then,
          matchedRuleId: rule.id,
          reason: rule.reason,
          autonomyLevelInForce: args.autonomyLevel,
        };
      }
    }
  }

  // 3. Fallback — default for autonomy level
  return {
    decision: DEFAULT_DECISION_BY_LEVEL[args.autonomyLevel],
    matchedRuleId: null,
    reason: `Default for ${args.autonomyLevel} (no rule matched)`,
    autonomyLevelInForce: args.autonomyLevel,
  };
}

function flattenForDsl(prefix: string, obj: DslContext): DslContext {
  const out: Record<string, DslContext[string]> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[`${prefix}.${k}`] = v;
  }
  return out;
}
