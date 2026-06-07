/**
 * Tests for `validate-model.ts` — the smoke-validation probe that gates
 * adoption of a newly-discovered model id.
 *
 * Covers the three outcomes (`pass` / `fail` / `skipped`), both probe
 * shapes (per-model retrieve vs. list-membership), missing-key skip,
 * status classification, and the never-throws contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateModel } from '../validate-model.js';
import {
  clearFetchPort,
  setFetchPort,
  type DynamicRegistryFetchPort,
  type DynamicRegistryFetchResult,
} from '../fetch-port.js';

function resultWithStatus(
  status: number,
  body: unknown = {},
): DynamicRegistryFetchResult {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {},
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const originalEnv = { ...process.env };

beforeEach(() => {
  clearFetchPort();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.COHERE_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
});

afterEach(() => {
  process.env = { ...originalEnv };
  clearFetchPort();
});

describe('validateModel — missing key', () => {
  it('returns skipped without calling the port when the key is absent', async () => {
    const port = vi.fn();
    setFetchPort(port as unknown as DynamicRegistryFetchPort);
    const res = await validateModel('opus', 'claude-opus-4-9');
    expect(res.outcome).toBe('skipped');
    expect(res.reason).toBe('no-provider-key');
    expect(port).not.toHaveBeenCalled();
  });
});

describe('validateModel — retrieve providers (anthropic/openai/google/cohere)', () => {
  it('pass on 2xx retrieve', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    setFetchPort(async () => resultWithStatus(200, { id: 'claude-opus-4-9' }));
    const res = await validateModel('opus', 'claude-opus-4-9');
    expect(res.outcome).toBe('pass');
  });

  it('fail on 404 (unknown model id)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    setFetchPort(async () => resultWithStatus(404));
    const res = await validateModel('opus', 'claude-opus-9-9');
    expect(res.outcome).toBe('fail');
    expect(res.reason).toBe('http-404');
  });

  it('fail on 403 (region/entitlement block)', async () => {
    process.env.OPENAI_API_KEY = 'ok';
    setFetchPort(async () => resultWithStatus(403));
    const res = await validateModel('gpt-5', 'gpt-5.9');
    expect(res.outcome).toBe('fail');
  });

  it('skipped on 429 (rate limit — not the model fault)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    setFetchPort(async () => resultWithStatus(429));
    const res = await validateModel('opus', 'claude-opus-4-9');
    expect(res.outcome).toBe('skipped');
  });

  it('skipped on 5xx (provider down)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    setFetchPort(async () => resultWithStatus(503));
    const res = await validateModel('opus', 'claude-opus-4-9');
    expect(res.outcome).toBe('skipped');
  });

  it('skipped when the port throws (network/timeout)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    setFetchPort(async () => {
      throw new Error('timeout');
    });
    const res = await validateModel('opus', 'claude-opus-4-9');
    expect(res.outcome).toBe('skipped');
    expect(res.reason).toBe('probe-threw');
  });

  it('hits the per-model retrieve URL (not the bare list)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    const port = vi.fn(async () => resultWithStatus(200));
    setFetchPort(port as unknown as DynamicRegistryFetchPort);
    await validateModel('opus', 'claude-opus-4-9');
    expect(port).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/models/claude-opus-4-9',
      expect.objectContaining({ method: 'GET', timeoutMs: 5000 }),
    );
  });

  it('carries the google key as a ?key= query param on retrieve', async () => {
    process.env.GOOGLE_AI_API_KEY = 'gkey';
    const port = vi.fn(async () => resultWithStatus(200));
    setFetchPort(port as unknown as DynamicRegistryFetchPort);
    await validateModel('gemini-pro', 'gemini-3.0-pro');
    const url = (port.mock.calls[0]?.[0] ?? '') as string;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.0-pro?key=gkey',
    );
  });

  it('strips cohere `?endpoint=` before appending the id', async () => {
    process.env.COHERE_API_KEY = 'ck';
    const port = vi.fn(async () => resultWithStatus(200));
    setFetchPort(port as unknown as DynamicRegistryFetchPort);
    await validateModel('cohere-embed', 'embed-v5.0');
    const url = (port.mock.calls[0]?.[0] ?? '') as string;
    expect(url).toBe('https://api.cohere.com/v1/models/embed-v5.0');
  });
});

describe('validateModel — membership providers (deepseek/elevenlabs)', () => {
  it('pass when the candidate is present in the re-fetched list', async () => {
    process.env.DEEPSEEK_API_KEY = 'dk';
    setFetchPort(async () =>
      resultWithStatus(200, {
        data: [{ id: 'deepseek-chat' }, { id: 'deepseek-chat-v3' }],
      }),
    );
    const res = await validateModel('deepseek-chat', 'deepseek-chat-v3');
    expect(res.outcome).toBe('pass');
    expect(res.reason).toBe('list-membership');
  });

  it('fail when the candidate is absent from a reachable list', async () => {
    process.env.DEEPSEEK_API_KEY = 'dk';
    setFetchPort(async () =>
      resultWithStatus(200, { data: [{ id: 'deepseek-chat' }] }),
    );
    const res = await validateModel('deepseek-chat', 'deepseek-chat-v9');
    expect(res.outcome).toBe('fail');
    expect(res.reason).toBe('absent-from-list');
  });

  it('pass for elevenlabs when present', async () => {
    process.env.ELEVENLABS_API_KEY = 'ek';
    setFetchPort(async () =>
      resultWithStatus(200, [
        { model_id: 'eleven_v3' },
        { model_id: 'eleven_v4' },
      ]),
    );
    const res = await validateModel('eleven-tts', 'eleven_v4');
    expect(res.outcome).toBe('pass');
  });

  it('skipped when the membership list is unreachable (5xx)', async () => {
    process.env.DEEPSEEK_API_KEY = 'dk';
    setFetchPort(async () => resultWithStatus(503));
    const res = await validateModel('deepseek-chat', 'deepseek-chat-v3');
    expect(res.outcome).toBe('skipped');
  });

  it('skipped when the membership list JSON fails to parse', async () => {
    process.env.DEEPSEEK_API_KEY = 'dk';
    setFetchPort(async () => ({
      status: 200,
      ok: true,
      headers: {},
      json: async () => {
        throw new Error('bad json');
      },
      text: async () => '',
    }));
    const res = await validateModel('deepseek-chat', 'deepseek-chat-v3');
    expect(res.outcome).toBe('skipped');
    expect(res.reason).toBe('probe-parse-failed');
  });
});

describe('validateModel — never throws', () => {
  it('always resolves to a ValidateResult', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk';
    setFetchPort(async () => {
      throw new Error('boom');
    });
    await expect(validateModel('opus', 'claude-opus-4-9')).resolves.toEqual(
      expect.objectContaining({ outcome: 'skipped' }),
    );
  });
});
