/**
 * Circuit-breaker wrapper around the AnthropicMessagesClient.
 *
 * The kernel's sensor failover layer needs a typed signal so it can
 * route around an Anthropic outage instead of silently retrying every
 * turn for 30s+ during a regional incident. This wrapper:
 *
 *   - Tracks consecutive errors thrown by `messages.create` /
 *     `messages.stream` and trips after `failureThreshold` (default 5).
 *   - Once OPEN, every call throws `AnthropicCircuitOpenError` until
 *     `recoveryTimeoutMs` has elapsed.
 *   - On expiry, the breaker enters HALF-OPEN: the next call goes
 *     through. Success → CLOSED. Failure → OPEN with a fresh timeout.
 *   - Emits OTel events on every state transition so dashboards can
 *     visualise the breaker timeline.
 *
 * The wrapped client preserves the upstream's structural contract so
 * the existing `createAnthropicSensor(...)` factory accepts it without
 * change.
 */

import { trace, type Span } from '@opentelemetry/api';

const TRACER_NAME = 'borjie.api-gateway.circuit-breaker';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Errors before tripping the breaker. Default 5. */
  readonly failureThreshold?: number;
  /** Time in OPEN before attempting HALF-OPEN. Default 30_000ms. */
  readonly recoveryTimeoutMs?: number;
  /** Test seam — defaults to `Date.now`. */
  readonly now?: () => number;
  /** Test seam — invoked on every state transition. */
  readonly onStateChange?: (transition: StateTransition) => void;
}

export interface StateTransition {
  readonly from: CircuitState;
  readonly to: CircuitState;
  readonly at: number;
  readonly reason: string;
}

