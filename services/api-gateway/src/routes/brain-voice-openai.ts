/**
 * OpenAI Realtime upstream for the brain-voice bridge — SOTA speech-to-speech.
 *
 * A second `DuplexUpstream` implementation (alongside `openGeminiUpstream` in
 * brain-voice.hono.ts) that drives OpenAI's Realtime API
 * (`wss://api.openai.com/v1/realtime?model=<gpt-realtime>`) over a single WS:
 *
 *   mic PCM16 ──▶ input_audio_buffer.append ──▶ server-side VAD ──▶ brain
 *   response.audio.delta / response.audio_transcript.delta ◀── speech out
 *   response.function_call_arguments.done ──▶ dispatchVoiceToolCall (fail-closed)
 *
 * It fulfils the EXACT same contract as the Gemini upstream — same
 * `OpenGeminiUpstreamArgs` (persona + tools + locale + tenant + callbacks),
 * same `UpstreamCallbacks` (onAudio / onTranscript / onToolCall / onError /
 * onClose), same `DuplexUpstream` surface (pushAudio / speakText /
 * respondToToolCall / close) — so the session bridge, barge-in, tenant
 * binding, and tool-dispatch wiring above are reused verbatim. Only the WS
 * protocol differs, and that mapping is harvested from the proven event map in
 * services/voice-agent/src/providers/gpt-realtime-2.ts (NOT rewritten).
 *
 * Protocol notes (OpenAI Realtime, beta v1):
 *   • session.update sets server_vad turn detection (so the model decides when
 *     the owner stopped talking and starts speaking back — same UX as Gemini
 *     native-audio), pcm16 in/out, whisper input transcription, the locale-pure
 *     Mr. Mwikila system instruction, and the brain tool catalog as `tools`.
 *   • input_audio_buffer.append carries base64 PCM16 mic frames upstream.
 *   • response.audio.delta / response.audio.done → onAudio (24 kHz PCM).
 *   • response.audio_transcript.delta/.done → onTranscript(agent).
 *   • conversation.item.input_audio_transcription.completed → onTranscript(user).
 *   • response.function_call_arguments.done → onToolCall (args are a JSON
 *     STRING in this event — we parse defensively).
 *   • barge-in: when the owner speaks over the model, OpenAI emits
 *     `input_audio_buffer.speech_started`; we `response.cancel` + clear any
 *     queued output audio so the model stops mid-utterance (matches Gemini's
 *     implicit interruption). Bridge-driven barge-in (speakText / new audio)
 *     also funnels through the same cancel.
 *   • tool result: `conversation.item.create` (function_call_output) followed
 *     by `response.create` so the model continues speaking with the result.
 *
 * No console.log — Pino only. No mutation — every frame builder returns fresh
 * objects.
 */

import { Buffer } from 'node:buffer';

import pino from 'pino';

import type {
  DuplexUpstream,
  OpenGeminiUpstreamArgs,
  UpstreamCallbacks,
  VoiceAudioChunk,
  VoiceFunctionDeclaration,
} from './brain-voice.hono.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'brain-voice-openai',
});

const OPENAI_DEFAULT_MODEL = 'gpt-realtime';
const OPENAI_REALTIME_BASE_URL = 'wss://api.openai.com/v1/realtime';
/** OpenAI Realtime native sample rate (PCM16) the model returns. */
const OPENAI_OUTPUT_SAMPLE_RATE = 24000;

/**
 * Minimal upstream WebSocket shape (matches the Node global `WebSocket`).
 * Re-declared structurally here — the identical private interface in
 * brain-voice.hono.ts is not exported, and a structural match is all the
 * call sites and the injectable test `socketFactory` need.
 */
interface UpstreamSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(event: string, listener: (evt: unknown) => void): void;
}

/**
 * Args for `openGptRealtimeUpstream`. Structurally identical to
 * `OpenGeminiUpstreamArgs` so the session bridge calls either opener through
 * the same shape; we alias rather than redeclare to keep them locked in step.
 */
export type OpenGptRealtimeUpstreamArgs = OpenGeminiUpstreamArgs;

/**
 * Open an OpenAI Realtime duplex session and wire its WS events onto the same
 * bridge callbacks the Gemini upstream uses. Returns a `DuplexUpstream` the
 * bridge drives. Throws when OPENAI_API_KEY is absent (the caller surfaces
 * `provider_unavailable` to the client) — identical fail-mode to Gemini.
 */
