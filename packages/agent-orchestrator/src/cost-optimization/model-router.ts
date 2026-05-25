/**
 * Model router — chooses the cheapest model tier capable of handling
 * the incoming request, applying caller-supplied rules + a default
 * complexity heuristic.
 *
 * 2026 best practice (per Anthropic + LangChain cost guides): route
 * cheap models (haiku/gpt-4.1-mini) to repetitive simple work and
 * reserve powerful models (opus/o5-pro) for genuinely hard reasoning.
 * The router's job is to pick the tier, not the concrete model.
 */

import type {
  BrainCallRequest,
  BrainCallResponse,
  BrainPort,
  ModelTier,
  RouterPolicy,
  RouterRule,
} from '../types.js';

export interface BrainPerTier {
  readonly fast: BrainPort;
  readonly balanced: BrainPort;
  readonly powerful: BrainPort;
}

export interface CreateModelRouterInput {
  readonly brains: BrainPerTier;
  readonly policy: RouterPolicy;
  /**
   * Optional override of the complexity scorer; default uses request
   * length + structured-output flag.
   */
  readonly scoreComplexity?: (req: BrainCallRequest) => number;
  /** Telemetry hook — useful for testing routing decisions. */
  readonly onRoute?: (event: { readonly tier: ModelTier; readonly rule: string }) => void;
}

export interface RoutedBrain {
  readonly brain: BrainPort;
  /** Inspect which tier was chosen for the LAST call. */
  lastTier(): ModelTier | null;
}

export function createModelRouter(input: CreateModelRouterInput): RoutedBrain {
  const score = input.scoreComplexity ?? defaultComplexityScorer;
  let lastTier: ModelTier | null = null;

  function pick(req: BrainCallRequest): { tier: ModelTier; rule: string } {
    for (const rule of input.policy.rules) {
      if (matches(rule, req, score)) {
        return { tier: rule.tier, rule: ruleLabel(rule) };
      }
    }
    return { tier: input.policy.defaultTier, rule: 'default' };
  }

  return {
    brain: {
      async call(req: BrainCallRequest): Promise<BrainCallResponse> {
        const { tier, rule } = pick(req);
        lastTier = tier;
        if (input.onRoute) input.onRoute({ tier, rule });
        const brain = input.brains[tier];
        return brain.call(req);
      },
    },
    lastTier: () => lastTier,
  };
}

function matches(rule: RouterRule, req: BrainCallRequest, score: (r: BrainCallRequest) => number): boolean {
  const m = rule.matcher;
  switch (m.kind) {
    case 'tag-equals':
      return req.traceTag === m.tag;
    case 'tag-prefix':
      return Boolean(req.traceTag?.startsWith(m.prefix));
    case 'role': {
      // role match relies on the traceTag prefix conventions used by
      // single-agent / multi-agent runners ("react:supervisor:...").
      const tag = req.traceTag ?? '';
      const parts = tag.split(':');
      return parts.some((p) => p === m.role);
    }
    case 'complexity-above':
      return score(req) > m.threshold;
    default:
      return false;
  }
}

function ruleLabel(rule: RouterRule): string {
  const m = rule.matcher;
  switch (m.kind) {
    case 'tag-equals': return `tag=${m.tag}`;
    case 'tag-prefix': return `tag^${m.prefix}`;
    case 'role': return `role=${m.role}`;
    case 'complexity-above': return `complexity>${m.threshold}`;
    default: return 'unknown';
  }
}

/**
 * Naive scorer that approximates complexity by:
 *   - system prompt length
 *   - number of tools in the catalogue
 *   - number of conversation turns
 *   - structuredOutput requirement (1.2× multiplier)
 */
export function defaultComplexityScorer(req: BrainCallRequest): number {
  const sysLen = req.system.length;
  const turns = req.messages.length;
  const tools = req.tools?.length ?? 0;
  const base = sysLen / 100 + turns * 5 + tools * 3;
  return req.structuredOutput ? base * 1.2 : base;
}
