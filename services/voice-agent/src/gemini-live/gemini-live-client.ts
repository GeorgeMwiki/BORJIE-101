/**
 * Gemini Live client — wraps Google's BidiGenerateContent WebSocket and
 * exposes the voice-agent's shared `DuplexSessionHandle` contract.
 *
 * Why this lives in a new subdir (not in `providers/`): the existing
 * `providers/` directory holds the production-wired peers (gpt-realtime-2,
 * elevenlabs-v3, lelapa, spitch, cartesia). Per the Wave 19F directive we
 * extend the voice-agent with new subdirectories without touching the
 * existing core. Once the gauntlet sign-off lands we'll either promote this
 * file into `providers/gemini-live.ts` or keep it parallel — that's a Phase 2
 * call.
 *
 * Live mode opens a WebSocket against the Gemini Live endpoint with the
 * caller's API key and a setup frame carrying the model id + voice config.
 * Missing key → stub mode, same pattern as gpt-realtime-2.ts.
 *
 * No raw console statements — logging routes through the shared logger.
 */

import { Buffer } from 'node:buffer';

import { AsyncQueue, readEnv, warnOnce } from '../providers/_runtime.js';
import type {
  AudioChunk,
  DuplexSessionHandle,
  LanguageTag,
  PartialAudio,
  PartialTranscript,
  ProviderName,
  StartSessionOptions,
} from '../providers/types.js';

import { loadConfig, type GeminiLiveConfig } from './config.js';
import { adaptServerEvent, type GeminiServerEvent } from './streaming-adapter.js';

/**
 * A single function-declaration the realtime model may call. Mirrors the
 * Gemini Live `tools[].functionDeclarations[]` shape AND the brain's
 * `ToolHandler` descriptor ({ name, description, parameters }), so a caller
 * can map the brain tool catalog straight onto a voice session with no
 * translation. `parameters` is an OpenAPI-subset JSON schema object.
 */
export interface GeminiFunctionDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/**
 * Per-session persona + capability overrides. ALL optional + additive — the
 * existing call sites (and the hermetic unit tests) keep working unchanged.
 *
 * Why this lives on `StartSessionOptions` as an intersection rather than in
 * the shared `providers/types.ts`: only the duplex Gemini/GPT-realtime path
 * carries a model-side system instruction + function-calling tools; the
 * STT/TTS-only providers do not, so widening the shared type would leak a
 * concept the other providers can't honour.
 */
export interface GeminiPersonaOptions {
  /**
   * Full system instruction the model is booted with. When omitted we fall
   * back to a neutral mining-domain default (NEVER the retired property
   * persona). The gateway bridge passes a locale-driven Mr. Mwikila
   * mining-owner instruction here.
   */
  readonly systemInstruction?: string;
  /**
   * Function-calling tools the model may invoke. Map directly from the
   * brain's `tools.list()` descriptors. Omitted → the model is conversational
   * only (no actions).
   */
  readonly tools?: ReadonlyArray<GeminiFunctionDeclaration>;
}

/** Session options accepted by the Gemini Live client (shared + persona). */
export type GeminiStartSessionOptions = StartSessionOptions & GeminiPersonaOptions;

/**
 * A function-call the model emitted, surfaced to the caller so it can route
 * the dispatch (e.g. through the Borjie brain / action-executor) and feed a
 * `functionResponse` back. Provider-agnostic shape.
 */
export interface VoiceFunctionCall {
  readonly sessionId: string;
  /** Gemini's per-call id — echo it back in the functionResponse. */
  readonly callId?: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/**
 * Use the OpenAI provider name as the visible `ProviderName` so the router
 * type stays unchanged. Tests assert on the concrete string instead.
 */
const PROVIDER_LABEL = 'gemini-live' as const;

export interface GeminiLiveClientOptions {
  /** Override config for tests; defaults to `loadConfig()`. */
  readonly config?: GeminiLiveConfig;
  /**
   * Optional WebSocket factory — tests inject a fake. Production callers
   * leave this unset and we use the global `WebSocket`.
   */
  readonly websocketFactory?: (url: string, headers: Record<string, string>) => WebSocketLike;
}

/**
 * Minimal WebSocket shape we depend on. Mirrors the runtime global. Defined
 * here so tests can inject a fake without pulling in `ws` types.
 *
 * Listener parameters are intentionally `WebSocketEventListener` (a union)
 * rather than per-event-typed overloads — TypeScript's overload resolution
 * inside a hand-rolled fake plays poorly with overloads on `addEventListener`,
 * and the call sites already perform their own narrowing inside the handlers.
 */
export type WebSocketEventListener =
  | (() => void)
  | ((evt: { data: string | Buffer }) => void)
  | ((evt: { message?: string }) => void);

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(event: string, listener: WebSocketEventListener): void;
  removeEventListener(event: string, listener: WebSocketEventListener): void;
}

