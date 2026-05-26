/**
 * capture-client tests — POST contract, error containment,
 * sendBeacon fallback on unload.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  buildBatch,
  createCaptureClient,
} from '../capture-client/capture-client.js';
import type { CaptureBatch, CaptureEvent } from '../types.js';

function makeEvent(): CaptureEvent {
  return {
    kind: 'field_change',
    emittedAt: '2026-01-01T00:00:00.000Z',
    sessionId: 'sess_1',
    tabId: 'tab_1',
    fieldId: 'company_name',
    value: {
      tabId: 'tab_1',
      fieldId: 'company_name',
      capturedAt: '2026-01-01T00:00:00.000Z',
      valuePlaintext: 'Jamhuri Mining Co',
      piiKind: 'none',
    },
  };
}

function makeBatch(events: ReadonlyArray<CaptureEvent>): CaptureBatch {
  return buildBatch({
    tenantId: 'tenant_1',
    userId: 'user_1',
    sessionId: 'sess_1',
    events,
  });
}

describe('createCaptureClient', () => {
  it('POSTs to the default endpoint with credentials + JSON body', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init !== undefined ? { init } : {}) });
      return new Response('{}', { status: 200 });
    });
    const client = createCaptureClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.send(makeBatch([makeEvent()]));
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe('/api/v1/session-mirror/capture');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.credentials).toBe('include');
    expect(
      (calls[0]?.init?.headers as Record<string, string> | undefined)?.[
        'Content-Type'
      ],
    ).toBe('application/json');
  });

  it('does not POST when the batch is empty', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = createCaptureClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.send(makeBatch([]));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('swallows fetch failures', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network');
    });
    const client = createCaptureClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.send(makeBatch([makeEvent()]))).resolves.toBeUndefined();
  });

  it('uses sendBeacon on unload when available', () => {
    const beaconCalls: Array<{ url: string; size: number }> = [];
    const sendBeacon = (url: string, data: Blob): boolean => {
      beaconCalls.push({ url, size: data.size });
      return true;
    };
    const client = createCaptureClient({
      endpoint: '/x',
      sendBeacon,
    });
    client.sendOnUnload(makeBatch([makeEvent()]));
    expect(beaconCalls.length).toBe(1);
    expect(beaconCalls[0]?.url).toBe('/x');
    expect(beaconCalls[0]?.size).toBeGreaterThan(0);
  });

  it('honors a custom endpoint', async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url);
      return new Response('{}', { status: 200 });
    });
    const client = createCaptureClient({
      endpoint: '/api/custom/capture',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await client.send(makeBatch([makeEvent()]));
    expect(calls).toEqual(['/api/custom/capture']);
  });
});
