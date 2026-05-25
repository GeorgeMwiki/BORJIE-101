/**
 * Shared utilities for `owner.*` Owner-tier brain tools.
 *
 * Owner tools are the per-property-owner companion-of-agency tools the
 * brain may invoke when a logged-in owner asks Mr. Mwikila for action.
 * They mirror the HQ tool pattern but with a TIGHTER trust boundary:
 *
 *   - tier is ALWAYS `read` or `mutate` — owner tools NEVER destroy,
 *     bill, or send external comms. Anything that crosses those lines
 *     must escalate to the HQ-tier `platform.*` family
 *   - every executor verifies `input.tenantId === ctx.caller.scopes`-
 *     resolved tenant. Cross-tenant calls are refused with `OUT_OF_SCOPE`
 *
 * The runtime cost of an owner-tier call is dominated by the underlying
 * domain-service query (arrears report, occupancy ledger). Telemetry
 * stays on the same OTel + audit-sink wiring as HQ tools, but
 * sovereign-ledger emit is skipped (no sovereign-tier owner tool exists
 * by construction).
 */

import type {
  HqOtelSpanRecorder,
  HqToolContext,
  HqToolExecutionResult,
  RiskTier,
} from '../../risk-tier.js';
import type { OwnerRefusalReasonCode, OwnerToolName } from './types.js';
import { logger } from '../../../logger.js';

export interface OwnerTelemetryArgs<I, O> {
  readonly toolName: OwnerToolName;
  readonly riskTier: 'read' | 'mutate';
  readonly tenantId: string | null;
  readonly ctx: HqToolContext;
  readonly input: I;
  readonly body: () => Promise<HqToolExecutionResult<O>>;
}

/**
 * Run `body`, capture duration + status, emit one OTel span
 * `tool.owner.{name}`. Owner tools never persist to the sovereign-
 * action ledger because no destroy/billing/external-comm path exists.
 */
export async function withOwnerTelemetry<I, O>(
  args: OwnerTelemetryArgs<I, O>,
): Promise<HqToolExecutionResult<O>> {
  const startedMs = args.ctx.clock().getTime();
  let result: HqToolExecutionResult<O>;
  let errorMessage: string | null = null;
  try {
    result = await args.body();
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    result = { kind: 'failed', message: errorMessage };
  }
  const durationMs = Math.max(0, args.ctx.clock().getTime() - startedMs);
  const status: 'ok' | 'error' = result.kind === 'ok' ? 'ok' : 'error';
  emitSpan({
    otel: args.ctx.otel,
    spanName: `tool.${args.toolName}`,
    riskTier: args.riskTier,
    tenantId: args.tenantId,
    callerId: args.ctx.caller.callerId,
    durationMs,
    status,
    errorMessage: status === 'error' ? errorMessage ?? messageFor(result) : null,
  });
  return result;
}

function emitSpan(args: {
  readonly otel: HqOtelSpanRecorder | null;
  readonly spanName: string;
  readonly riskTier: RiskTier;
  readonly tenantId: string | null;
  readonly callerId: string;
  readonly durationMs: number;
  readonly status: 'ok' | 'error';
  readonly errorMessage: string | null;
}): void {
  if (!args.otel) return;
  try {
    args.otel.recordSpan({
      name: args.spanName,
      attributes: {
        'bn.tool.riskTier': args.riskTier,
        'bn.tool.tenantId': args.tenantId,
        'bn.tool.callerId': args.callerId,
      },
      durationMs: args.durationMs,
      status: args.status,
      errorMessage: args.errorMessage,
    });
  } catch (err) {
    logger.error('owner-tool: OTel span emit failed', { error: err });
  }
}

function messageFor<O>(result: HqToolExecutionResult<O>): string | null {
  if (result.kind === 'refused') return `${result.reasonCode}: ${result.message}`;
  if (result.kind === 'failed') return result.message;
  return null;
}

/**
 * Build a `refused` result. Owner tools reuse the HQ `HqRefusalReasonCode`
 * surface because dashboards group refusals across all tool families.
 */
export function ownerRefusal<O>(
  reasonCode: OwnerRefusalReasonCode,
  message: string,
): HqToolExecutionResult<O> {
  return { kind: 'refused', reasonCode, message };
}

/**
 * Verify the caller owns the target tenant. Returns true when the
 * caller carries `tenant:<id>` or `tenant:<id>:*` for the requested
 * tenant. Refuses platform-wide scopes — owner tools are by design
 * scoped to a single tenant.
 *
 * Cross-tenant requests are the most common abuse vector for an
 * owner-tier tool ("show me my neighbour's arrears"). This single
 * check is therefore the most important line in the file.
 */
export function ownerCanReachTenant(
  scopes: ReadonlyArray<string>,
  tenantId: string,
): boolean {
  if (!tenantId) return false;
  const wantA = `tenant:${tenantId}`;
  const wantPrefix = `tenant:${tenantId}:`;
  for (const have of scopes) {
    if (have === wantA) return true;
    if (have.startsWith(wantPrefix)) return true;
  }
  return false;
}
