/**
 * Unit tests for the Gemini Live client + adapter. All tests are hermetic:
 * - The WebSocket is replaced by a hand-rolled fake.
 * - The Gemini API key is unset for stub-mode tests, set for live-mode tests.
 *
 * No network. No console.log. No mutation of provider state across tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createGeminiLiveClient,
  type WebSocketEventListener,
  type WebSocketLike,
} from '../gemini-live-client.js';
import { adaptServerEvent } from '../streaming-adapter.js';
import { loadConfig, isGeminiLiveLive, DEFAULT_GEMINI_VOICE_MODEL } from '../config.js';

// =============================================================================
// Fake WebSocket — captures sent frames and lets the test push frames back.
// =============================================================================
interface FakeSocket extends WebSocketLike {
  readonly sent: string[];
  fireOpen(): void;
  fireMessage(data: unknown): void;
  fireError(message: string): void;
  fireClose(): void;
}

function createFakeSocket(): FakeSocket {
  const listeners: Record<string, WebSocketEventListener[]> = {
    open: [],
    message: [],
    error: [],
    close: [],
  };
  const sent: string[] = [];
  const sock: FakeSocket = {
    readyState: 0,
    send(data: string): void {
      sent.push(data);
    },
    close(): void {
      sock.readyState = 3;
      for (const l of listeners['close'] ?? []) (l as () => void)();
    },
    addEventListener(event: string, listener: WebSocketEventListener): void {
      (listeners[event] ??= []).push(listener);
    },
    removeEventListener(event: string, listener: WebSocketEventListener): void {
      const arr = listeners[event];
      if (!arr) return;
      const idx = arr.indexOf(listener);
      if (idx >= 0) arr.splice(idx, 1);
    },
    fireOpen(): void {
      sock.readyState = 1;
      for (const l of listeners['open'] ?? []) (l as () => void)();
    },
    fireMessage(data: unknown): void {
      for (const l of listeners['message'] ?? []) {
        (l as (evt: { data: string }) => void)({ data: JSON.stringify(data) });
      }
    },
    fireError(message: string): void {
      for (const l of listeners['error'] ?? []) {
        (l as (evt: { message?: string }) => void)({ message });
      }
    },
    fireClose(): void {
      sock.close();
    },
    sent,
  };
  return sock;
}

// =============================================================================
// Config tests
// =============================================================================
describe('gemini-live config', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  it('returns undefined apiKey when GEMINI_API_KEY is unset', () => {
    delete process.env['GEMINI_API_KEY'];
    const config = loadConfig();
    expect(config.apiKey).toBeUndefined();
    expect(isGeminiLiveLive(config)).toBe(false);
  });

  it('reads apiKey when present and applies default model', () => {
    process.env['GEMINI_API_KEY'] = 'test-key';
    delete process.env['GEMINI_VOICE_MODEL'];
    const config = loadConfig();
    expect(config.apiKey).toBe('test-key');
    expect(config.model).toBe(DEFAULT_GEMINI_VOICE_MODEL);
    expect(isGeminiLiveLive(config)).toBe(true);
  });

  it('honours GEMINI_VOICE_MODEL override', () => {
    process.env['GEMINI_API_KEY'] = 'test-key';
    process.env['GEMINI_VOICE_MODEL'] = 'gemini-custom';
    const config = loadConfig();
    expect(config.model).toBe('gemini-custom');
  });
});

// =============================================================================
// Adapter tests — pure-function, no I/O
// =============================================================================
describe('adaptServerEvent', () => {
  const sessionId = 'sess-1';

  it('translates input transcription frames', () => {
    const out = adaptServerEvent(
      { serverContent: { inputTranscription: { text: 'habari', finished: false } } },
      sessionId,
      'sw',
    );
    expect(out.transcripts).toHaveLength(1);
    expect(out.transcripts[0]?.text).toBe('habari');
    expect(out.transcripts[0]?.isFinal).toBe(false);
    expect(out.audio).toHaveLength(0);
  });

  it('translates inline audio chunks', () => {
    const out = adaptServerEvent(
      {
        serverContent: {
          modelTurn: {
            parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AAAA' } }],
          },
        },
      },
      sessionId,
      'sw',
    );
    expect(out.audio).toHaveLength(1);
    expect(out.audio[0]?.audio.sampleRate).toBe(24000);
    expect(out.audio[0]?.isFinal).toBe(false);
  });

  it('emits a final-audio flush on turnComplete', () => {
    const out = adaptServerEvent(
      { serverContent: { turnComplete: true } },
      sessionId,
      'sw',
    );
    expect(out.turnComplete).toBe(true);
    expect(out.audio.at(-1)?.isFinal).toBe(true);
  });

  it('surfaces error frames as Error', () => {
    const out = adaptServerEvent({ error: { message: 'quota' } }, sessionId, 'sw');
    expect(out.error).toBeInstanceOf(Error);
    expect(out.error?.message).toMatch(/quota/);
  });

  it('returns empty envelope on unrelated frames', () => {
    const out = adaptServerEvent({ setupComplete: {} }, sessionId, 'sw');
    expect(out.transcripts).toHaveLength(0);
    expect(out.audio).toHaveLength(0);
    expect(out.error).toBeNull();
  });
});

// =============================================================================
// Client tests — stub mode + injected WebSocket
// =============================================================================
describe('createGeminiLiveClient', () => {
  const original = { ...process.env };
  beforeEach(() => {
    delete process.env['GEMINI_API_KEY'];
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it('falls back to stub when GEMINI_API_KEY is missing', async () => {
    const client = createGeminiLiveClient();
    const handle = await client.startSession({ tenantId: 't1', language: 'sw' });
    expect(handle.sessionId).toMatch(/^gemini-live:t1:sw:/);

    const transcripts: string[] = [];
    for await (const t of handle.transcripts()) {
      transcripts.push(t.text);
      if (t.isFinal) break;
    }
    expect(transcripts).toEqual(['[gemini-stub] partial', '[gemini-stub] final']);
    await handle.close();
  });

  it('opens a live session and streams an adapted transcript', async () => {
    process.env['GEMINI_API_KEY'] = 'fake-key';
    const sock = createFakeSocket();
    const client = createGeminiLiveClient({
      websocketFactory: () => sock,
    });

    const sessionPromise = client.startSession({ tenantId: 't1', language: 'sw' });
    sock.fireOpen();
    const handle = await sessionPromise;

    // Setup frame was sent.
    expect(sock.sent[0]).toMatch(/"setup":\{/);
    expect(sock.sent[0]).toMatch(DEFAULT_GEMINI_VOICE_MODEL);

    // Push a transcript frame in.
    sock.fireMessage({
      serverContent: { inputTranscription: { text: 'Tumemadini', finished: true } },
    });

    const iter = handle.transcripts()[Symbol.asyncIterator]();
    const next = await iter.next();
    expect(next.value?.text).toBe('Tumemadini');
    expect(next.value?.isFinal).toBe(true);

    await handle.close();
  });

  it('serialises pushAudio frames as base64 mediaChunks', async () => {
    process.env['GEMINI_API_KEY'] = 'fake-key';
    const sock = createFakeSocket();
    const client = createGeminiLiveClient({
      websocketFactory: () => sock,
    });
    const sessionPromise = client.startSession({ tenantId: 't1', language: 'sw' });
    sock.fireOpen();
    const handle = await sessionPromise;

    await handle.pushAudio({
      bytes: new Uint8Array([1, 2, 3, 4]),
      mimeType: 'audio/pcm',
      sampleRate: 16000,
    });

    const frame = sock.sent.at(-1);
    expect(frame).toContain('"realtimeInput"');
    expect(frame).toContain('"data":"AQIDBA=="'); // base64 of [1,2,3,4]
    await handle.close();
  });

  it('propagates websocket errors to transcript + audio queues', async () => {
    process.env['GEMINI_API_KEY'] = 'fake-key';
    const sock = createFakeSocket();
    const client = createGeminiLiveClient({
      websocketFactory: () => sock,
    });
    const sessionPromise = client.startSession({ tenantId: 't1', language: 'sw' });
    sock.fireOpen();
    const handle = await sessionPromise;

    sock.fireError('boom');

    const iter = handle.transcripts()[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow(/boom/);
  });
});
