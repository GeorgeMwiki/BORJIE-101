/**
 * Diversified retry — if a brain call fails (returns no usable tool
 * call / produces malformed structured output), retry at progressively
 * higher temperatures to escape local minima.
 *
 * Defaults to [0, 0.3, 0.7] matching common 2026 practice. Caller
 * provides a `succeeded` predicate that decides when to stop.
 */

import type {
  BrainCallRequest,
  BrainCallResponse,
  BrainPort,
} from '../types.js';

export interface RetryWithDifferentTemperatureInput {
  readonly call: BrainCallRequest;
  readonly brain: BrainPort;
  readonly succeeded: (resp: BrainCallResponse) => boolean;
  readonly temps?: ReadonlyArray<number>;
}

export interface RetryOutcome {
  readonly response: BrainCallResponse;
  readonly attempts: number;
  /** Temperature that yielded the successful response. */
  readonly winningTemperature: number;
  /** True if `succeeded` ever returned true; false = exhausted. */
  readonly success: boolean;
}

export const DEFAULT_RETRY_TEMPS: ReadonlyArray<number> = [0, 0.3, 0.7];

export async function retryWithDifferentTemperature(
  input: RetryWithDifferentTemperatureInput,
): Promise<RetryOutcome> {
  const temps = input.temps ?? DEFAULT_RETRY_TEMPS;
  if (temps.length === 0) throw new Error('temps must be non-empty');

  let lastResp: BrainCallResponse | null = null;
  for (let i = 0; i < temps.length; i++) {
    const t = temps[i];
    if (t === undefined) continue;
    const resp = await input.brain.call({ ...input.call, temperature: t });
    lastResp = resp;
    if (input.succeeded(resp)) {
      return {
        response: resp,
        attempts: i + 1,
        winningTemperature: t,
        success: true,
      };
    }
  }
  if (!lastResp) {
    throw new Error('retry produced no responses');
  }
  return {
    response: lastResp,
    attempts: temps.length,
    winningTemperature: temps[temps.length - 1] ?? 0,
    success: false,
  };
}
