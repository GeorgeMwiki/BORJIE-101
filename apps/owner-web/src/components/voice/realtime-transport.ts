'use client';

/**
 * realtime-transport.ts — WebSocket transport for the gateway voice WS
 * (`/api/v1/brain/voice/stream`), in front of the Borjie brain.
 *
 * The endpoint is NOT live in this environment, so the wire CONTRACT is
 * an explicit, defensive assumption — kept in one place so it is trivial
 * to reconcile with the gateway once it ships:
 *
 *   Connect   wss(s)://<gateway-host>/api/v1/brain/voice/stream?token=<jwt>
 *             The browser WebSocket API cannot set an Authorization
 *             header, so the Supabase access token is forwarded BOTH as a
 *             `token` query param AND as the first JSON frame
 *             ({ type: 'handshake', token, locale }) — covering either
 *             gateway design without a second round-trip.
 *
 *   Up        Binary frames: mono PCM16 LE @ VOICE_SAMPLE_RATE_HZ (mic).
 *
 *   Down      Binary frames: model audio (same PCM16 LE format) → play.
 *             Text frames: JSON control events, discriminated by `type`:
 *               { type: 'ready' }                         session open
 *               { type: 'transcript', text, final }       live ASR text
 *               { type: 'speech_start' | 'speech_end' }   model turn edges
 *               { type: 'turn', text }                     final reply text
 *               { type: 'error', code }                    server-side fault
 *             Unknown event types are ignored (forward-compatible).
 *
 * Discipline:
 *   - Immutable event objects; no input mutation.
 *   - <50 lines per function; nesting <4.
 *   - No console.log — faults surface via the `onError` handler.
 */

import { API_BASE } from '@/lib/brain-api';

/** Discriminated control events the server may send on the text channel. */
export type VoiceServerEvent =
  | { readonly type: 'ready' }
  | { readonly type: 'transcript'; readonly text: string; readonly final: boolean }
  | { readonly type: 'speech_start' }
  | { readonly type: 'speech_end' }
  | { readonly type: 'turn'; readonly text: string }
  | { readonly type: 'error'; readonly code: string };

export interface VoiceTransportHandlers {
  /** Fired once the socket is open and the handshake frame is sent. */
  readonly onOpen: () => void;
  /** Inbound model audio frame (binary) — hand straight to the player. */
  readonly onAudio: (pcm: ArrayBuffer) => void;
  /** Inbound parsed control event (text channel). */
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

function parseServerEvent(raw: string): VoiceServerEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const type = (value as { type?: unknown }).type;
  return isKnownEvent(value, type) ? (value as VoiceServerEvent) : null;
}

function isKnownEvent(value: object, type: unknown): boolean {
  if (type === 'ready' || type === 'speech_start' || type === 'speech_end') {
    return true;
  }
  if (type === 'error') return typeof (value as { code?: unknown }).code === 'string';
  if (type === 'turn') return typeof (value as { text?: unknown }).text === 'string';
  if (type === 'transcript') {
    return typeof (value as { text?: unknown }).text === 'string';
  }
  return false;
}

async function toArrayBuffer(data: ArrayBuffer | Blob): Promise<ArrayBuffer> {
  return data instanceof Blob ? data.arrayBuffer() : data;
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
      this.send(JSON.stringify({ type: 'handshake', token, locale }));
      this.handlers.onOpen();
    };
    socket.onmessage = (event) => void this.route(event.data);
    socket.onerror = () => {
      if (!this.closed) this.handlers.onError('websocket_error');
    };
    socket.onclose = () => {
      this.socket = null;
      this.handlers.onClose();
    };
  }

  private async route(data: unknown): Promise<void> {
    if (typeof data === 'string') {
      const event = parseServerEvent(data);
      if (event) this.handlers.onEvent(event);
      return;
    }
    if (data instanceof ArrayBuffer || data instanceof Blob) {
      this.handlers.onAudio(await toArrayBuffer(data));
    }
  }

  /** Send a binary mic frame (no-op unless the socket is OPEN). */
  sendAudio(pcm: ArrayBuffer): void {
    this.send(pcm);
  }

  private send(payload: string | ArrayBuffer): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(payload);
  }

  /** Tell the server we are interrupting the current model turn (barge-in). */
  bargeIn(): void {
    this.send(JSON.stringify({ type: 'barge_in' }));
  }

  close(): void {
    this.closed = true;
    try {
      this.socket?.close();
    } catch {
      /* already closing */
    }
    this.socket = null;
  }
}
