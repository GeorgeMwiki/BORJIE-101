/**
 * Tests for `fetchers.ts` — L2 provider queries via injected fetch port.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { extractIds, fetchLatestForFamily } from '../fetchers.js';
import {
  clearFetchPort,
  setFetchPort,
  type DynamicRegistryFetchPort,
  type DynamicRegistryFetchResult,
} from '../fetch-port.js';

function okResult(body: unknown): DynamicRegistryFetchResult {
  return {
    status: 200,
    ok: true,
    headers: {},
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function errResult(status: number): DynamicRegistryFetchResult {
  return {
    status,
    ok: false,
    headers: {},
    json: async () => ({}),
    text: async () => '',
  };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  // Reset env keys we tweak.
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.COHERE_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  clearFetchPort();
});

afterEach(() => {
  process.env = { ...originalEnv };
  clearFetchPort();
});

describe('extractIds — provider shape adapters', () => {
  it('extracts ids from anthropic / openai / deepseek `{data:[{id}]}`', () => {
    const body = {
      data: [
        { id: 'claude-opus-4-7' },
        { id: 'claude-opus-4-8' },
        { id: 'claude-sonnet-4-6' },
      ],
    };
    expect(extractIds(body, 'anthropic')).toEqual([
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
    ]);
    expect(extractIds(body, 'openai')).toEqual([
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
    ]);
    expect(extractIds(body, 'deepseek')).toEqual([
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-sonnet-4-6',
    ]);
  });

  it('strips google `models/` prefix', () => {
    const body = {
      models: [
        { name: 'models/gemini-2.5-pro' },
        { name: 'models/gemini-2.5-flash' },
      ],
    };
    expect(extractIds(body, 'google')).toEqual([
      'gemini-2.5-pro',
      'gemini-2.5-flash',
    ]);
  });

  it('extracts cohere `{models:[{name}]}`', () => {
    const body = {
      models: [{ name: 'embed-v4.0' }, { name: 'rerank-3.5' }],
    };
    expect(extractIds(body, 'cohere')).toEqual(['embed-v4.0', 'rerank-3.5']);
  });

  it('extracts elevenlabs `[{model_id}]`', () => {
    const body = [{ model_id: 'eleven_v3' }, { model_id: 'scribe_v1' }];
    expect(extractIds(body, 'elevenlabs')).toEqual([
      'eleven_v3',
      'scribe_v1',
    ]);
  });

  it('returns [] on null / undefined / wrong shape', () => {
    expect(extractIds(null, 'anthropic')).toEqual([]);
    expect(extractIds(undefined, 'openai')).toEqual([]);
    expect(extractIds({ wrong: true }, 'cohere')).toEqual([]);
    expect(extractIds(42, 'google')).toEqual([]);
  });

  it('skips items missing the id field', () => {
    const body = {
      data: [{ id: 'opus-4-7' }, { foo: 'bar' }, { id: 'opus-4-8' }],
    };
    expect(extractIds(body, 'anthropic')).toEqual(['opus-4-7', 'opus-4-8']);
  });
});

describe('fetchLatestForFamily — full L2 path', () => {
  it('returns null when API key missing', async () => {
    // No ANTHROPIC_API_KEY set.
    const port = vi.fn();
    setFetchPort(port as unknown as DynamicRegistryFetchPort);
    const result = await fetchLatestForFamily('opus');
    expect(result).toBeNull();
    expect(port).not.toHaveBeenCalled();
  });

  it('returns newest opus on happy path', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const port: DynamicRegistryFetchPort = vi.fn(async () =>
      okResult({
        data: [
          { id: 'claude-opus-4-7' },
          { id: 'claude-opus-4-8' },
          { id: 'claude-sonnet-4-6' }, // filtered out
        ],
      }),
    );
    setFetchPort(port);
    expect(await fetchLatestForFamily('opus')).toBe('claude-opus-4-8');
  });

  it('returns newest sonnet (filters away opus / haiku)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    setFetchPort(async () =>
      okResult({
        data: [
          { id: 'claude-opus-4-8' },
          { id: 'claude-sonnet-4-5' },
          { id: 'claude-sonnet-4-7' },
          { id: 'claude-haiku-4-5' },
        ],
      }),
    );
    expect(await fetchLatestForFamily('sonnet')).toBe('claude-sonnet-4-7');
  });

  it('returns null on 5xx', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    setFetchPort(async () => errResult(503));
    expect(await fetchLatestForFamily('opus')).toBeNull();
  });

  it('returns null on 4xx', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    setFetchPort(async () => errResult(401));
    expect(await fetchLatestForFamily('opus')).toBeNull();
  });

  it('returns null when port throws (timeout / network)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    setFetchPort(async () => {
      throw new Error('timeout');
    });
    expect(await fetchLatestForFamily('opus')).toBeNull();
  });

  it('returns null when json parse throws', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    setFetchPort(async () => ({
      status: 200,
      ok: true,
      headers: {},
      json: async () => {
        throw new Error('bad json');
      },
      text: async () => '',
    }));
    expect(await fetchLatestForFamily('opus')).toBeNull();
  });

  it('returns null when no id matches family pattern', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    setFetchPort(async () =>
      okResult({
        data: [{ id: 'totally-unrelated' }, { id: 'some-other-model' }],
      }),
    );
    expect(await fetchLatestForFamily('opus')).toBeNull();
  });

  it('uses 5s timeout (asserts options propagated)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const port = vi.fn(async () => okResult({ data: [{ id: 'claude-opus-4-8' }] }));
    setFetchPort(port as unknown as DynamicRegistryFetchPort);
    await fetchLatestForFamily('opus');
    expect(port).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models',
      expect.objectContaining({ method: 'GET', timeoutMs: 5000 }),
    );
  });

  it('appends google ?key= query param', async () => {
    process.env.GOOGLE_AI_API_KEY = 'gkey';
    const port = vi.fn(async () =>
      okResult({
        models: [
          { name: 'models/gemini-2.5-pro' },
          { name: 'models/gemini-2.4-pro' },
        ],
      }),
    );
    setFetchPort(port as unknown as DynamicRegistryFetchPort);
    const result = await fetchLatestForFamily('gemini-pro');
    expect(result).toBe('gemini-2.5-pro');
    const calledUrl = (port.mock.calls[0]?.[0] ?? '') as string;
    expect(calledUrl).toContain('?key=gkey');
  });

  it('returns newest cohere embed', async () => {
    process.env.COHERE_API_KEY = 'ck';
    setFetchPort(async () =>
      okResult({
        models: [
          { name: 'embed-v3.0' },
          { name: 'embed-v4.0' },
          { name: 'rerank-3.5' },
        ],
      }),
    );
    expect(await fetchLatestForFamily('cohere-embed')).toBe('embed-v4.0');
  });

  it('returns newest elevenlabs eleven_', async () => {
    process.env.ELEVENLABS_API_KEY = 'ek';
    setFetchPort(async () =>
      okResult([
        { model_id: 'eleven_v2' },
        { model_id: 'eleven_v3' },
        { model_id: 'scribe_v1' },
      ]),
    );
    expect(await fetchLatestForFamily('eleven-tts')).toBe('eleven_v3');
  });

  it('returns newest deepseek-coder', async () => {
    process.env.DEEPSEEK_API_KEY = 'dk';
    setFetchPort(async () =>
      okResult({
        data: [
          { id: 'deepseek-chat' },
          { id: 'deepseek-coder' },
          { id: 'deepseek-coder-v2' },
        ],
      }),
    );
    expect(await fetchLatestForFamily('deepseek-coder')).toBe(
      'deepseek-coder-v2',
    );
  });

  it('filters gpt-5 (family) from gpt-5-mini and gpt-realtime', async () => {
    process.env.OPENAI_API_KEY = 'ok';
    setFetchPort(async () =>
      okResult({
        data: [
          { id: 'gpt-5.4' },
          { id: 'gpt-5.4-mini' },
          { id: 'gpt-5-realtime-preview' },
          { id: 'gpt-4o' },
        ],
      }),
    );
    expect(await fetchLatestForFamily('gpt-5')).toBe('gpt-5.4');
  });
});
