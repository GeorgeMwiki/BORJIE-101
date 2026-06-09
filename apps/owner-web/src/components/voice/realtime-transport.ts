'use client';

/**
 * realtime-transport.ts — WebSocket transport for the gateway voice WS
 * (`/api/v1/brain/voice/stream`), in front of the Borjie brain.
 *
 * THE BACKEND IS THE CONTRACT. This client is reconciled byte-for-byte
 * against `services/api-gateway/src/routes/brain-voice.hono.ts`
 * (`routeInboundClientFrame` for inbound, `BridgeOutboundEvent` for
 * outbound). The shapes below are NOT assumptions — they mirror that file
 * exactly. The contract test in
 * `__tests__/realtime-transport.contract.test.ts` drives a fake socket
 * through both halves so this can never silently drift again.
 *
 *   Connect   wss(s)://<gateway-host>/api/v1/brain/voice/stream?token=<jwt>
 *             The browser WebSocket API cannot set an Authorization
 *             header, so the Supabase access token rides the `token`
 *             query param AND the first JSON frame
 *             ({ type: 'auth', token, locale }) — the gateway kicks the
 *             handshake from whichever arrives (see `attachBrainVoiceWebSocket`).
 *
 *   Up        JSON TEXT frames (the gateway JSON-parses every inbound frame
 *             and DROPS raw binary):
 *               { type: 'auth', token, locale }            handshake
 *               { type: 'audio', base64, sampleRate,       mic PCM16 LE,
 *                 mimeType }                                base64-encoded
 *               { type: 'text', text }                      typed turn
 *               { type: 'tool_result', callId?, name,       client tool reply
 *                 output }
 *               { type: 'close' }                           hang up
 *
 *   Down      JSON TEXT frames, discriminated by `kind` (BridgeOutboundEvent):
 *               { kind: 'ready', sessionId, locale }        session open
 *               { kind: 'audio', base64, sampleRate,        model audio →
 *                 isFinal }                                  base64-decode + play
 *               { kind: 'transcript', text, isFinal,        ASR / reply text
 *                 speaker }
 *               { kind: 'tool_call', name, status }         action lifecycle
 *               { kind: 'error', code, message }            server-side fault
 *             Unknown `kind`s are ignored (forward-compatible).
 *
 * Discipline:
 *   - Immutable event objects; no input mutation.
 *   - <50 lines per function; nesting <4.
 *   - No console.log — faults surface via the `onError` handler.
 */

import { z } from 'zod';
import { API_BASE } from '@/lib/brain-api';
import { pcmToBase64, base64ToPcm } from './pcm-base64';
import { CAPTURE_SAMPLE_RATE_HZ } from './realtime-audio';

/**
 * Default mic uplink rate the bridge expects (16 kHz mono PCM16 LE). Single
 * source of truth is `CAPTURE_SAMPLE_RATE_HZ` — the rate `MicCapture` actually
 * captures at — so the wire label can never drift from the real PCM rate.
 */
export const VOICE_UPLINK_SAMPLE_RATE_HZ = CAPTURE_SAMPLE_RATE_HZ;

/**
 * Discriminated outbound events the backend sends — mirrors
 * `BridgeOutboundEvent` in brain-voice.hono.ts (discriminated on `kind`).
 * Audio frames are surfaced to the player via `onAudio`; everything else is
 * a control event handed to `onEvent`.
 */
export type VoiceServerEvent =
  | { readonly kind: 'ready'; readonly sessionId: string; readonly locale: 'sw' | 'en' }
  | {
      readonly kind: 'transcript';
      readonly text: string;
      readonly isFinal: boolean;
      readonly speaker: 'user' | 'agent';
    }
  | {
      readonly kind: 'tool_call';
      readonly name: string;
      readonly status: 'started' | 'ok' | 'error';
    }
  | { readonly kind: 'error'; readonly code: string; readonly message: string };

/**
 * The audio event is carried separately (decoded straight to the player), so
 * it is NOT part of `VoiceServerEvent` — but its wire shape is validated by
 * the same `kind`-discriminated schema below.
 */
interface VoiceAudioEvent {
  readonly kind: 'audio';
  readonly base64: string;
  readonly sampleRate: number;
  readonly isFinal: boolean;
}

// ── zod schemas: validate every untrusted inbound frame ──────────────────

const readyEventSchema = z.object({
  kind: z.literal('ready'),
  sessionId: z.string(),
  locale: z.enum(['sw', 'en']),
});

const audioEventSchema = z.object({
  kind: z.literal('audio'),
  base64: z.string(),
  sampleRate: z.number(),
  isFinal: z.boolean(),
});

const transcriptEventSchema = z.object({
  kind: z.literal('transcript'),
  text: z.string(),
  isFinal: z.boolean(),
  speaker: z.enum(['user', 'agent']),
});

const toolCallEventSchema = z.object({
  kind: z.literal('tool_call'),
  name: z.string(),
  status: z.enum(['started', 'ok', 'error']),
});

const errorEventSchema = z.object({
  kind: z.literal('error'),
  code: z.string(),
  message: z.string(),
});

const serverFrameSchema = z.discriminatedUnion('kind', [
  readyEventSchema,
  audioEventSchema,
  transcriptEventSchema,
  toolCallEventSchema,
  errorEventSchema,
]);

/** A parsed inbound frame: either a control event or a decoded audio frame. */
type ParsedInbound =
  | { readonly channel: 'event'; readonly event: VoiceServerEvent }
  | { readonly channel: 'audio'; readonly pcm: ArrayBuffer; readonly isFinal: boolean };

