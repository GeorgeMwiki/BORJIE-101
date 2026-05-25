/**
 * Shared utilities for `platform.*` HQ-tier tools.
 *
 * Centralises the OTel-span helper and the sovereign-ledger emit
 * helper so every tool's `execute` body stays focussed on its own
 * domain logic.
 *
 * Tools NEVER hand-roll span attributes or ledger rows — they call
 * `withHqTelemetry` which wraps the executor body, captures
 * timing/status, emits an OTel span `tool.platform.{name}` with the
 * canonical attribute set, and (for sovereign-tier calls) records the
 * sovereign-action ledger row before returning.
 */

import type {
  HqOtelSpanRecorder,
  HqRefusalReasonCode,
  HqToolContext,
  HqToolExecutionResult,
  RiskTier,
} from '../../risk-tier.js';
import { isSovereignTier } from '../../risk-tier.js';
import { logger } from '../../../logger.js';

export interface HqTelemetryArgs<I, O> {
  readonly toolName: `platform.${string}`;
  readonly riskTier: RiskTier;
  readonly approvalRequired: boolean;
  readonly costEstimateUsd: number | null;
  readonly tenantId: string | null;
  readonly ctx: HqToolContext;
  readonly input: I;
  readonly body: () => Promise<HqToolExecutionResult<O>>;
}

/**
 * Run `body`, capture status + duration, emit the OTel span and
 * (when the tier is sovereign) the sovereign-ledger row. Always
 * returns whatever the body returned — failures are surfaced via the
 * `HqToolExecutionResult` tag, not by throwing.
 *
 * Telemetry side-effects MUST NOT take the call down. If the OTel
 * recorder or the sovereign ledger throws, we swallow + console.error
 * so a broken telemetry adapter cannot silently brick the admin chat.
 */
export async function withHqTelemetry<I, O>(
  args: HqTelemetryArgs<I, O>,
): Promise<HqToolExecutionResult<O>> {
  const startedAt = args.ctx.clock();
  const startedMs = startedAt.getTime();
  let result: HqToolExecutionResult<O>;
  let errorMessage: string | null = null;
  try {
    result = await args.body();
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    result = { kind: 'failed', message: errorMessage };
  }

  const finishedMs = args.ctx.clock().getTime();
  const durationMs = Math.max(0, finishedMs - startedMs);

  const status: 'ok' | 'error' = result.kind === 'ok' ? 'ok' : 'error';

  emitSpan({
    otel: args.ctx.otel,
    spanName: `tool.${args.toolName}`,
    riskTier: args.riskTier,
    tenantId: args.tenantId,
    callerId: args.ctx.caller.callerId,
    approvalRequired: args.approvalRequired,
    costEstimateUsd: args.costEstimateUsd,
    durationMs,
    status,
    errorMessage: status === 'error' ? errorMessage ?? messageFor(result) : null,
  });

  if (isSovereignTier(args.riskTier) && args.ctx.sovereignLedger) {
    try {
      await args.ctx.sovereignLedger.recordSovereignAction({
        toolName: args.toolName,
        riskTier: args.riskTier,
        callerId: args.ctx.caller.callerId,
        tenantId: args.tenantId,
        inputJson: safeStringify(args.input),
        outputJson: result.kind === 'ok' ? safeStringify(result.output) : null,
        approvalRequired: args.approvalRequired,
        approvalRecordId: args.ctx.approvalRecordId,
        costEstimateUsd: args.costEstimateUsd,
        at: startedAt.toISOString(),
      });
    } catch (err) {
      logger.error('hq-tool: sovereign-ledger emit failed (call still considered successful)', { error: err });
    }
  }

  return result;
}

function emitSpan(args: {
  readonly otel: HqOtelSpanRecorder | null;
  readonly spanName: string;
  readonly riskTier: RiskTier;
  readonly tenantId: string | null;
  readonly callerId: string;
  readonly approvalRequired: boolean;
  readonly costEstimateUsd: number | null;
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
        'bn.tool.approvalRequired': args.approvalRequired,
        'bn.tool.costEstimateUsd':
          args.costEstimateUsd === null ? null : args.costEstimateUsd,
      },
      durationMs: args.durationMs,
      status: args.status,
      errorMessage: args.errorMessage,
    });
  } catch (err) {
    logger.error('hq-tool: OTel span emit failed', { error: err });
  }
}

function messageFor<O>(result: HqToolExecutionResult<O>): string | null {
  if (result.kind === 'refused') return `${result.reasonCode}: ${result.message}`;
  if (result.kind === 'failed') return result.message;
  return null;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserialisable]"';
  }
}

/**
 * Build a `refused` result with a uniform message. Tools call this
 * instead of constructing the tag literal so the dashboard's
 * reasonCode grouping stays consistent.
 */
export function refusal<O>(
  reasonCode: HqRefusalReasonCode,
  message: string,
): HqToolExecutionResult<O> {
  return { kind: 'refused', reasonCode, message };
}
