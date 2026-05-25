/**
 * Token budget enforcement. Wraps any `BrainPort` so every call counts
 * against per-call, per-session, and (optionally) per-tenant caps.
 *
 * Raises `BudgetExceededError` when a cap would be breached BEFORE the
 * call is issued (cheaper than discovering it after expensive output
 * tokens have already been generated).
 */

import type {
  BrainCallRequest,
  BrainCallResponse,
  BrainPort,
  BudgetSpec,
} from '../types.js';
import { BudgetExceededError, totalTokens } from '../types.js';

export interface BudgetState {
  readonly sessionTokens: number;
  readonly tenantTokens: number;
  readonly brainCalls: number;
  readonly startedAt: number;
}

export interface WrapWithBudgetInput {
  readonly brain: BrainPort;
  readonly budget: Partial<BudgetSpec>;
  /**
   * Optional clock (ms since epoch). Defaults to `Date.now`.
   * Tests inject a controllable clock for wall-time assertions.
   */
  readonly clock?: () => number;
  /**
   * Optional per-tenant token bookkeeper. When supplied, the wrapper
   * reads + writes from this store instead of its in-memory counter.
   */
  readonly tenantStore?: {
    readonly tenantId: string;
    get(): Promise<number>;
    add(delta: number): Promise<void>;
  };
}

export interface BudgetedBrain {
  readonly brain: BrainPort;
  state(): BudgetState;
  /** Reset session counters; useful between conversations. */
  reset(): void;
}

const DEFAULT_PER_CALL = 8_192;
const DEFAULT_PER_SESSION = 500_000;

export function wrapWithBudget(input: WrapWithBudgetInput): BudgetedBrain {
  const clock = input.clock ?? Date.now;
  const limits = {
    perCall: input.budget.perCall ?? DEFAULT_PER_CALL,
    perSession: input.budget.perSession ?? DEFAULT_PER_SESSION,
    perTenant: input.budget.perTenant,
    maxWallMs: input.budget.maxWallMs,
    maxBrainCalls: input.budget.maxBrainCalls,
  };

  let sessionTokens = 0;
  let brainCalls = 0;
  const startedAt = clock();

  let tenantTokens = 0;

  return {
    brain: {
      async call(req: BrainCallRequest): Promise<BrainCallResponse> {
        // Pre-call gates.
        const requested = req.maxTokens ?? limits.perCall;
        if (requested > limits.perCall) {
          throw new BudgetExceededError('tokens', limits.perCall, requested, `per-call cap ${limits.perCall} exceeded by request maxTokens=${requested}`);
        }
        if (limits.maxBrainCalls !== undefined && brainCalls + 1 > limits.maxBrainCalls) {
          throw new BudgetExceededError('calls', limits.maxBrainCalls, brainCalls + 1);
        }
        if (limits.maxWallMs !== undefined && clock() - startedAt > limits.maxWallMs) {
          throw new BudgetExceededError('wall-ms', limits.maxWallMs, clock() - startedAt);
        }
        if (input.tenantStore) {
          tenantTokens = await input.tenantStore.get();
          if (limits.perTenant !== undefined && tenantTokens >= limits.perTenant) {
            throw new BudgetExceededError('tenant-tokens', limits.perTenant, tenantTokens);
          }
        }

        const resp = await input.brain.call({ ...req, maxTokens: requested });
        brainCalls += 1;
        const used = totalTokens(resp.usage);
        sessionTokens += used;
        if (sessionTokens > limits.perSession) {
          throw new BudgetExceededError('tokens', limits.perSession, sessionTokens);
        }
        if (input.tenantStore) {
          await input.tenantStore.add(used);
          tenantTokens += used;
        }
        return resp;
      },
    },
    state() {
      return Object.freeze({
        sessionTokens,
        tenantTokens,
        brainCalls,
        startedAt,
      });
    },
    reset() {
      sessionTokens = 0;
      brainCalls = 0;
      tenantTokens = 0;
    },
  };
}

// Re-export for callers.
export { BudgetExceededError };
export const __DEFAULT_PER_CALL = DEFAULT_PER_CALL;
export const __DEFAULT_PER_SESSION = DEFAULT_PER_SESSION;
