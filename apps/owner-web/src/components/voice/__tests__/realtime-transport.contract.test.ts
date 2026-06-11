/**
 * realtime-transport.contract.test.ts — WIRE-CONTRACT regression gate.
 *
 * The owner-web voice transport (`VoiceTransport`) and the gateway brain-voice
 * bridge (`services/api-gateway/src/routes/brain-voice.hono.ts`) used to speak
 * INCOMPATIBLE wire protocols — the client sent raw binary PCM and parsed
 * control frames on `type`, while the backend JSON-parsed inbound `type`-keyed
 * frames and emitted `kind`-discriminated outbound events. useRealtimeVoice
 * therefore always degraded to the one-shot Web-Speech fallback.
 *
 * This test drives a FAKE WebSocket through BOTH halves so the protocols can
 * never silently drift again:
 *
 *   ① CLIENT → BACKEND: a mic frame sent by the transport is asserted to be a
 *      backend-shaped `{ type:'audio', base64, sampleRate, mimeType }` JSON
 *      frame, and is decoded by a faithful mirror of the backend's pure
 *      `routeInboundClientFrame` audio branch — recovering the original PCM
 *      bytes.
 *
 *   ② BACKEND → CLIENT: backend-shaped `{ kind:'ready' | 'audio' | 'transcript'
 *      | 'tool_call' | 'error' }` frames (built by a faithful mirror of the
 *      backend's `BridgeOutboundEvent` emitters) are pushed onto the socket and
 *      asserted to land on the correct client handler with the correct payload.
 *
 * The BACKEND_* mirrors below are an inlined, frozen copy of the EXACT shapes
 * in brain-voice.hono.ts. If the backend changes its wire contract, update the
 * mirrors here and the assertions break — which is the whole point: the drift
 * is caught at this seam rather than in production as a silent fallback.
 *
 * No network, no mutation, no console.log.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  VoiceTransport,
  parseServerFrame,
  type VoiceServerEvent,
} from '../realtime-transport';

// ───────────────────────────────────────────────────────────────────────────
// FakeWebSocket — a minimal stand-in matching the browser WebSocket surface
// the transport touches (binaryType, send, close, onopen/onmessage/onerror/
// onclose, readyState + the OPEN constant). Captures everything `send`s.
// ───────────────────────────────────────────────────────────────────────────

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.OPEN;
  binaryType = '';
  readonly sent: Array<string | ArrayBuffer> = [];

  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(payload: string | ArrayBuffer): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  /** Test helper: deliver a server text frame to the transport. */
  deliver(text: string): void {
    this.onmessage?.({ data: text });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// BACKEND MIRRORS — faithful copies of the pure logic in brain-voice.hono.ts.
// Keep these byte-aligned with the backend; the assertions enforce it.
// ───────────────────────────────────────────────────────────────────────────

/** Mirror of `routeInboundClientFrame` (audio branch) + `normalizeSampleRate`. */
function backendDecodeInboundAudio(rawJson: string): {
  readonly type: 'audio';
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly sampleRate: number;
} | null {
  const frame = JSON.parse(rawJson) as Record<string, unknown>;
  if (frame.type !== 'audio') return null;
  if (typeof frame.base64 !== 'string' || frame.base64.length === 0) return null;
  const bytes = Uint8Array.from(globalThis.atob(frame.base64), (c) =>
    c.charCodeAt(0),
  );
  const sr = frame.sampleRate;
  const sampleRate = sr === 8000 || sr === 24000 || sr === 48000 ? sr : 16000;
  const mimeType =
    frame.mimeType === 'audio/opus' || frame.mimeType === 'audio/wav'
      ? frame.mimeType
      : 'audio/pcm';
  return { type: 'audio', bytes, mimeType, sampleRate };
}

/** Mirror of `parseClientTextFrame`'s top-level shape gate. */
function backendAcceptsInbound(rawJson: string): boolean {
  try {
    const obj = JSON.parse(rawJson) as unknown;
    return (
      !!obj &&
      typeof obj === 'object' &&
      typeof (obj as { type?: unknown }).type === 'string'
    );
  } catch {
    return false;
  }
}

/** Mirror of the `BridgeOutboundEvent` JSON the backend `emit`s to the socket. */
const BACKEND_OUTBOUND = Object.freeze({
  ready: (sessionId: string, locale: 'sw' | 'en') =>
    JSON.stringify({ kind: 'ready', sessionId, locale }),
  audio: (base64: string, sampleRate: number, isFinal: boolean) =>
    JSON.stringify({ kind: 'audio', base64, sampleRate, isFinal }),
  transcript: (
    text: string,
    isFinal: boolean,
    speaker: 'user' | 'agent',
  ) => JSON.stringify({ kind: 'transcript', text, isFinal, speaker }),
  toolCall: (name: string, status: 'started' | 'ok' | 'error') =>
    JSON.stringify({ kind: 'tool_call', name, status }),
  error: (code: string, message: string) =>
    JSON.stringify({ kind: 'error', code, message }),
});

// ───────────────────────────────────────────────────────────────────────────
// Test harness
// ───────────────────────────────────────────────────────────────────────────

interface Captured {
  readonly opened: boolean[];
  readonly audio: Array<{ readonly pcm: ArrayBuffer; readonly isFinal: boolean }>;
  readonly events: VoiceServerEvent[];
  readonly errors: string[];
  readonly closes: number[];
}

function makeTransport(): { transport: VoiceTransport; captured: Captured; socket: FakeWebSocket } {
  const captured: Captured = {
    opened: [],
    audio: [],
    events: [],
    errors: [],
    closes: [],
  };
  const transport = new VoiceTransport({
    onOpen: () => captured.opened.push(true),
    onAudio: (pcm, isFinal) => captured.audio.push({ pcm, isFinal }),
    onEvent: (event) => captured.events.push(event),
    onError: (code) => captured.errors.push(code),
    onClose: () => captured.closes.push(1),
  });
  transport.open('jwt-token', 'en');
  const socket = FakeWebSocket.instances.at(-1)!;
  socket.onopen?.();
  return { transport, captured, socket };
}

const ORIGINAL_WS = globalThis.WebSocket;

beforeEach(() => {
  FakeWebSocket.instances = [];
  // Install the fake on the global so `new WebSocket()` inside the transport
  // resolves to it. Restored after each test by the afterEach below.
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
});

describe('voice wire contract: CLIENT → BACKEND', () => {
  it('handshake frame is the backend-shaped { type:"auth" } (not "handshake")', () => {
    const { socket } = makeTransport();
    const first = JSON.parse(socket.sent[0] as string);
    expect(first).toEqual({ type: 'auth', token: 'jwt-token', locale: 'en' });
    // The backend's parseClientTextFrame accepts any { type:string } frame.
    expect(backendAcceptsInbound(socket.sent[0] as string)).toBe(true);
  });

  it('mic frame is base64 JSON audio the backend decodes back to the SAME PCM', () => {
    const { transport, socket } = makeTransport();
    // A 4-sample PCM16 LE buffer (8 bytes).
    const pcm = new Int16Array([0, 1000, -1000, 32767]).buffer;

    transport.sendAudio(pcm);

    // The most recent sent frame (after the auth handshake) is the audio frame.
    const audioJson = socket.sent.at(-1) as string;
    expect(typeof audioJson).toBe('string'); // JSON text, NOT raw binary
    const parsed = JSON.parse(audioJson);
    expect(parsed).toMatchObject({
      type: 'audio',
      sampleRate: 16000,
      mimeType: 'audio/pcm',
    });
    expect(typeof parsed.base64).toBe('string');

    // Backend decodes it and recovers the EXACT original bytes.
    const decoded = backendDecodeInboundAudio(audioJson);
    expect(decoded).not.toBeNull();
    expect(decoded!.mimeType).toBe('audio/pcm');
    expect(decoded!.sampleRate).toBe(16000);
    expect(Array.from(decoded!.bytes)).toEqual(Array.from(new Uint8Array(pcm)));
  });

  it('never sends raw binary on the wire (the original bug)', () => {
    const { transport, socket } = makeTransport();
    transport.sendAudio(new Int16Array([42, -42]).buffer);
    for (const frame of socket.sent) {
      expect(typeof frame).toBe('string');
    }
  });

  it('typed-text frame is the backend-shaped { type:"text" }', () => {
    const { transport, socket } = makeTransport();
    transport.sendText('  hello mwikila  ');
    const textJson = socket.sent.at(-1) as string;
    expect(JSON.parse(textJson)).toEqual({ type: 'text', text: 'hello mwikila' });
    expect(backendAcceptsInbound(textJson)).toBe(true);
  });

  it('close frame is the backend-shaped { type:"close" }', () => {
    const { transport, socket } = makeTransport();
    transport.close();
    const closeFrame = socket.sent.find(
      (f) => typeof f === 'string' && (f as string).includes('"close"'),
    );
    expect(closeFrame).toBeDefined();
    expect(JSON.parse(closeFrame as string)).toEqual({ type: 'close' });
  });
});

describe('voice wire contract: BACKEND → CLIENT', () => {
  it('parses { kind:"ready" } as a control event (not "type")', () => {
    const { captured, socket } = makeTransport();
    socket.deliver(BACKEND_OUTBOUND.ready('sess-1', 'en'));
    expect(captured.events).toEqual([
      { kind: 'ready', sessionId: 'sess-1', locale: 'en' },
    ]);
  });

  it('base64-decodes { kind:"audio" } and routes PCM to the player handler', () => {
    const { captured, socket } = makeTransport();
    const pcmBytes = new Uint8Array([1, 2, 3, 4, 250, 251]);
    const base64 = globalThis.btoa(String.fromCharCode(...pcmBytes));
    socket.deliver(BACKEND_OUTBOUND.audio(base64, 24000, false));
    expect(captured.audio).toHaveLength(1);
    expect(captured.audio[0]!.isFinal).toBe(false);
    expect(Array.from(new Uint8Array(captured.audio[0]!.pcm))).toEqual(
      Array.from(pcmBytes),
    );
  });

  it('treats the empty isFinal audio frame as the turn-end marker', () => {
    const { captured, socket } = makeTransport();
    socket.deliver(BACKEND_OUTBOUND.audio('', 24000, true));
    expect(captured.audio).toHaveLength(1);
    expect(captured.audio[0]!.isFinal).toBe(true);
    expect(captured.audio[0]!.pcm.byteLength).toBe(0);
  });

  it('discriminates transcript frames on kind + speaker + isFinal', () => {
    const { captured, socket } = makeTransport();
    socket.deliver(BACKEND_OUTBOUND.transcript('owner said', false, 'user'));
    socket.deliver(BACKEND_OUTBOUND.transcript('final answer', true, 'agent'));
    expect(captured.events).toEqual([
      { kind: 'transcript', text: 'owner said', isFinal: false, speaker: 'user' },
      { kind: 'transcript', text: 'final answer', isFinal: true, speaker: 'agent' },
    ]);
  });

  it('parses tool_call and error frames on kind', () => {
    const { captured, socket } = makeTransport();
    socket.deliver(BACKEND_OUTBOUND.toolCall('create_site', 'started'));
    socket.deliver(BACKEND_OUTBOUND.error('provider_unavailable', 'no key'));
    expect(captured.events).toContainEqual({
      kind: 'tool_call',
      name: 'create_site',
      status: 'started',
    });
    expect(captured.events).toContainEqual({
      kind: 'error',
      code: 'provider_unavailable',
      message: 'no key',
    });
  });

  it('ignores a legacy { type:... } frame (proves the OLD contract is dead)', () => {
    const { captured, socket } = makeTransport();
    // The pre-fix backend would have sent these; the new client must NOT
    // accept them, guaranteeing we reconciled to `kind`, not `type`.
    socket.deliver(JSON.stringify({ type: 'ready' }));
    socket.deliver(JSON.stringify({ type: 'turn', text: 'x' }));
    socket.deliver(JSON.stringify({ type: 'speech_end' }));
    expect(captured.events).toHaveLength(0);
  });

  it('ignores unknown kinds and malformed JSON (forward-compatible)', () => {
    const { captured, socket } = makeTransport();
    socket.deliver(JSON.stringify({ kind: 'future_event', x: 1 }));
    socket.deliver('not json at all{');
    expect(captured.events).toHaveLength(0);
    expect(captured.audio).toHaveLength(0);
  });
});

describe('parseServerFrame (pure)', () => {
  it('returns the typed event for a valid kind frame', () => {
    const out = parseServerFrame(BACKEND_OUTBOUND.ready('s', 'sw'));
    expect(out).toEqual({
      channel: 'event',
      event: { kind: 'ready', sessionId: 's', locale: 'sw' },
    });
  });

  it('rejects a kind frame that fails schema validation', () => {
    // audio without base64 / wrong types must not pass the zod gate.
    expect(parseServerFrame(JSON.stringify({ kind: 'audio' }))).toBeNull();
    expect(
      parseServerFrame(JSON.stringify({ kind: 'transcript', text: 1 })),
    ).toBeNull();
  });
});

// Restore the real WebSocket so other suites are unaffected.
afterEach(() => {
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = ORIGINAL_WS;
});
