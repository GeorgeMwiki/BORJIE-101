/**
 * OpenTelemetry span wrapper for the AnthropicMessagesClient.
 *
 * Gap-3 (SLO attestation): the OTel auto-instrumentations cover HTTP
 * and PostgreSQL, but the LLM call — the single largest contributor
 * to p99 on the brain.turn envelope — was untraced. Without an LLM
 * span the operator can see "the gateway took 4.2s" but cannot say
 * "Anthropic took 3.9s, our orchestration 0.3s". This module wraps
 * the `messages.create` and `messages.stream` paths with a span that
 * records:
 *
 *   - `llm.vendor`              = anthropic
 *   - `llm.model`               = requested model id
 *   - `llm.request.kind`        = create | stream
 *   - `llm.request.max_tokens`  = upstream cap
 *   - `llm.request.thinking`    = true | false
 *   - `llm.response.stop_reason`= success-side stop reason
 *   - `llm.latency_ms`          = wall-clock duration
 *   - error span event + status when the call throws.
 *
 * The wrapper is structurally identical to the input — the existing
 * `createAnthropicSensor(...)` factory accepts it unchanged, and it
 * stacks safely on top of `wrapAnthropicWithCircuitBreaker(...)` so
 * the breaker's transition spans become siblings of the per-call
 * spans rather than children.
 *
 * Tracing failures NEVER break the LLM call — every span operation
 * is wrapped in a `try/catch` that swallows so a misconfigured
 * collector does not take production down.
 */

import { trace, SpanKind, SpanStatusCode, type Span } from '@opentelemetry/api';

const TRACER_NAME = 'borjie.api-gateway.llm';

// ---------------------------------------------------------------------------
// Duck-typed surface we touch. Mirrors the shape used by the
// circuit-breaker wrapper so the two compose cleanly.
// ---------------------------------------------------------------------------

interface AnthropicLike {
  messages: {
    create(args: unknown): Promise<unknown>;
    stream?(args: unknown): AsyncIterable<unknown>;
  };
}

interface AnthropicArgsLike {
  readonly model?: string;
  readonly max_tokens?: number;
  readonly thinking?: { type?: string };
}

interface AnthropicResponseLike {
  readonly stop_reason?: string | null;
  readonly model?: string;
}

// ---------------------------------------------------------------------------
// Span helpers
// ---------------------------------------------------------------------------

function startLlmSpan(kind: 'create' | 'stream', args: unknown): Span | null {
  try {
    const tracer = trace.getTracer(TRACER_NAME);
    const a = (args ?? {}) as AnthropicArgsLike;
    const span = tracer.startSpan(`llm.anthropic.${kind}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        'llm.vendor': 'anthropic',
        'llm.request.kind': kind,
        ...(typeof a.model === 'string' && { 'llm.model': a.model }),
        ...(typeof a.max_tokens === 'number' && {
          'llm.request.max_tokens': a.max_tokens,
        }),
        'llm.request.thinking': a.thinking?.type === 'enabled',
      },
    });
    return span;
  } catch {
    return null;
  }
}

function endLlmSpan(
  span: Span | null,
  startedAt: number,
  response: unknown,
): void {
  if (!span) return;
  try {
    const r = (response ?? {}) as AnthropicResponseLike;
    if (typeof r.stop_reason === 'string') {
      span.setAttribute('llm.response.stop_reason', r.stop_reason);
    }
    if (typeof r.model === 'string') {
      span.setAttribute('llm.response.model', r.model);
    }
    span.setAttribute('llm.latency_ms', Date.now() - startedAt);
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  } catch {
    // tracing must never break the LLM call
  }
}

function failLlmSpan(span: Span | null, startedAt: number, err: unknown): void {
  if (!span) return;
  try {
    const message = err instanceof Error ? err.message : String(err);
    span.setAttribute('llm.latency_ms', Date.now() - startedAt);
    if (err instanceof Error) {
      span.recordException(err);
    }
    span.setStatus({ code: SpanStatusCode.ERROR, message });
    span.end();
  } catch {
    // tracing must never break the LLM call
  }
}

// ---------------------------------------------------------------------------
// Public wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap an AnthropicMessagesClient so every call emits an OTel span.
 * The returned client preserves the structural contract of the input
 * — including any `__circuit` field the breaker wrapper attached —
 * so it can be passed to `createAnthropicSensor(...)` unchanged.
 *
 * Composition order (api-gateway composition root):
 *   raw client → withCircuitBreaker → withOtelSpans → createAnthropicSensor
 *
 * Putting OTel outermost means the span timing covers any breaker
 * short-circuits as well, which is what the operator wants on a
 * dashboard ("LLM rejected fast" still counts as a measured event).
 */
export function wrapAnthropicWithOtelSpans<T extends AnthropicLike>(
  client: T,
): T {
  const wrappedMessages: AnthropicLike['messages'] = {
    async create(args: unknown) {
      const startedAt = Date.now();
      const span = startLlmSpan('create', args);
      try {
        const response = await client.messages.create(args);
        endLlmSpan(span, startedAt, response);
        return response;
      } catch (err) {
        failLlmSpan(span, startedAt, err);
        throw err;
      }
    },
  };

  if (typeof client.messages.stream === 'function') {
    wrappedMessages.stream = (args: unknown): AsyncIterable<unknown> => {
      const upstreamFactory = client.messages.stream as (
        a: unknown,
      ) => AsyncIterable<unknown>;
      return {
        [Symbol.asyncIterator]() {
          const startedAt = Date.now();
          const span = startLlmSpan('stream', args);
          let upstream: AsyncIterator<unknown> | null = null;
          let finalised = false;
          const settle = (response: unknown, err?: unknown): void => {
            if (finalised) return;
            finalised = true;
            if (err) {
              failLlmSpan(span, startedAt, err);
            } else {
              endLlmSpan(span, startedAt, response);
            }
          };
          return {
            async next(): Promise<IteratorResult<unknown>> {
              try {
                if (!upstream) {
                  upstream = upstreamFactory(args)[Symbol.asyncIterator]();
                }
                const r = await upstream.next();
                if (r.done) settle(r.value);
                return r;
              } catch (err) {
                settle(undefined, err);
                throw err;
              }
            },
            async return(): Promise<IteratorResult<unknown>> {
              if (upstream?.return) {
                await upstream.return();
              }
              settle(undefined);
              return { value: undefined, done: true };
            },
          };
        },
      };
    };
  }

  // Build the proxy without mutating the original. Cast through
  // unknown so any extra fields (e.g. `__circuit` from the breaker
  // wrapper) propagate untouched.
  const proxied = {
    ...client,
    messages: wrappedMessages,
  } as unknown as T;
  return proxied;
}
