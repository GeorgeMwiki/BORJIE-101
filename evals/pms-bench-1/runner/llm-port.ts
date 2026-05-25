/**
 * llm-port.ts — the thin LLM abstraction used by PMS-bench-1.
 *
 * The bench drives a sub-MD persona via a single-shot text completion
 * port. Two implementations live alongside this interface:
 *
 *   - `mock-llm.ts`       deterministic canned responses (CI gate)
 *   - `anthropic-llm.ts`  Anthropic SDK adapter (real-LLM run)
 *
 * Phase F may swap the Anthropic adapter for a multi-llm-router call —
 * the port stays the same.
 */

export interface BenchLlmRequest {
  readonly system: string;
  readonly user: string;
  readonly maxTokens?: number;
  /** Stable per-run seed so the mock can pick a canned response. */
  readonly seed: number;
  /** Bench task id — passed through so the mock can look up canned outputs. */
  readonly taskId: string;
}

export interface BenchLlmResponse {
  readonly text: string;
  /** USD cents charged for this call (estimator OK). */
  readonly costUsdCents: number;
  /** Provider tag for telemetry. */
  readonly provider: 'mock' | 'anthropic';
  /** Model id; useful for the report. */
  readonly model: string;
}

export interface BenchLlmPort {
  complete(req: BenchLlmRequest): Promise<BenchLlmResponse>;
}
