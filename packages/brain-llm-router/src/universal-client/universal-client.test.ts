/**
 * Unit tests for universal-client/ adapters.
 *
 * Each adapter test injects a stub `fetchFn` so we exercise translation logic
 * without ever touching a real HTTP endpoint. Snapshot-style assertions on
 * request payloads + parsed responses.
 */

import { describe, expect, it } from 'vitest';
import { AnthropicAdapter } from './anthropic-adapter.js';
import { OpenAIAdapter } from './openai-adapter.js';
import { GoogleAdapter } from './google-adapter.js';
import { OllamaAdapter } from './ollama-adapter.js';
import { VLLMAdapter } from './vllm-adapter.js';
import type { BrainLLMRequest } from '../types.js';
import type { FetchFn } from './base-adapter.js';
import { BrainLLMError } from '../types.js';

/** Helper: build a stub fetchFn that captures the request + returns canned JSON. */
function stubFetch(body: unknown, status = 200): { fetchFn: FetchFn; calls: Array<{ url: string; body: string }> } {
  const calls: Array<{ url: string; body: string }> = [];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push({ url, body: init.body });
    return {
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return { fetchFn, calls };
}

const sampleReq: BrainLLMRequest = {
  model: 'anthropic/claude-haiku-4-5',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  system: 'You are helpful.',
  maxTokens: 256,
  temperature: 0.2,
};

describe('AnthropicAdapter', () => {
  it('translates an Anthropic-style request to Messages API and parses content blocks', async () => {
    const { fetchFn, calls } = stubFetch({
      id: 'msg_abc',
      content: [{ type: 'text', text: 'hello back' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 3 },
    });
    const adapter = new AnthropicAdapter({ apiKey: 'sk-test', fetchFn });
    const res = await adapter.invoke(sampleReq);
    expect(res.provider).toBe('anthropic');
    expect(res.content[0]).toEqual({ type: 'text', text: 'hello back' });
    expect(res.usage.inputTokens).toBe(5);
    expect(res.usage.outputTokens).toBe(3);
    expect(calls).toHaveLength(1);
    const parsed = JSON.parse(calls[0]!.body);
    expect(parsed.model).toBe('claude-haiku-4-5');
    expect(parsed.system).toBe('You are helpful.');
    expect(parsed.max_tokens).toBe(256);
  });

  it('forwards thinking budget when set', async () => {
    const { fetchFn, calls } = stubFetch({ content: [], stop_reason: 'end_turn', usage: {} });
    const adapter = new AnthropicAdapter({ apiKey: 'sk-test', fetchFn });
    await adapter.invoke({ ...sampleReq, thinking: { budgetTokens: 1024 } });
    const parsed = JSON.parse(calls[0]!.body);
    expect(parsed.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
  });

  it('wraps 429 as RATE_LIMITED retryable error', async () => {
    const { fetchFn } = stubFetch({ error: 'rate' }, 429);
    const adapter = new AnthropicAdapter({ apiKey: 'sk-test', fetchFn });
    await expect(adapter.invoke(sampleReq)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
  });

  it('wraps 503 as SERVER_ERROR retryable error', async () => {
    const { fetchFn } = stubFetch({ error: 'server' }, 503);
    const adapter = new AnthropicAdapter({ apiKey: 'sk-test', fetchFn });
    await expect(adapter.invoke(sampleReq)).rejects.toMatchObject({
      code: 'SERVER_ERROR',
      retryable: true,
    });
  });

  it('throws INVALID_REQUEST on empty messages', async () => {
    const adapter = new AnthropicAdapter({ apiKey: 'sk-test', fetchFn: stubFetch({}).fetchFn });
    await expect(
      adapter.invoke({ model: 'anthropic/claude-haiku-4-5', messages: [] })
    ).rejects.toBeInstanceOf(BrainLLMError);
  });
});

describe('OpenAIAdapter', () => {
  it('translates Anthropic-style request to OpenAI chat format', async () => {
    const { fetchFn, calls } = stubFetch({
      id: 'chatcmpl_abc',
      choices: [
        {
          message: { role: 'assistant', content: 'hi there' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 4, completion_tokens: 2 },
    });
    const adapter = new OpenAIAdapter({ apiKey: 'sk-test', fetchFn });
    const res = await adapter.invoke({ ...sampleReq, model: 'openai/gpt-5' });
    expect(res.provider).toBe('openai');
    expect(res.content[0]).toEqual({ type: 'text', text: 'hi there' });
    expect(res.usage.inputTokens).toBe(4);
    const parsed = JSON.parse(calls[0]!.body);
    expect(parsed.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(parsed.messages[1].content).toBe('hi');
  });

  it('translates tool_calls in OpenAI response back to Anthropic tool_use blocks', async () => {
    const { fetchFn } = stubFetch({
      choices: [
        {
          message: {
            content: '',
            tool_calls: [
              { id: 'tc1', type: 'function', function: { name: 'lookup', arguments: '{"q":"foo"}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const adapter = new OpenAIAdapter({ apiKey: 'sk-test', fetchFn });
    const res = await adapter.invoke({ ...sampleReq, model: 'openai/gpt-5' });
    expect(res.stopReason).toBe('tool_use');
    const toolBlock = res.content[0] as { type: string; name: string };
    expect(toolBlock.type).toBe('tool_use');
    expect(toolBlock.name).toBe('lookup');
  });

  it('translates reasoning field into thinking block', async () => {
    const { fetchFn } = stubFetch({
      choices: [
        {
          message: {
            content: 'final',
            reasoning: 'thought process',
          },
          finish_reason: 'stop',
        },
      ],
    });
    const adapter = new OpenAIAdapter({ apiKey: 'sk-test', fetchFn });
    const res = await adapter.invoke({ ...sampleReq, model: 'openai/o3' });
    expect(res.content[0]).toMatchObject({ type: 'thinking', thinking: 'thought process' });
    expect(res.content[1]).toMatchObject({ type: 'text', text: 'final' });
  });
});

describe('GoogleAdapter', () => {
  it('translates messages to Gemini contents and parses parts', async () => {
    const { fetchFn, calls } = stubFetch({
      candidates: [
        {
          content: { parts: [{ text: 'gemini reply' }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 4 },
    });
    const adapter = new GoogleAdapter({ apiKey: 'gk-test', fetchFn });
    const res = await adapter.invoke({ ...sampleReq, model: 'google/gemini-3-1-pro' });
    expect(res.provider).toBe('google');
    expect(res.content[0]).toEqual({ type: 'text', text: 'gemini reply' });
    expect(res.usage.inputTokens).toBe(6);
    const parsed = JSON.parse(calls[0]!.body);
    expect(parsed.contents[0].role).toBe('user');
    expect(parsed.systemInstruction.parts[0].text).toBe('You are helpful.');
  });

  it('stubs empty thinking block when thinking requested but Gemini emits none', async () => {
    const { fetchFn } = stubFetch({
      candidates: [{ content: { parts: [{ text: 'no thinking here' }] }, finishReason: 'STOP' }],
    });
    const adapter = new GoogleAdapter({ apiKey: 'gk-test', fetchFn });
    const res = await adapter.invoke({
      ...sampleReq,
      model: 'google/gemini-3-1-pro',
      thinking: { budgetTokens: 512 },
    });
    expect(res.content[0]).toEqual({ type: 'thinking', thinking: '' });
  });
});

describe('OllamaAdapter', () => {
  it('flattens content blocks into a single string and parses reply', async () => {
    const { fetchFn, calls } = stubFetch({
      message: { role: 'assistant', content: 'ollama reply' },
      done: true,
      prompt_eval_count: 8,
      eval_count: 4,
    });
    const adapter = new OllamaAdapter({ baseUrl: 'http://localhost:11434', fetchFn });
    const res = await adapter.invoke({ ...sampleReq, model: 'ollama/llama-3' });
    expect(res.provider).toBe('ollama');
    expect(res.content[0]).toEqual({ type: 'text', text: 'ollama reply' });
    const parsed = JSON.parse(calls[0]!.body);
    expect(parsed.messages[0]).toEqual({ role: 'system', content: 'You are helpful.' });
    expect(parsed.messages[1].content).toBe('hi');
  });
});

describe('VLLMAdapter', () => {
  it('delegates to OpenAIAdapter under the hood but reports provider=vllm', async () => {
    const { fetchFn } = stubFetch({
      choices: [{ message: { content: 'vllm reply' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 2, completion_tokens: 2 },
    });
    const adapter = new VLLMAdapter({ baseUrl: 'http://localhost:8000/v1', fetchFn });
    const res = await adapter.invoke({ ...sampleReq, model: 'vllm/qwen-3-6-plus' });
    expect(res.provider).toBe('vllm');
    expect(res.content[0]).toEqual({ type: 'text', text: 'vllm reply' });
  });
});

describe('thinking-block continuity across providers', () => {
  it('Anthropic preserves thinking block; OpenAI maps reasoning; Google stubs empty', async () => {
    const anthropicStub = stubFetch({
      content: [{ type: 'thinking', thinking: 'a thought' }, { type: 'text', text: 'reply' }],
      stop_reason: 'end_turn',
      usage: {},
    });
    const openaiStub = stubFetch({
      choices: [{ message: { content: 'reply', reasoning: 'a thought' }, finish_reason: 'stop' }],
    });
    const googleStub = stubFetch({
      candidates: [{ content: { parts: [{ text: 'reply' }] }, finishReason: 'STOP' }],
    });

    const anth = new AnthropicAdapter({ apiKey: 'x', fetchFn: anthropicStub.fetchFn });
    const oa = new OpenAIAdapter({ apiKey: 'x', fetchFn: openaiStub.fetchFn });
    const goog = new GoogleAdapter({ apiKey: 'x', fetchFn: googleStub.fetchFn });

    const reqWithThinking: BrainLLMRequest = {
      ...sampleReq,
      thinking: { budgetTokens: 512 },
    };

    const aRes = await anth.invoke(reqWithThinking);
    const oRes = await oa.invoke({ ...reqWithThinking, model: 'openai/o3' });
    const gRes = await goog.invoke({ ...reqWithThinking, model: 'google/gemini-3-1-pro' });

    // All three return a thinking block first.
    expect(aRes.content[0]!.type).toBe('thinking');
    expect(oRes.content[0]!.type).toBe('thinking');
    expect(gRes.content[0]!.type).toBe('thinking');
  });
});
