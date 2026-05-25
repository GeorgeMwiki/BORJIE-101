/**
 * eval-drift-logger/ — every brainCall logs a structured event into the
 * `eval_drift_event` entity. The K-D Inspect harness samples + replays
 * a subset against the golden eval suite and alerts on regression.
 *
 * Regression rule (research §5.5):
 *   current-week pass-rate < 4-week-rolling-mean - 5pp -> page on-call.
 *
 * EventSink is duck-typed so tests use in-memory, production swaps in
 * Postgres/Loki/whatever via the same port.
 */

import type { BrainLLMRequest, BrainLLMResponse, ModelTier, TaskKind } from '../types.js';
import { fnv1a, type EvalDriftEvent } from './event.js';

export interface EvalDriftSink {
  emit(event: EvalDriftEvent): Promise<void>;
  query(filter: { readonly task?: TaskKind; readonly model?: ModelTier; readonly sinceMs?: number }): Promise<readonly EvalDriftEvent[]>;
}

export interface LogDriftArgs {
  readonly task: TaskKind;
  readonly request: BrainLLMRequest;
  readonly response: BrainLLMResponse;
  readonly confidence: number;
  readonly costUsd: number;
  readonly tenantId: string;
  readonly conversationId: string;
  readonly fallbackDepth: number;
  readonly cascadeSteps: number;
  readonly wasHedged: boolean;
}

export async function logDrift(args: LogDriftArgs, sink: EvalDriftSink): Promise<EvalDriftEvent> {
  const promptHash = hashRequest(args.request);
  const responseHash = hashResponse(args.response);
  const event: EvalDriftEvent = {
    task: args.task,
    model: args.response.model,
    provider: args.response.provider,
    promptHash,
    responseHash,
    confidence: args.confidence,
    latencyMs: args.response.latencyMs,
    costUsd: args.costUsd,
    tenantId: args.tenantId,
    conversationId: args.conversationId,
    fallbackDepth: args.fallbackDepth,
    cascadeSteps: args.cascadeSteps,
    wasHedged: args.wasHedged,
    at: new Date().toISOString(),
  };
  await sink.emit(event);
  return event;
}

function hashRequest(req: BrainLLMRequest): string {
  const parts: string[] = [];
  if (req.system !== undefined) parts.push(req.system);
  for (const m of req.messages) {
    for (const c of m.content) {
      if (c.type === 'text') parts.push(c.text);
      else if (c.type === 'tool_use') parts.push(`${c.name}:${JSON.stringify(c.input)}`);
    }
  }
  return fnv1a(parts.join('|'));
}

function hashResponse(resp: BrainLLMResponse): string {
  const parts: string[] = [];
  for (const c of resp.content) {
    if (c.type === 'text') parts.push(c.text);
    else if (c.type === 'thinking') parts.push(`THINK:${c.thinking}`);
    else if (c.type === 'tool_use') parts.push(`${c.name}:${JSON.stringify(c.input)}`);
  }
  return fnv1a(parts.join('|'));
}

/**
 * Regression detector — compares current-window pass-rate vs the rolling
 * mean of N prior windows. Returns the delta + a boolean trigger flag.
 *
 * Pure function over a list of events. Caller is responsible for the
 * pass/fail boolean per event (set by Inspect AI scorer).
 */
export interface PassRateWindow {
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly passed: number;
  readonly total: number;
}

export function passRate(window: PassRateWindow): number {
  return window.total === 0 ? 0 : window.passed / window.total;
}

export function regressionTriggered(
  current: PassRateWindow,
  priorWindows: readonly PassRateWindow[],
  thresholdPp = 0.05
): { readonly triggered: boolean; readonly deltaPp: number; readonly currentRate: number; readonly priorMean: number } {
  if (priorWindows.length === 0) {
    return { triggered: false, deltaPp: 0, currentRate: passRate(current), priorMean: 0 };
  }
  const priorRates = priorWindows.map((w) => passRate(w));
  const priorMean = priorRates.reduce((s, r) => s + r, 0) / priorRates.length;
  const currentRate = passRate(current);
  const deltaPp = currentRate - priorMean;
  return {
    triggered: deltaPp < -thresholdPp,
    deltaPp,
    currentRate,
    priorMean,
  };
}

/** In-memory sink for tests + bootstrap. */
export class InMemoryEvalDriftSink implements EvalDriftSink {
  private readonly events: EvalDriftEvent[] = [];

  async emit(event: EvalDriftEvent): Promise<void> {
    this.events.push(event);
  }

  async query(filter: { readonly task?: TaskKind; readonly model?: ModelTier; readonly sinceMs?: number }): Promise<readonly EvalDriftEvent[]> {
    return this.events.filter((e) => {
      if (filter.task !== undefined && e.task !== filter.task) return false;
      if (filter.model !== undefined && e.model !== filter.model) return false;
      if (filter.sinceMs !== undefined && Date.parse(e.at) < filter.sinceMs) return false;
      return true;
    });
  }

  count(): number {
    return this.events.length;
  }
}