export function openGptRealtimeUpstream(args: OpenGptRealtimeUpstreamArgs): DuplexUpstream {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured — cannot open realtime upstream');
  }
  const model = process.env.OPENAI_VOICE_MODEL?.trim() || OPENAI_DEFAULT_MODEL;
  const sessionId = `gpt-realtime:${args.tenantId}:${args.locale}:${Date.now()}`;
  const factory = args.socketFactory ?? defaultOpenAISocketFactory(apiKey);
  const ws = factory(`${OPENAI_REALTIME_BASE_URL}?model=${encodeURIComponent(model)}`);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify(buildOpenAISessionUpdateFrame(args)));
  });
  ws.addEventListener('message', (evt: unknown) => {
    const frame = safeParseOpenAIFrame((evt as { data?: unknown }).data);
    if (!frame) return;
    routeOpenAIServerFrame(frame, sessionId, args.callbacks, {
      // server-VAD barge-in: when the owner starts speaking over the model,
      // cancel the in-flight response so playback stops mid-utterance.
      cancelResponse: () => cancelInFlightResponse(ws),
    });
  });
  ws.addEventListener('error', (evt: unknown) => {
    const message = (evt as { message?: string }).message ?? 'unknown';
    args.callbacks.onError('upstream_websocket_error', `gpt-realtime: ${message}`);
  });
  ws.addEventListener('close', () => args.callbacks.onClose());

  return {
    sessionId,
    pushAudio(chunk: VoiceAudioChunk): void {
      if (ws.readyState !== 1) return;
      const base64 = Buffer.from(chunk.bytes).toString('base64');
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: base64 }));
    },
    speakText(text: string): void {
      if (ws.readyState !== 1) return;
      // A typed/text turn is an explicit barge-in: cancel any in-flight spoken
      // response first, then drive a fresh audio+text response from the text.
      cancelInFlightResponse(ws);
      ws.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text }],
          },
        }),
      );
      ws.send(JSON.stringify({ type: 'response.create' }));
    },
    respondToToolCall(toolArgs): void {
      if (ws.readyState !== 1) return;
      // Feed the tool result back as a function_call_output conversation item,
      // then ask the model to continue speaking with it. callId is OpenAI's
      // function-call `call_id`; without it the model cannot match the output.
      ws.send(
        JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            ...(toolArgs.callId !== undefined ? { call_id: toolArgs.callId } : {}),
            output: JSON.stringify(toolArgs.output),
          },
        }),
      );
      ws.send(JSON.stringify({ type: 'response.create' }));
    },
    close(): void {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/** Cancel an in-flight model response + drop any queued playback (barge-in). */
function cancelInFlightResponse(ws: UpstreamSocket): void {
  if (ws.readyState !== 1) return;
  try {
    ws.send(JSON.stringify({ type: 'response.cancel' }));
  } catch {
    /* socket may be mid-close — barge-in is best-effort */
  }
}

/**
 * Build the OpenAI Realtime `session.update` frame: persona instruction, tools,
 * server-side VAD, pcm16 duplex audio, and whisper input transcription.
 *
 * Pure function: same args → same frame. Exported for unit tests.
 */
export function buildOpenAISessionUpdateFrame(
  args: Pick<OpenGptRealtimeUpstreamArgs, 'systemInstruction' | 'tools' | 'voiceName'>,
): Record<string, unknown> {
  const tools = args.tools.map(toOpenAIToolDeclaration);
  return {
    type: 'session.update',
    session: {
      modalities: ['audio', 'text'],
      instructions: args.systemInstruction,
      voice: args.voiceName ?? 'alloy',
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      // whisper-1 (or the configured realtime transcription model) gives us the
      // owner's words back as `input_audio_transcription.completed`.
      input_audio_transcription: { model: openAITranscriptionModel() },
      // SERVER-SIDE VAD — the model detects end-of-speech and replies on its
      // own, and emits speech_started for barge-in. This is the SOTA duplex UX.
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
      },
      ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
    },
  };
}

/** OpenAI Realtime tool declaration shape (flat — name/description/parameters). */
function toOpenAIToolDeclaration(t: VoiceFunctionDeclaration): Record<string, unknown> {
  return {
    type: 'function',
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  };
}

/** Whisper transcription model — overridable; defaults to whisper-1. */
function openAITranscriptionModel(): string {
  return process.env.OPENAI_TRANSCRIPTION_MODEL?.trim() || 'whisper-1';
}