/**
 * Duplex handle augmented with the realtime function-calling surface. The
 * base `DuplexSessionHandle` only knows audio + transcripts; voice that can
 * take ACTIONS needs the tool-call channel too.
 */
export interface GeminiLiveSessionHandle extends DuplexSessionHandle {
  /** Async stream of function-calls the model emitted. */
  functionCalls(): AsyncIterable<VoiceFunctionCall>;
  /**
   * Feed a tool result back to the model so it can continue the turn. The
   * `output` is serialised into the Gemini `functionResponse.response` field.
   */
  respondToFunctionCall(args: {
    readonly callId?: string;
    readonly name: string;
    readonly output: Record<string, unknown>;
  }): Promise<void>;
}

export interface GeminiLiveClient {
  readonly provider: typeof PROVIDER_LABEL;
  /** Resolved config at construction time — exported for assertions. */
  readonly config: GeminiLiveConfig;
  startSession(options: GeminiStartSessionOptions): Promise<GeminiLiveSessionHandle>;
}

/**
 * Construct a Gemini Live client. The returned client exposes a single
 * `startSession()` method whose handle matches the existing duplex contract.
 *
 * Per immutability rule: config is frozen at construction; subsequent env
 * changes are ignored until a fresh client is built.
 */
export function createGeminiLiveClient(
  options: GeminiLiveClientOptions = {},
): GeminiLiveClient {
  const config = options.config ?? loadConfig();
  const websocketFactory = options.websocketFactory ?? defaultWebSocketFactory;

  return {
    provider: PROVIDER_LABEL,
    config,
    async startSession(
      sessionOptions: GeminiStartSessionOptions,
    ): Promise<GeminiLiveSessionHandle> {
      const sessionId = makeSessionId(sessionOptions);
      if (!config.apiKey) {
        warnOnce(
          'gemini-live:stub',
          '[gemini-live] GEMINI_API_KEY missing — using stub session.',
        );
        return createStubHandle(sessionId, sessionOptions.language);
      }
      return openLiveSession({
        sessionId,
        sessionOptions,
        config,
        websocketFactory,
      });
    },
  };
}

function makeSessionId(options: StartSessionOptions): string {
  return `gemini-live:${options.tenantId}:${options.language}:${Date.now()}`;
}

interface OpenLiveSessionArgs {
  readonly sessionId: string;
  readonly sessionOptions: GeminiStartSessionOptions;
  readonly config: GeminiLiveConfig;
  readonly websocketFactory: NonNullable<GeminiLiveClientOptions['websocketFactory']>;
}

/**
 * Spawn a live WebSocket session. Returns once the setup frame has been sent
 * (the server responds with `setupComplete` which we surface as a no-op).
 *
 * Kept under 50 lines per coding-style; the message dispatch lives in the
 * adapter.
 */