export class AnthropicCircuitOpenError extends Error {
  readonly code = 'ANTHROPIC_CIRCUIT_OPEN' as const;
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(
      `Anthropic circuit breaker is OPEN; retry after ${retryAfterMs}ms`,
    );
    this.name = 'AnthropicCircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

export interface CircuitBreaker {
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
  readonly openedAt: number | null;
  /** Run an async fn through the breaker. */
  exec<T>(fn: () => Promise<T>): Promise<T>;
  /** Snapshot — useful for tests + dashboards. */
  snapshot(): { state: CircuitState; consecutiveFailures: number; openedAt: number | null };
}

/**
 * Build a generic circuit breaker. Used internally by
 * `wrapAnthropicWithCircuitBreaker` but exported for tests.
 */
export function createCircuitBreaker(
  options: CircuitBreakerOptions = {},
): CircuitBreaker {
  const failureThreshold = options.failureThreshold ?? 5;
  const recoveryTimeoutMs = options.recoveryTimeoutMs ?? 30_000;
  const now = options.now ?? Date.now;
  const onStateChange = options.onStateChange;

  let state: CircuitState = 'closed';
  let consecutiveFailures = 0;
  let openedAt: number | null = null;

  function emitTransition(from: CircuitState, to: CircuitState, reason: string): void {
    const transition: StateTransition = { from, to, at: now(), reason };
    onStateChange?.(transition);
    try {
      const tracer = trace.getTracer(TRACER_NAME);
      const span: Span = tracer.startSpan('anthropic.circuit_breaker.transition', {
        attributes: {
          'borjie.circuit.from': from,
          'borjie.circuit.to': to,
          'borjie.circuit.reason': reason,
        },
      });
      span.addEvent('circuit_state_transition', {
        from,
        to,
        reason,
      });
      span.end();
    } catch {
      // tracing must never break the breaker
    }
  }

  function recordFailure(reason: string): void {
    consecutiveFailures += 1;
    if (state === 'half-open') {
      // half-open trial failed — re-open immediately
      const prev = state;
      state = 'open';
      openedAt = now();
      emitTransition(prev, 'open', `half_open_failure: ${reason}`);
      return;
    }
    if (state === 'closed' && consecutiveFailures >= failureThreshold) {
      const prev = state;
      state = 'open';
      openedAt = now();
      emitTransition(prev, 'open', `failure_threshold_reached: ${reason}`);
    }
  }

  function recordSuccess(): void {
    if (state === 'half-open') {
      const prev = state;
      state = 'closed';
      consecutiveFailures = 0;
      openedAt = null;
      emitTransition(prev, 'closed', 'half_open_success');
      return;
    }
    consecutiveFailures = 0;
  }

  function maybeMoveToHalfOpen(): void {
    if (state !== 'open') return;
    if (openedAt === null) return;
    if (now() - openedAt < recoveryTimeoutMs) return;
    const prev = state;
    state = 'half-open';
    emitTransition(prev, 'half-open', 'recovery_timeout_elapsed');
  }

  return {
    get state(): CircuitState {
      return state;
    },
    get consecutiveFailures(): number {
      return consecutiveFailures;
    },
    get openedAt(): number | null {
      return openedAt;
    },
    async exec<T>(fn: () => Promise<T>): Promise<T> {
      maybeMoveToHalfOpen();
      if (state === 'open') {
        const since = openedAt ?? now();
        const retryAfterMs = Math.max(0, recoveryTimeoutMs - (now() - since));
        throw new AnthropicCircuitOpenError(retryAfterMs);
      }
      try {
        const out = await fn();
        recordSuccess();
        return out;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        recordFailure(message);
        throw err;
      }
    },
    snapshot() {
      return { state, consecutiveFailures, openedAt };
    },
  };
}

// ---------------------------------------------------------------------------
// AnthropicMessagesClient wrapper. The duck-typed interface here mirrors
// the one in `packages/central-intelligence/src/kernel/sensors/anthropic-sensor.ts`.
// We intentionally avoid importing that type to keep the breaker
// usable without a transitive type dep on the central-intelligence
// package.
// ---------------------------------------------------------------------------

interface AnthropicLike {
  messages: {
    create(args: unknown): Promise<unknown>;
    stream?(args: unknown): AsyncIterable<unknown>;
  };
}

export interface WrapAnthropicOptions extends CircuitBreakerOptions {}

/**
 * Wrap an AnthropicMessagesClient with a CircuitBreaker. The returned
 * client is structurally identical to the input — the
 * `createAnthropicSensor` factory accepts it unchanged. Failures
 * propagate; only when the breaker is OPEN does the wrapper short-
 * circuit with `AnthropicCircuitOpenError`.
 */
export function wrapAnthropicWithCircuitBreaker<T extends AnthropicLike>(
  client: T,
  options: WrapAnthropicOptions = {},
): T & { readonly __circuit: CircuitBreaker } {
  const breaker = createCircuitBreaker(options);
  const wrappedMessages: AnthropicLike['messages'] = {
    async create(args: unknown) {
      return breaker.exec(() => client.messages.create(args));
    },
  };
  if (typeof client.messages.stream === 'function') {
    wrappedMessages.stream = (args: unknown): AsyncIterable<unknown> => {
      // Streams are validated up-front: if the breaker is open we throw
      // synchronously when the consumer starts iterating. Otherwise we
      // proxy the upstream iterator and forward errors so the breaker
      // sees them.
      const upstreamFactory = client.messages.stream as (a: unknown) => AsyncIterable<unknown>;
      return {
        [Symbol.asyncIterator]() {
          let upstream: AsyncIterator<unknown> | null = null;
          let bootstrapFailed: unknown = null;
          let started = false;
          return {
            async next(): Promise<IteratorResult<unknown>> {
              if (bootstrapFailed) throw bootstrapFailed;
              if (!started) {
                started = true;
                try {
                  await breaker.exec(async () => {
                    upstream = upstreamFactory(args)[Symbol.asyncIterator]();
                  });
                } catch (err) {
                  bootstrapFailed = err;
                  throw err;
                }
              }
              if (!upstream) return { value: undefined, done: true };
              try {
                const r = await upstream.next();
                return r;
              } catch (err) {
                // mirror failure into breaker — wrap a no-op exec that
                // throws so the failure counter ticks consistently.
                try {
                  await breaker.exec(async () => {
                    throw err instanceof Error ? err : new Error(String(err));
                  });
                } catch {
                  // breaker already saw it
                }
                throw err;
              }
            },
            async return(): Promise<IteratorResult<unknown>> {
              if (upstream?.return) {
                await upstream.return();
              }
              return { value: undefined, done: true };
            },
          };
        },
      };
    };
  }

  // Build the proxy without mutating the original client. Casting
  // through unknown keeps the structural compatibility with the
  // upstream client type.
  const proxied = {
    ...client,
    messages: wrappedMessages,
    __circuit: breaker,
  } as unknown as T & { readonly __circuit: CircuitBreaker };
  return proxied;
}