/** Narrow OpenAI Realtime server-event shape we consume. */
interface OpenAIServerFrame {
  readonly type?: string;
  readonly delta?: string;
  readonly transcript?: string;
  /** function_call_arguments.done payload. */
  readonly call_id?: string;
  readonly name?: string;
  readonly arguments?: string;
  /** error event payload. */
  readonly error?: { readonly message?: string; readonly code?: string };
  readonly message?: string;
}

/** Side-effects the router needs to drive on the socket (barge-in cancel). */
interface OpenAIRouterHooks {
  readonly cancelResponse: () => void;
}

/**
 * Route one OpenAI Realtime server frame to the bridge callbacks. Pure dispatch
 * apart from the injected `cancelResponse` hook (barge-in) — no direct socket
 * I/O — so it is unit-testable in isolation. Mirrors the event map proven in
 * services/voice-agent/src/providers/gpt-realtime-2.ts.
 */
export function routeOpenAIServerFrame(
  frame: OpenAIServerFrame,
  _sessionId: string,
  cb: UpstreamCallbacks,
  hooks: OpenAIRouterHooks,
): void {
  switch (frame.type) {
    case 'response.audio.delta': {
      if (typeof frame.delta === 'string' && frame.delta.length > 0) {
        cb.onAudio(frame.delta, OPENAI_OUTPUT_SAMPLE_RATE, false);
      }
      return;
    }
    case 'response.audio.done': {
      cb.onAudio('', OPENAI_OUTPUT_SAMPLE_RATE, true);
      return;
    }
    case 'response.audio_transcript.delta': {
      if (typeof frame.delta === 'string' && frame.delta.length > 0) {
        cb.onTranscript(frame.delta, false, 'agent');
      }
      return;
    }
    case 'response.audio_transcript.done': {
      if (typeof frame.transcript === 'string' && frame.transcript.length > 0) {
        cb.onTranscript(frame.transcript, true, 'agent');
      }
      return;
    }
    case 'conversation.item.input_audio_transcription.completed': {
      if (typeof frame.transcript === 'string' && frame.transcript.length > 0) {
        cb.onTranscript(frame.transcript, true, 'user');
      }
      return;
    }
    case 'input_audio_buffer.speech_started': {
      // BARGE-IN: the owner started talking over the model — stop playback.
      hooks.cancelResponse();
      return;
    }
    case 'response.function_call_arguments.done': {
      if (!frame.name) return;
      cb.onToolCall({
        ...(typeof frame.call_id === 'string' ? { callId: frame.call_id } : {}),
        name: frame.name,
        args: parseToolArgs(frame.arguments),
      });
      return;
    }
    case 'error': {
      const message = frame.error?.message ?? frame.message ?? 'error';
      cb.onError('upstream_error', `gpt-realtime: ${message}`);
      return;
    }
    default:
      // Ignore frames we don't surface (session.created/updated,
      // rate_limits.updated, input_audio_buffer.committed, response.created,
      // response.done, etc.). They aren't errors.
      return;
  }
}

/** Parse the JSON-string `arguments` from a function_call event. Defensive. */
function parseToolArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    logger.warn('brain-voice-openai: failed to parse function_call arguments — using empty args');
    return {};
  }
}

function safeParseOpenAIFrame(data: unknown): OpenAIServerFrame | null {
  try {
    if (typeof data === 'string') return JSON.parse(data) as OpenAIServerFrame;
    if (data instanceof Buffer) return JSON.parse(data.toString('utf8')) as OpenAIServerFrame;
    if (data instanceof Uint8Array) {
      return JSON.parse(Buffer.from(data).toString('utf8')) as OpenAIServerFrame;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Default socket factory for OpenAI Realtime. Unlike Gemini (key in query
 * string), OpenAI authenticates via the `Authorization` header + the realtime
 * beta header — passed through undici's WebSocket options arg. The key is never
 * serialised/logged. Curried so the URL-only `socketFactory` signature stays
 * compatible with the Gemini path + the injectable test seam.
 */
function defaultOpenAISocketFactory(apiKey: string): (url: string) => UpstreamSocket {
  return (url: string): UpstreamSocket => {
    // Node ≥ 22 ships a global WebSocket (undici), typed `any` for the same
    // reason the Gemini path + gpt-realtime-2.ts do — the lib/types matrix
    // varies and call sites narrow inside their own handlers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const WS = (globalThis as any).WebSocket;
    if (!WS) {
      throw new Error('global WebSocket unavailable; upgrade to Node ≥ 22 or inject a socketFactory');
    }
    return new WS(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'OpenAI-Beta': 'realtime=v1',
      },
    }) as UpstreamSocket;
  };
}