async function openLiveSession(
  args: OpenLiveSessionArgs,
): Promise<GeminiLiveSessionHandle> {
  const { sessionId, sessionOptions, config, websocketFactory } = args;
  const transcriptQueue = new AsyncQueue<PartialTranscript>();
  const audioQueue = new AsyncQueue<PartialAudio>();
  const functionCallQueue = new AsyncQueue<VoiceFunctionCall>();
  const ws = websocketFactory(`${config.baseUrl}?key=${config.apiKey}`, {});

  ws.addEventListener('open', () => {
    sendSetup(ws, config.model, sessionOptions);
  });
  const onMessage = (evt: { data: string | Buffer }): void => {
    const parsed = safeParse(evt.data);
    if (!parsed) return;
    // Function-calls arrive on their own top-level `toolCall` envelope —
    // route them to the dedicated queue before the audio/transcript adapt.
    for (const call of extractFunctionCalls(parsed, sessionId)) {
      functionCallQueue.push(call);
    }
    const adapted = adaptServerEvent(parsed, sessionId, sessionOptions.language);
    if (adapted.error) {
      transcriptQueue.fail(adapted.error);
      audioQueue.fail(adapted.error);
      functionCallQueue.fail(adapted.error);
      return;
    }
    for (const t of adapted.transcripts) transcriptQueue.push(t);
    for (const a of adapted.audio) audioQueue.push(a);
  };
  ws.addEventListener('message', onMessage);

  const onError = (evt: { message?: string }): void => {
    const error = new Error(`gemini-live websocket error: ${evt.message ?? 'unknown'}`);
    transcriptQueue.fail(error);
    audioQueue.fail(error);
    functionCallQueue.fail(error);
  };
  ws.addEventListener('error', onError);
  ws.addEventListener('close', () => {
    transcriptQueue.close();
    audioQueue.close();
    functionCallQueue.close();
  });

  await waitForReady(ws);
  return buildHandle({ sessionId, ws, transcriptQueue, audioQueue, functionCallQueue });
}

interface BuildHandleArgs {
  readonly sessionId: string;
  readonly ws: WebSocketLike;
  readonly transcriptQueue: AsyncQueue<PartialTranscript>;
  readonly audioQueue: AsyncQueue<PartialAudio>;
  readonly functionCallQueue: AsyncQueue<VoiceFunctionCall>;
}

function buildHandle(args: BuildHandleArgs): GeminiLiveSessionHandle {
  const { sessionId, ws, transcriptQueue, audioQueue, functionCallQueue } = args;
  return {
    sessionId,
    provider: PROVIDER_LABEL as unknown as ProviderName,
    async pushAudio(chunk: AudioChunk): Promise<void> {
      if (ws.readyState !== 1) return;
      const base64 = Buffer.from(chunk.bytes).toString('base64');
      ws.send(
        JSON.stringify({
          realtimeInput: {
            mediaChunks: [{ mimeType: chunk.mimeType, data: base64 }],
          },
        }),
      );
    },
    async speak(text: string): Promise<void> {
      if (ws.readyState !== 1) return;
      ws.send(
        JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true,
          },
        }),
      );
    },
    transcripts: () => transcriptQueue,
    audio: () => audioQueue,
    functionCalls: () => functionCallQueue,
    async respondToFunctionCall(callArgs): Promise<void> {
      if (ws.readyState !== 1) return;
      ws.send(
        JSON.stringify({
          toolResponse: {
            functionResponses: [
              {
                ...(callArgs.callId !== undefined ? { id: callArgs.callId } : {}),
                name: callArgs.name,
                response: callArgs.output,
              },
            ],
          },
        }),
      );
    },
    async close(): Promise<void> {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      transcriptQueue.close();
      audioQueue.close();
      functionCallQueue.close();
    },
  };
}

/**
 * Build the Gemini Live `setup` frame. Threads through the caller's persona
 * system instruction (mining-domain default if unset — NEVER the retired
 * property persona) and any function-calling tools.
 */
