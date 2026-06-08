/**
 * Item-5 — Anthropic LLM router adapter tests.
 *
 * Proves the adapter maps Anthropic content blocks onto the closed
 * `Decision` ADT and — per the no-silent-fallback rule — fails LOUD: a
 * failed LLM call or a content-less response throws `AnthropicRouterError`
 * instead of fabricating a silent empty answer.
 */

import { describe, it, expect } from 'vitest';
import {
  createAnthropicRouter,
  AnthropicRouterError,
} from '../anthropic-router.js';
import type { AnthropicMessagesClient } from '../../sensors/anthropic-sensor.js';
import type { LLMRouterCall } from '../main-loop.js';

interface CreateArgs {
  readonly model: string;
  readonly max_tokens: number;
  readonly system?: string;
  readonly messages: ReadonlyArray<{ role: string; content: unknown }>;
  readonly tools?: ReadonlyArray<unknown>;
}

/** Build a fake Anthropic client that returns a fixed response + records args. */
function fakeClient(
  response: { content: ReadonlyArray<Record<string, unknown>> },
): AnthropicMessagesClient & { lastArgs: CreateArgs | null } {
  const holder: { lastArgs: CreateArgs | null } = { lastArgs: null };
  const client = {
    lastArgs: null as CreateArgs | null,
    messages: {
      async create(args: CreateArgs) {
        holder.lastArgs = args;
        client.lastArgs = args;
        return {
          id: 'msg_1',
          model: args.model,
          stop_reason: 'end_turn',
          content: response.content,
        } as never;
      },
    },
  };
  return client as unknown as AnthropicMessagesClient & {
    lastArgs: CreateArgs | null;
  };
}

function makeCall(over: Partial<LLMRouterCall> = {}): LLMRouterCall {
  return {
    system: 'SYS',
    tools: [],
    messages: [{ role: 'user', content: 'hello' }],
    ...over,
  };
}

describe('createAnthropicRouter', () => {
  it('maps a text-only response to respond_to_owner', async () => {
    const client = fakeClient({ content: [{ type: 'text', text: 'hi there' }] });
    const router = createAnthropicRouter(client, { model: 'm' });
    const decision = await router.call(makeCall());
    expect(decision.kind).toBe('respond_to_owner');
    if (decision.kind === 'respond_to_owner') {
      expect(decision.text).toBe('hi there');
    }
  });

  it('maps a tool_use block to a tool_call with the SDK tool id', async () => {
    const client = fakeClient({
      content: [
        { type: 'text', text: 'let me check' },
        {
          type: 'tool_use',
          id: 'toolu_99',
          name: 'arrears.lookup',
          input: { unit: 'A1' },
        },
      ],
    });
    const router = createAnthropicRouter(client, { model: 'm' });
    const decision = await router.call(
      makeCall({
        tools: [
          { name: 'arrears.lookup', description: 'lookup', keywords: ['arrears'] },
        ],
      }),
    );
    expect(decision.kind).toBe('tool_call');
    if (decision.kind === 'tool_call') {
      expect(decision.call.toolName).toBe('arrears.lookup');
      expect(decision.call.callId).toBe('toolu_99');
      expect(decision.call.input).toEqual({ unit: 'A1' });
    }
  });

  it('advertises tools to the client (Anthropic tool definitions)', async () => {
    const client = fakeClient({ content: [{ type: 'text', text: 'ok' }] });
    const router = createAnthropicRouter(client, {
      model: 'm',
      inputSchemaFor: () => ({ type: 'object', properties: { x: {} } }),
    });
    await router.call(
      makeCall({
        tools: [{ name: 't1', description: 'd1', keywords: ['k'] }],
      }),
    );
    expect(client.lastArgs?.tools).toBeDefined();
    const tools = client.lastArgs?.tools as ReadonlyArray<{
      name: string;
      input_schema: unknown;
    }>;
    expect(tools[0]?.name).toBe('t1');
    expect(tools[0]?.input_schema).toEqual({
      type: 'object',
      properties: { x: {} },
    });
  });

  it('folds tool + system messages into user turns for the client', async () => {
    const client = fakeClient({ content: [{ type: 'text', text: 'ok' }] });
    const router = createAnthropicRouter(client, { model: 'm' });
    await router.call(
      makeCall({
        messages: [
          { role: 'system', content: 'ctx note' },
          { role: 'tool', content: 'tool out' },
          { role: 'assistant', content: 'prior' },
        ],
      }),
    );
    const msgs = client.lastArgs?.messages ?? [];
    expect(msgs[0]).toEqual({ role: 'user', content: '[context]\nctx note' });
    expect(msgs[1]).toEqual({ role: 'user', content: '[tool result]\ntool out' });
    expect(msgs[2]).toEqual({ role: 'assistant', content: 'prior' });
  });

  it('throws AnthropicRouterError when the client call fails (no silent empty answer)', async () => {
    const errors: Array<{ msg: string; meta?: Record<string, unknown> }> = [];
    const client: AnthropicMessagesClient = {
      messages: {
        async create() {
          throw new Error('rate limited');
        },
      },
    };
    const router = createAnthropicRouter(client, {
      model: 'm',
      logger: {
        warn: () => {},
        error: (msg, meta) => errors.push({ msg, meta }),
      },
    });
    await expect(router.call(makeCall())).rejects.toBeInstanceOf(
      AnthropicRouterError,
    );
    await expect(router.call(makeCall())).rejects.toThrow(/rate limited/);
    // The failure is also logged for operators, not just thrown.
    expect(errors.some((e) => e.meta?.reason === 'rate limited')).toBe(true);
  });

  it('preserves the originating SDK error as `cause`', async () => {
    const root = new Error('overloaded_error');
    const client: AnthropicMessagesClient = {
      messages: {
        async create() {
          throw root;
        },
      },
    };
    const router = createAnthropicRouter(client, { model: 'm' });
    await router.call(makeCall()).then(
      () => {
        throw new Error('expected the router to throw');
      },
      (err: unknown) => {
        expect(err).toBeInstanceOf(AnthropicRouterError);
        expect((err as { cause?: unknown }).cause).toBe(root);
      },
    );
  });

  it('throws AnthropicRouterError on an empty-content response (content-less = fault)', async () => {
    const client = fakeClient({ content: [] });
    const router = createAnthropicRouter(client, { model: 'm' });
    await expect(router.call(makeCall())).rejects.toBeInstanceOf(
      AnthropicRouterError,
    );
    await expect(router.call(makeCall())).rejects.toThrow(/empty answer/);
  });

  it('throws AnthropicRouterError on a whitespace-only text response', async () => {
    const client = fakeClient({ content: [{ type: 'text', text: '   \n  ' }] });
    const router = createAnthropicRouter(client, { model: 'm' });
    await expect(router.call(makeCall())).rejects.toBeInstanceOf(
      AnthropicRouterError,
    );
  });
});
