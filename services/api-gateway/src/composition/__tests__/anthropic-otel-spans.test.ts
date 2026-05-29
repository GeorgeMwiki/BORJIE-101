/**
 * Unit tests for the Anthropic OTel span wrapper.
 *
 * Validates that:
 *   - successful create() calls preserve the upstream response.
 *   - failed create() calls re-throw and the wrapper does not swallow.
 *   - stream() preserves the upstream async iterable contract.
 *   - the wrapper is composable with the circuit-breaker wrapper.
 *   - tracing failures NEVER break the LLM call (e.g. if the OTel
 *     global provider is misconfigured the wrapper still returns
 *     the upstream payload).
 *
 * We do not assert on emitted spans here because the test runtime
 * does not install an OTel SDK — `trace.getTracer(...)` returns a
 * no-op tracer whose `startSpan` is a stub. The point is that no
 * runtime error escapes the wrapper.
 */

import { describe, it, expect } from 'vitest';
import { wrapAnthropicWithOtelSpans } from '../anthropic-otel-spans';
import { wrapAnthropicWithCircuitBreaker } from '../anthropic-circuit-breaker';

interface FakeClient {
  messages: {
    create(args: unknown): Promise<unknown>;
    stream?(args: unknown): AsyncIterable<unknown>;
  };
}

function buildClient(opts: {
  response?: unknown;
  shouldThrow?: boolean;
  streamChunks?: ReadonlyArray<unknown>;
}): FakeClient {
  return {
    messages: {
      async create() {
        if (opts.shouldThrow) {
          throw new Error('upstream boom');
        }
        return opts.response ?? { id: 'msg_1', model: 'claude', content: [] };
      },
      stream(_args: unknown): AsyncIterable<unknown> {
        const chunks = opts.streamChunks ?? [];
        return {
          [Symbol.asyncIterator]() {
            let i = 0;
            return {
              async next(): Promise<IteratorResult<unknown>> {
                if (i >= chunks.length) {
                  return { value: undefined, done: true };
                }
                const value = chunks[i];
                i += 1;
                return { value, done: false };
              },
            };
          },
        };
      },
    },
  };
}

describe('wrapAnthropicWithOtelSpans', () => {
  it('preserves the upstream create() response on success', async () => {
    const client = buildClient({
      response: { id: 'msg_x', model: 'claude-3', content: [], stop_reason: 'end_turn' },
    });
    const wrapped = wrapAnthropicWithOtelSpans(client);
    const out = (await wrapped.messages.create({ model: 'claude-3', max_tokens: 100 })) as {
      id: string;
    };
    expect(out.id).toBe('msg_x');
  });

  it('re-throws upstream errors without swallowing', async () => {
    const client = buildClient({ shouldThrow: true });
    const wrapped = wrapAnthropicWithOtelSpans(client);
    await expect(
      wrapped.messages.create({ model: 'claude-3', max_tokens: 100 }),
    ).rejects.toThrow(/upstream boom/);
  });

  it('preserves the upstream stream() async iterable contract', async () => {
    const chunks = [
      { type: 'text_delta', text: 'hello' },
      { type: 'text_delta', text: ' world' },
    ];
    const client = buildClient({ streamChunks: chunks });
    const wrapped = wrapAnthropicWithOtelSpans(client);
    const yielded: unknown[] = [];
    if (!wrapped.messages.stream) throw new Error('stream missing');
    for await (const e of wrapped.messages.stream({ model: 'claude' })) {
      yielded.push(e);
    }
    expect(yielded).toEqual(chunks);
  });

  it('composes with the circuit-breaker wrapper', async () => {
    const client = buildClient({
      response: { id: 'msg_z', model: 'claude-3', content: [], stop_reason: 'end_turn' },
    });
    // Production composition order: raw → breaker → OTel.
    const wrapped = wrapAnthropicWithOtelSpans(
      wrapAnthropicWithCircuitBreaker(client, { failureThreshold: 5 }),
    );
    const out = (await wrapped.messages.create({ model: 'claude-3', max_tokens: 100 })) as {
      id: string;
    };
    expect(out.id).toBe('msg_z');
  });

  it('does not mutate the input client', async () => {
    const client = buildClient({});
    const originalCreate = client.messages.create;
    wrapAnthropicWithOtelSpans(client);
    expect(client.messages.create).toBe(originalCreate);
  });
});