function sendSetup(
  ws: WebSocketLike,
  model: string,
  options: GeminiStartSessionOptions,
): void {
  const systemText =
    options.systemInstruction ?? defaultMiningInstruction(options.language);
  const tools =
    options.tools && options.tools.length > 0
      ? [{ functionDeclarations: options.tools.map((t) => ({ ...t })) }]
      : undefined;
  ws.send(
    JSON.stringify({
      setup: {
        model: `models/${model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: options.voiceId ?? 'Aoede' },
            },
          },
        },
        systemInstruction: {
          parts: [{ text: systemText }],
        },
        ...(tools !== undefined ? { tools } : {}),
      },
    }),
  );
}

/**
 * Neutral mining-domain fallback instruction. Real callers (the gateway
 * bridge) pass a full locale-driven Mr. Mwikila mining-owner persona; this
 * default only guards the case where none is supplied so we never regress to
 * the retired property persona.
 */
function defaultMiningInstruction(language: LanguageTag): string {
  return [
    'You are Mr. Mwikila, the brain layer of Borjie — an AI-native mining',
    'estate operating system for African artisanal-to-mid-tier mining.',
    `Reply only in ${language}. Never mix languages in a single reply.`,
    'Cover licences, royalty, workforce, treasury, compliance, and the',
    'marketplace. Never give property / real-estate advice.',
  ].join('\n');
}

/**
 * Extract any function-calls from a Gemini Live server frame. The live API
 * delivers them under a top-level `toolCall.functionCalls[]` envelope (each
 * carries `id`, `name`, `args`). Pure — returns an array the caller pushes.
 */
function extractFunctionCalls(
  frame: GeminiServerEvent,
  sessionId: string,
): VoiceFunctionCall[] {
  const calls = frame.toolCall?.functionCalls;
  if (!calls || calls.length === 0) return [];
  const out: VoiceFunctionCall[] = [];
  for (const call of calls) {
    if (!call?.name) continue;
    out.push({
      sessionId,
      ...(typeof call.id === 'string' ? { callId: call.id } : {}),
      name: call.name,
      args: (call.args ?? {}) as Record<string, unknown>,
    });
  }
  return out;
}

function safeParse(data: string | Buffer): GeminiServerEvent | null {
  try {
    const raw = typeof data === 'string' ? data : data.toString('utf8');
    return JSON.parse(raw) as GeminiServerEvent;
  } catch {
    return null;
  }
}

function waitForReady(ws: WebSocketLike): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (ws.readyState === 1) {
      resolve();
      return;
    }
    const onOpen = (): void => {
      cleanup();
      resolve();
    };
    const onError = (evt: { message?: string }): void => {
      cleanup();
      reject(new Error(`gemini-live connect failed: ${evt.message ?? 'unknown'}`));
    };
    const cleanup = (): void => {
      ws.removeEventListener('open', onOpen);
      ws.removeEventListener('error', onError);
    };
    ws.addEventListener('open', onOpen);
    ws.addEventListener('error', onError);
  });
}

function defaultWebSocketFactory(url: string, headers: Record<string, string>): WebSocketLike {
  // Node 22 ships a global WebSocket. The headers option is non-standard but
  // honoured by node:undici.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WS = (globalThis as any).WebSocket;
  if (!WS) {
    throw new Error('WebSocket global not available; upgrade to Node ≥ 22 or inject a factory');
  }
  return new WS(url, { headers }) as WebSocketLike;
}

/**
 * Stub session — identical contract, deterministic transcripts. Used when
 * GEMINI_API_KEY is missing so the unit tests stay hermetic.
 */
function createStubHandle(sessionId: string, language: LanguageTag): GeminiLiveSessionHandle {
  async function* transcripts(): AsyncIterable<PartialTranscript> {
    yield { sessionId, text: '[gemini-stub] partial', isFinal: false, language };
    yield { sessionId, text: '[gemini-stub] final', isFinal: true, confidence: 0.99, language };
  }
  async function* audio(): AsyncIterable<PartialAudio> {
    yield {
      sessionId,
      audio: { bytes: new Uint8Array(0), mimeType: 'audio/pcm', sampleRate: 24000 },
      isFinal: true,
    };
  }
  // eslint-disable-next-line require-yield
  async function* functionCalls(): AsyncIterable<VoiceFunctionCall> {
    /* stub — no tool calls without a live model */
    return;
  }
  return {
    sessionId,
    provider: PROVIDER_LABEL as unknown as ProviderName,
    async pushAudio(_chunk: AudioChunk): Promise<void> {
      /* stub */
    },
    async speak(_text: string): Promise<void> {
      /* stub */
    },
    transcripts,
    audio,
    functionCalls,
    async respondToFunctionCall(): Promise<void> {
      /* stub */
    },
    async close(): Promise<void> {
      /* stub */
    },
  };
}
