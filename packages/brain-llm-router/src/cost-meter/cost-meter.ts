/**
 * Cost meter — per-call USD tracking + per-tenant accumulator.
 *
 * Ported from LITFIN `src/core/model-layer/cost-meter.ts` semantics
 * but adapted to Borjie's existing `cost-cascade/pricing` table
 * (no need to duplicate the per-token-per-million rates).
 *
 * Wire pattern (composition root):
 *
 *     setCostMeterEmitter((e) => {
 *       pinoLogger.info({ ...e }, 'llm-call-cost')
 *       prometheusCounter.inc({ tenant: e.tenantId }, e.usd)
 *     })
 *
 * Caller pattern (brain-call-orchestrator):
 *
 *     const response = await client.invoke(req)
 *     meterCall({
 *       tenantId, taskKind, model: req.model,
 *       inputTokens: response.usage.inputTokens,
 *       outputTokens: response.usage.outputTokens,
 *     })
 */

import { computeCost, getPricing } from '../cost-cascade/pricing.js';

// ─────────────────────── Types + interfaces ────────────────────────

export interface CostMeterEvent {
  readonly tenantId: string;
  readonly taskKind: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly usd: number;
  readonly timestampMs: number;
}

export interface MeterCallArgs {
  readonly tenantId: string;
  readonly taskKind: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

export type CostMeterEmitter = (event: CostMeterEvent) => void;

export interface TenantSpendSnapshot {
  readonly tenantId: string;
  readonly totalUsd: number;
  readonly callCount: number;
  readonly firstCallMs: number;
  readonly lastCallMs: number;
}

// ───────────────────── Per-tenant accumulator ──────────────────────

interface TenantAccumulator {
  totalUsd: number;
  callCount: number;
  firstCallMs: number;
  lastCallMs: number;
}

const tenantSpend = new Map<string, TenantAccumulator>();

function getOrInit(tenantId: string, now: number): TenantAccumulator {
  let acc = tenantSpend.get(tenantId);
  if (!acc) {
    acc = {
      totalUsd: 0,
      callCount: 0,
      firstCallMs: now,
      lastCallMs: now,
    };
    tenantSpend.set(tenantId, acc);
  }
  return acc;
}

// ────────────────────── Optional emitter sink ──────────────────────

let injectedEmitter: CostMeterEmitter | null = null;

/**
 * Wire the composition-root emitter. Typically pipes to:
 *   - Pino logger (`info` level, structured fields)
 *   - Prometheus counter (cumulative USD per-tenant)
 *   - OTel span attribute
 */
export function setCostMeterEmitter(emitter: CostMeterEmitter): void {
  injectedEmitter = emitter;
}

export function resetCostMeterEmitter(): void {
  injectedEmitter = null;
}

// ───────────────────────── Public API ─────────────────────────────

/**
 * Record one LLM call's actual cost. Updates per-tenant accumulator
 * and fires the emitter. Returns the computed event for downstream use
 * (Pino logging is the typical caller).
 *
 * Tolerates emitter errors silently — the LLM hot path must never
 * crash on observability.
 */
export function meterCall(args: MeterCallArgs): CostMeterEvent {
  const now = Date.now();
  const pricing = getPricing(args.model);
  const { usd } = computeCost(
    {
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      ...(args.cacheReadTokens !== undefined && { cacheReadTokens: args.cacheReadTokens }),
      ...(args.cacheWriteTokens !== undefined && { cacheWriteTokens: args.cacheWriteTokens }),
    },
    pricing,
  );

  const event: CostMeterEvent = {
    tenantId: args.tenantId,
    taskKind: args.taskKind,
    model: args.model,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    cacheReadTokens: args.cacheReadTokens ?? 0,
    cacheWriteTokens: args.cacheWriteTokens ?? 0,
    usd,
    timestampMs: now,
  };

  // Update accumulator immutably-ish (we mutate the local accumulator,
  // not the event).
  const acc = getOrInit(args.tenantId, now);
  acc.totalUsd += usd;
  acc.callCount += 1;
  acc.lastCallMs = now;

  if (injectedEmitter) {
    try {
      injectedEmitter(event);
    } catch {
      // Hot path never crashes on observability.
    }
  }

  return event;
}

/**
 * Snapshot of a tenant's spend. Returns `null` if no calls have been
 * recorded yet.
 */
export function getTenantSpend(tenantId: string): TenantSpendSnapshot | null {
  const acc = tenantSpend.get(tenantId);
  if (!acc) return null;
  return {
    tenantId,
    totalUsd: acc.totalUsd,
    callCount: acc.callCount,
    firstCallMs: acc.firstCallMs,
    lastCallMs: acc.lastCallMs,
  };
}

export function resetTenantSpend(tenantId: string): void {
  tenantSpend.delete(tenantId);
}

export function resetAllTenantSpend(): void {
  tenantSpend.clear();
}
