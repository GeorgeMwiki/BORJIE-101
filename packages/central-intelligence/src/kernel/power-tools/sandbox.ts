/**
 * power_tool.sandbox — pure JS evaluation in a frozen sandbox.
 *
 * Two routes coexist:
 *   1. Legacy `JsSandboxAdapter` — caller supplies a pre-built adapter
 *      (kept so existing tests + composition still work).
 *   2. Wave-13 F7 wiring — caller supplies the F7 primitive directly via
 *      `policyRunner`. When set, `execute()` routes through
 *      `runInSandboxWithPolicy(...)` with the tier threaded from the
 *      power-tool execution context. The kernel does NOT need to know
 *      the F7 caps — the policy gate inside the F7 primitive enforces
 *      them per tier.
 *
 * Wave-12 stub remained: when neither route is wired, the executor
 * still refuses with `NOT_IMPLEMENTED` so callers learn the capability
 * is intentionally absent in that composition.
 *
 * Why this is a power-tool rather than an HQ-tier tool:
 *   The sandbox is a meta-capability the agent uses on ITSELF — it's
 *   the agent computing a derived value rather than reading or
 *   mutating a domain entity. HQ-tier tools are identity-scoped
 *   domain actions; this sits one level up alongside compose +
 *   schedule + self-modification.
 *
 * Tier model:
 *   - requiredTier: owner-advisor (residents do not need an eval surface;
 *                    the eval may leak partial state through error
 *                    messages, so we keep it out of resident-tier
 *                    inventories)
 *
 * Approval: none. The sandbox cannot reach the network, filesystem, or
 * any host capability. Pure computation only.
 *
 * Audit trail: every run lands in `audit_events` with code + duration
 * for debugging and "what has the brain been computing?" forensics.
 *
 * @module kernel/power-tools/sandbox
 */

import { z } from 'zod';
import type {
  PowerTool,
  PowerToolContext,
  PowerToolResult,
  PowerToolTier,
} from './types.js';
import type {
  SandboxPolicyInput,
  SandboxPolicyResult,
  SandboxTier,
} from '../sandbox/sandbox-policy.js';

const MAX_TIMEOUT_MS = 5000;
const DEFAULT_TIMEOUT_MS = 1000;
const MAX_CODE_BYTES = 8 * 1024; // 8 KB cap on snippet size

// ─────────────────────────────────────────────────────────────────────
// Adapter port — the future js-sandbox primitive plugs in here.
// ─────────────────────────────────────────────────────────────────────

export interface JsSandboxRunOutcome {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: string;
  readonly durationMs: number;
}

export interface JsSandboxAdapter {
  run(code: string, timeoutMs: number): Promise<JsSandboxRunOutcome>;
}

/**
 * Wave-13 wiring port. Implementations call F7's
 * `runInSandboxWithPolicy(...)` (or any equivalent that honours
 * `SandboxPolicyInput`). The power-tool maps its execution context onto
 * this input and forwards the caller's tier so the F7 policy gate can
 * enforce per-tier caps WITHOUT the power-tool re-implementing them.
 */
export interface SandboxPolicyRunner {
  run(input: SandboxPolicyInput): Promise<SandboxPolicyResult>;
}

// ─────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────

export const SandboxSchema = z.object({
  code: z.string().min(1).max(MAX_CODE_BYTES),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(MAX_TIMEOUT_MS)
    .optional(),
});

export type SandboxArgs = z.infer<typeof SandboxSchema>;

export interface SandboxOutput {
  readonly action: 'sandbox';
  readonly value: unknown;
  readonly durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// Factory — composition root supplies the adapter; tests inject stubs.
//
// Wave-13: callers can pass either a `JsSandboxAdapter` (legacy) OR a
// `SandboxPolicyRunner` that wraps F7's `runInSandboxWithPolicy(...)`.
// When the policy runner is wired we route through it so per-tier caps,
// audit hooks, and the F7 result envelope are honoured WITHOUT
// duplicating the cap logic here.
// ─────────────────────────────────────────────────────────────────────

export function createSandboxPowerTool(
  adapter: JsSandboxAdapter | null,
  options?: { readonly policyRunner?: SandboxPolicyRunner },
): PowerTool<SandboxArgs, SandboxOutput> {
  const policyRunner = options?.policyRunner;
  return {
    id: 'sandbox',
    name: 'JS sandbox eval',
    description:
      'Evaluate a small pure JavaScript snippet for ad-hoc calculations. No require, no fs, no network — frozen empty context.',
    requiredTier: 'owner-advisor',
    requiresApproval: false,
    auditDestination: 'audit-events',
    schema: SandboxSchema,
    async execute(
      ctx: PowerToolContext,
      args: SandboxArgs,
    ): Promise<PowerToolResult<SandboxOutput>> {
      // Preferred Wave-13 path — route through F7's policy-aware
      // entry-point so the per-tier caps + audit envelope are enforced
      // inside the primitive rather than re-implemented here.
      if (policyRunner) {
        const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const tier = mapPowerToolTierToSandboxTier(ctx.tier);
        const input: SandboxPolicyInput = {
          code: args.code,
          tier,
          timeoutMs,
          callerTag: `power_tool.sandbox:${ctx.callerId}`,
        };
        const outcome = await policyRunner.run(input);
        if (outcome.ok) {
          return {
            kind: 'ok',
            output: {
              action: 'sandbox',
              value: outcome.result ?? null,
              durationMs: outcome.durationMs,
            },
          };
        }
        // The F7 primitive reports policy + execution failures via the
        // same `ok: false` envelope; we forward the error code as a
        // failure (the power-tool's `refused`/`failed` boundary is a
        // separate concept).
        return {
          kind: 'failed',
          message: outcome.error?.message ?? 'sandbox execution failed',
        };
      }
      if (!adapter) {
        return {
          kind: 'refused',
          reasonCode: 'NOT_IMPLEMENTED',
          message:
            'js-sandbox adapter is not wired in this composition (F7 stub). Bind a JsSandboxAdapter at the api-gateway composition root.',
        };
      }
      const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const outcome = await adapter.run(args.code, timeoutMs);
      if (!outcome.ok) {
        return {
          kind: 'failed',
          message: outcome.error ?? 'sandbox execution failed',
        };
      }
      return {
        kind: 'ok',
        output: {
          action: 'sandbox',
          value: outcome.value ?? null,
          durationMs: outcome.durationMs,
        },
      };
    },
  };
}

/**
 * Map the power-tool's tier ladder onto F7's 4-step `SandboxTier`. The
 * power-tool tier list has 6 entries (tenant-resident → sovereign-admin);
 * F7 only cares about 4 cap levels. Anything below `owner-advisor`
 * collapses to `free`, sovereign tiers collapse to `sovereign`. The
 * power-tool's `requiredTier` already blocks tenant-resident, so the
 * `free` row here is only reachable via mis-wiring.
 */
function mapPowerToolTierToSandboxTier(tier: PowerToolTier): SandboxTier {
  switch (tier) {
    case 'tenant-resident':
      return 'free';
    case 'owner-advisor':
      return 'pro';
    case 'estate-manager':
    case 'org-admin':
      return 'enterprise';
    case 'platform-sovereign':
    case 'sovereign-admin':
      return 'sovereign';
  }
}
