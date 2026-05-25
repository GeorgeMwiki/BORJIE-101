/**
 * Integration shim — K-E constitutional checker.
 *
 * The K-E ConstitutionalCritic evaluates outputs against the BORJIE
 * constitution (TZ Rental Act, GDPR/PDPA, currency chain, inviolable
 * IP). When the MD has already worked through a Plan-and-Solve+ plan
 * and a Self-Discover reasoning structure, the critic should receive
 * the *structured plan* — not just the final tenant-facing text — so
 * it can score the reasoning itself, not just the output.
 *
 * This shim shapes a `ReasoningStructure` plus the MD's per-step
 * outputs into the `ClusterReflection`-compatible payload K-E expects.
 * Duck-typed — no compile-time dep on @borjie/central-intelligence.
 */

import type { ReasoningStep, ReasoningStructure } from '../self-discover/types.js';

// ─────────────────────────────────────────────────────────────────────
// K-E port (duck-typed)
// ─────────────────────────────────────────────────────────────────────

export interface ConstitutionalClusterReflection {
  readonly clusterId: string;
  readonly tenantId: string | null;
  readonly text: string;
  readonly intentLabel: string;
}

export interface ConstitutionalCriticPort {
  score(reflection: ConstitutionalClusterReflection): Promise<{
    readonly clusterId: string;
    readonly overall: number;
    readonly passed: boolean;
    readonly scores: ReadonlyArray<{
      readonly ruleId: string;
      readonly score: number;
      readonly rationale: string;
    }>;
  }>;
}

// ─────────────────────────────────────────────────────────────────────
// Build a ClusterReflection from a Plan-and-Solve+ + Self-Discover run
// ─────────────────────────────────────────────────────────────────────

export interface StepOutput {
  readonly stepId: string;
  readonly output: unknown;
}

export interface BuildReflectionArgs {
  readonly tenantId: string | null;
  readonly structure: ReasoningStructure;
  readonly stepOutputs: ReadonlyArray<StepOutput>;
  /** The final MD response (tenant-facing text or decision). */
  readonly finalResponse: string;
  /** Optional caller-supplied cluster id; defaults to structureId+turn hash. */
  readonly clusterId?: string;
}

/**
 * Renders the structured plan + per-step outputs into a single text
 * blob the K-E critic can score.
 *
 * Format:
 *
 *   Task class: eviction
 *   Jurisdiction: TZ-DSM
 *   Step s1 (gather-relevant-facts) — Load tenant identity, lease...
 *     output: { ... }
 *   Step s2 (check-payment-history) — Pull the 12-month payment...
 *     output: { ... }
 *   ...
 *   Final response:
 *   <free text>
 *
 * The critic uses keyword-flagging on this blob; including the
 * structured plan means the critic catches violations in the
 * REASONING, not just the surface text.
 */
export function buildConstitutionalReflection(
  args: BuildReflectionArgs,
): ConstitutionalClusterReflection {
  const outputsById = new Map<string, unknown>(
    args.stepOutputs.map((o) => [o.stepId, o.output]),
  );
  const lines: string[] = [];
  lines.push(`Task class: ${args.structure.taskClass}`);
  lines.push(`Jurisdiction: ${args.structure.jurisdiction}`);
  lines.push('');
  lines.push('Plan + outputs:');
  for (const step of args.structure.steps) {
    lines.push(`Step ${step.stepId} (${step.primitive}) — ${step.narrative}`);
    if (outputsById.has(step.stepId)) {
      const out = outputsById.get(step.stepId);
      lines.push(`  output: ${safeStringify(out)}`);
    }
  }
  lines.push('');
  lines.push('Final response:');
  lines.push(args.finalResponse);
  return {
    clusterId: args.clusterId ?? `${args.structure.structureId}::${shortHash(args.finalResponse)}`,
    tenantId: args.tenantId,
    text: lines.join('\n'),
    intentLabel: args.structure.taskClass,
  };
}

/**
 * High-level helper: build the reflection and run the critic in one
 * call. Returns the K-E verdict.
 */
export async function scoreWithKEConstitutional(
  port: ConstitutionalCriticPort,
  args: BuildReflectionArgs,
): Promise<Awaited<ReturnType<ConstitutionalCriticPort['score']>>> {
  const reflection = buildConstitutionalReflection(args);
  return port.score(reflection);
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function shortHash(s: string): string {
  // Tiny deterministic hash — for cluster id uniqueness, not security.
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

/**
 * Identify reasoning steps in a structure that the K-E constitutional
 * critic CARES about — i.e. primitives that touch the four
 * constitution categories. Useful as a sanity check at composition-
 * root wiring time: if a high-stakes structure has zero such steps,
 * the wiring is probably wrong.
 */
export function constitutionallyRelevantSteps(
  structure: ReasoningStructure,
): ReadonlyArray<ReasoningStep> {
  return structure.steps.filter((s) => CONSTITUTIONAL_RELEVANT_PRIMITIVES.has(s.primitive));
}

const CONSTITUTIONAL_RELEVANT_PRIMITIVES: ReadonlySet<string> = new Set([
  'apply-tz-rental-act',
  'apply-ke-tenancy-rules',
  'check-currency-chain',
  'check-mediation-clause',
  'check-pii-boundary',
  'identify-relevant-rules',
]);