export interface VoiceTransportHandlers {
  /** Fired once the socket is open and the auth frame has been sent. */
  readonly onOpen: () => void;
  /**
   * Inbound model audio frame (PCM16 LE) — hand straight to the player.
   * `isFinal` is true on the backend's turn-end marker (which may carry an
   * empty buffer), letting the caller return from `speaking` to `live`.
   */
  readonly onAudio: (pcm: ArrayBuffer, isFinal: boolean) => void;
  /** Inbound parsed control event. */
  readonly onEvent: (event: VoiceServerEvent) => void;
  /** Transport-level failure or unexpected close. */
  readonly onError: (code: string) => void;
  /** Socket closed (clean or otherwise) — session is over. */
  readonly onClose: () => void;
}

/** True when the WebSocket constructor exists in this runtime. */
export function isWebSocketSupported(): boolean {
  return typeof WebSocket !== 'undefined';
}

/** Derive the ws/wss voice URL from the configured http(s) gateway base. */
export function buildVoiceSocketUrl(token: string): string {
  const trimmed = API_BASE.replace(/\/+$/, '');
  const wsBase = trimmed.replace(/^http(s?):\/\//i, (_m, s) => `ws${s}://`);
  const query = `token=${encodeURIComponent(token)}`;
  return `${wsBase}/api/v1/brain/voice/stream?${query}`;
}

/**
 * Parse one inbound TEXT frame into a control event or a decoded audio frame.
 * Returns null for bad JSON, an unknown `kind`, or a base64 audio payload that
 * fails to decode. Pure + total — never throws.
 */
export function parseServerFrame(raw: string): ParsedInbound | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = serverFrameSchema.safeParse(value);
  if (!parsed.success) return null;
  const frame = parsed.data;
  if (frame.kind === 'audio') return decodeAudioFrame(frame);
  return { channel: 'event', event: frame };
}

/**
 * Decode a model audio frame to PCM16. The backend sends an EMPTY-base64
 * `isFinal:true` frame as the turn-end marker (see `routeGeminiServerFrame`'s
 * `turnComplete` branch), so an empty payload is forwarded as a zero-length
 * buffer rather than dropped — that is how the caller learns the turn ended.
 * A non-empty payload that fails to base64-decode is dropped (returns null).
 */
function decodeAudioFrame(frame: VoiceAudioEvent): ParsedInbound | null {
  if (frame.base64.length === 0) {
    return { channel: 'audio', pcm: new ArrayBuffer(0), isFinal: frame.isFinal };
  }
  const pcm = base64ToPcm(frame.base64);
  return pcm ? { channel: 'audio', pcm, isFinal: frame.isFinal } : null;
}

/**
 * Thin lifecycle wrapper over a single duplex voice WebSocket. One
 * instance == one session; call `close()` to end it (idempotent).
 */
export class VoiceTransport {
  private socket: WebSocket | null = null;
  private closed = false;

  constructor(private readonly handlers: VoiceTransportHandlers) {}

  open(token: string, locale: 'sw' | 'en'): void {
    if (!isWebSocketSupported()) {
      this.handlers.onError('websocket_unsupported');
      return;
    }
    let socket: WebSocket;
    try {
      socket = new WebSocket(buildVoiceSocketUrl(token));
    } catch {
      this.handlers.onError('websocket_open_failed');
      return;
    }
    socket.binaryType = 'arraybuffer';
    this.socket = socket;
    this.bind(socket, token, locale);
  }

  private bind(socket: WebSocket, token: string, locale: 'sw' | 'en'): void {
    socket.onopen = () => {
      // Backend handshake frame is `type:'auth'` (NOT 'handshake').
      this.send(JSON.stringify({ type: 'auth', token, locale }));
      this.handlers.onOpen();
    };
    socket.onmessage = (event) => this.route(event.data);
    socket.onerror = () => {
      if (!this.closed) this.handlers.onError('websocket_error');
    };
    socket.onclose = () => {
      this.socket = null;
      this.handlers.onClose();
    };
  }

  private route(data: unknown): void {
    // The backend speaks JSON text on BOTH channels (audio rides a JSON
    // `{kind:'audio', base64}` frame). A non-string frame is unexpected;
    // ignore it rather than mis-routing raw bytes to the player.
    if (typeof data !== 'string') return;
    const parsed = parseServerFrame(data);
    if (!parsed) return;
    if (parsed.channel === 'audio') {
      this.handlers.onAudio(parsed.pcm, parsed.isFinal);
    } else {
      this.handlers.onEvent(parsed.event);
    }
  }

  /**
   * Send a mic frame as the backend-shaped JSON audio frame: base64(PCM16 LE)
   * with sample-rate + mime so the bridge can forward it to the realtime
   * upstream. No-op unless the socket is OPEN.
   */
  sendAudio(pcm: ArrayBuffer, sampleRate = VOICE_UPLINK_SAMPLE_RATE_HZ): void {
    const base64 = pcmToBase64(pcm);
    if (base64.length === 0) return;
    this.send(
      JSON.stringify({
        type: 'audio',
        base64,
        sampleRate,
        mimeType: 'audio/pcm',
      }),
    );
  }

  /** Send a typed turn (e.g. composer text) to the model. */
  sendText(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    this.send(JSON.stringify({ type: 'text', text: trimmed }));
  }

  private send(payload: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(payload);
  }

  close(): void {
    this.closed = true;
    // Best-effort graceful close frame, then tear the socket down.
    try {
      this.send(JSON.stringify({ type: 'close' }));
      this.socket?.close();
    } catch {
      /* already closing */
    }
    this.socket = null;
  }
}
