/**
 * Input-validation coverage for createBaseConnector.
 * The base test file covers output-schema validation only; this file fills
 * the gap by exercising req.inputSchema across positive + negative cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { createBaseConnector, type ConnectorConfig } from '../base-connector.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseConfig: ConnectorConfig = {
  id: 'iv-test',
  displayName: 'Input Validation Test',
  baseUrl: 'https://api.example.test',
  retry: { maxAttempts: 1, initialDelayMs: 1 },
  timeoutMs: 5_000,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1 });
});

const inputSchema = z.object({
  amount: z.number().int().positive(),
  ref: z.string().min(1),
});

describe('createBaseConnector — input Zod validation', () => {
  it('rejects body before any fetch is made', async () => {
    const fetchMock = vi.fn();
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    const out = await connector.call({
      path: '/x',
      method: 'POST',
      body: { amount: -5, ref: 'r' },
      inputSchema,
    });

    expect(out.kind).toBe('validation-failed');
    if (out.kind === 'validation-failed') {
      expect(out.issue).toBeTruthy();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects body when required field missing', async () => {
    const fetchMock = vi.fn();
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    const out = await connector.call({
      path: '/x',
      method: 'POST',
      // @ts-expect-error testing runtime guard
      body: { amount: 10 },
      inputSchema,
    });

    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects body when field has wrong type', async () => {
    const fetchMock = vi.fn();
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    const out = await connector.call({
      path: '/x',
      method: 'POST',
      // @ts-expect-error testing runtime guard
      body: { amount: 'ten', ref: 'r' },
      inputSchema,
    });

    expect(out.kind).toBe('validation-failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes valid body through to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    const out = await connector.call({
      path: '/x',
      method: 'POST',
      body: { amount: 25, ref: 'lease-7' },
      inputSchema,
    });

    expect(out.kind).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips validation when body is undefined even if schema given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    const out = await connector.call({
      path: '/x',
      method: 'GET',
      inputSchema,
    });

    expect(out.kind).toBe('ok');
  });
});

describe('createBaseConnector — output validation w/ null body', () => {
  it('returns validation-failed when output schema requires non-null but body is null', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    const out = await connector.call({
      path: '/x',
      method: 'GET',
      outputSchema: z.object({ id: z.string() }),
    });

    expect(out.kind).toBe('validation-failed');
  });

  it('accepts null/empty body when no output schema is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.data).toBeNull();
    }
  });

  it('accepts non-JSON body when no output schema (treats as null)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('not-json-text', { status: 200 }));
    const connector = createBaseConnector({ config: baseConfig, fetch: fetchMock });

    const out = await connector.call({ path: '/x', method: 'GET' });

    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') {
      expect(out.data).toBeNull();
    }
  });
});
