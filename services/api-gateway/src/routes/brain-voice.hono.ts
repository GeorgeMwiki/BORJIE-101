/**
 * /api/v1/brain/voice/stream — SOTA realtime-voice BACKEND.
 *
 * A gateway WebSocket that bridges the owner's microphone to a DUPLEX
 * realtime model sitting in front of the REAL Borjie brain. The upstream is
 * provider-selectable via `VOICE_PROVIDER`: Gemini Live BidiGenerateContent
 * (default) or OpenAI Realtime gpt-realtime speech-to-speech with server-side
 * VAD (routes/brain-voice-openai.ts). The model speaks as Mr. Mwikila — the
 * mining-estate owner strategist — and is action-capable: the brain's tool
 * catalog is registered as the realtime session's function-calling tools.
 *
 * ┌────────────┐  PCM frames   ┌──────────────┐  PCM/text   ┌─────────────┐
 * │  owner mic │ ────────────▶ │  this bridge │ ──────────▶ │ Gemini Live │
 * │ (browser)  │ ◀──────────── │  (gateway WS)│ ◀────────── │  (duplex)   │
 * └────────────┘  PCM frames   └──────┬───────┘  audio+tool └─────────────┘
 *                                     │ tool_call
 *                                     ▼
 *                       fail-closed gate → typed action-executor
 *                       (auto-safe runs; confirm-required needs a SPOKEN
 *                        confirmation token round-trip — never moves money)
 *
 * WHAT IS REAL AND COMPILES HERE
 *   • Supabase JWT auth (HS256 secret OR ES256 JWKS) — fail-closed.
 *   • Tenant binding from `app_metadata.tenant_id` (never client-mutable).
 *   • Locale-driven (sw/en) Mr. Mwikila mining-owner system instruction
 *     sourced from `@borjie/persona-runtime`. (The retired property-domain
 *     persona at services/voice-agent/src/personas/mr-mwikila.ts has been
 *     DELETED — it violated the mining-only rule.)
 *   • Brain tool catalog → realtime function-calling declarations.
 *   • Full duplex bridge: client audio ⇄ Gemini Live audio, transcripts,
 *     and a function-call channel.
 *   • A pure, unit-testable inbound-frame router.
 *
 * WHAT NEEDS RUNTIME VALIDATION (see the FLAG block at the bottom of this
 * file and the §RUNTIME-FLAGS export):
 *   • WS-UPGRADE TRANSPORT: the gateway HTTP server is Express
 *     (`app.listen(...)`). `attachBrainVoiceWebSocket()` is written against an
 *     injected `WebSocketServerLike` factory and is a NO-OP (with a clear Pino
 *     warning) until that factory is wired. The real `ws`-backed factory now
 *     lives in `composition/voice/voice-wiring.ts`; the orchestrator mounts it
 *     via `createVoiceWiring({ server })` after `app.listen(...)`. No silent
 *     stub — the real attach is present and ready.
 *   • PROVIDER KEYS: GEMINI_API_KEY (or OPENAI_API_KEY). Without a key the
 *     upstream session cannot open; the bridge reports `provider_unavailable`.
 *   • AUDIO CODEC: the browser must send 16 kHz mono PCM little-endian
 *     (`audio/pcm`); Gemini returns 24 kHz PCM. Sample-rate negotiation and
 *     Opus transcode (if the client sends Opus) are out of scope here.
 *
 * No console.log — Pino only. No mutation — every frame builder returns fresh
 * objects.
 */

import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { Server as HttpServer } from 'node:http';

import { sql } from 'drizzle-orm';
import pino from 'pino';
import {
  verifySupabaseJwt,
  extractBearer,
  SupabaseAuthError,
  BrainRegistry,
  PostgresThreadStoreBackend,
  createBrain,
  loadBrainEnv,
  type BrainAuthPrincipal,
} from '@borjie/ai-copilot';
import {
  createDatabaseClient,
  BrainThreadRepository,
} from '@borjie/database';
import { BUILT_IN_PERSONAS } from '@borjie/persona-runtime';
import type { ScopeContext } from '@borjie/central-intelligence';

// Action-execution wiring (IMPORTED — never edited from here). The voice
// channel runs the EXACT same fail-closed gate → typed executor path the
// text `/brain` and `/owner/chat/*` surfaces use, so a spoken action is
// authorized, RLS-scoped, and hash-chain-audited identically to a tapped one.
import {
  isSafeVerb,
  requiresConfirmation,
  dispatchAction,
  type ExecContext,
  type DispatchResult,
} from '../services/action-executor/index.js';
import { decideAutoAuthorization } from '../services/auto-authorize-gate/index.js';
import { openGptRealtimeUpstream } from './brain-voice-openai.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'brain-voice',
});

// ───────────────────────────────────────────────────────────────────────────
// Locale + persona
// ───────────────────────────────────────────────────────────────────────────

/** Voice locale — the brain persona enforces single-language purity. */
export type VoiceLocale = 'en' | 'sw';

export function normalizeLocale(raw: string | null | undefined): VoiceLocale {
  return raw && raw.toLowerCase().startsWith('sw') ? 'sw' : 'en';
}

/**
 * Resolve the canonical mining OWNER persona from persona-runtime. We use the
 * tier-1 owner strategist (`T1_owner_strategist`) — Mr. Mwikila's "face" for
 * the owner cockpit. This is the REAL mining persona; the property-domain
 * relic formerly at services/voice-agent/src/personas/mr-mwikila.ts has been
 * deleted (it violated the mining-only rule).
 */
function ownerPersonaSpec() {
  const spec = BUILT_IN_PERSONAS.find((p) => p.slug === 'T1_owner_strategist');
  if (!spec) {
    // Defensive: the seed list is a frozen constant, so this is unreachable in
    // practice. Fail loud rather than silently mis-persona the voice channel.
    throw new Error('brain-voice: T1_owner_strategist persona missing from persona-runtime seeds');
  }
  return spec;
}

/**
 * Build the locale-driven Mr. Mwikila mining-owner system instruction.
 *
 * Hard rules inherited from the brain persona:
 *  • SW/EN purity — when `en` is active ZERO Swahili appears, and vice versa.
 *  • Evidence-required — every recommendation cites ≥1 evidence id.
 *  • Mining-domain only — never property / real-estate.
 *
 * Pure function: same locale → same string. The persona display name is read
 * from persona-runtime so the voice "face" stays in lock-step with the rest
 * of the platform.
 */
export function buildVoiceSystemInstruction(locale: VoiceLocale): string {
  const spec = ownerPersonaSpec();
  const displayName = locale === 'sw' ? spec.displayNameSw : spec.displayNameEn;

  if (locale === 'sw') {
    return [
      `Wewe ni Bwana Mwikila, tabaka la akili la Borjie — mfumo wa uendeshaji`,
      `wa milki za madini kwa wachimbaji wadogo hadi wa kati barani Afrika.`,
      `Jukumu lako sasa ni "${displayName}" — mshauri mkuu wa mmiliki.`,
      ``,
      `SHERIA NGUMU:`,
      `  • Jibu kwa Kiswahili PEKEE. Usichanganye lugha kamwe katika jibu moja.`,
      `  • Kila pendekezo lazima litaje ushahidi (evidence) kutoka mfumo.`,
      `  • Shughulikia leseni, mrabaha, wafanyakazi, hazina, utii, na soko.`,
      `  • USITOE ushauri wa mali isiyohamishika / nyumba.`,
      ``,
      `MUUNDO WA SAUTI: ongea kwa ufupi, kwa heshima, na kwa uwazi. Kabla ya`,
      `kuchukua hatua yoyote yenye uzito wa kifedha au kisheria, eleza kuwa`,
      `umeisajili ombi na timu itathibitisha — usidai limekamilika.`,
    ].join('\n');
  }

  return [
    `You are Mr. Mwikila, the brain layer of Borjie — an AI-native mining`,
    `estate operating system for African artisanal-to-mid-tier mining.`,
    `Your active role is "${displayName}" — the owner's strategic advisor.`,
    ``,
    `HARD RULES:`,
    `  • Reply in English ONLY. Never mix languages within a single reply.`,
    `  • Every recommendation must cite at least one evidence id from the`,
    `    system (LMBM / intelligence corpus).`,
    `  • Cover licences, royalty, workforce, treasury, compliance, and the`,
    `    marketplace. NEVER give property / real-estate advice.`,
    ``,
    `VOICE STYLE: speak briefly, respectfully, and clearly. Before taking any`,
    `action with financial or legal weight, say you have logged the request`,
    `and a team member will confirm — never imply it is already done.`,
  ].join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
// Provider-facing contracts (self-contained — the gateway cannot import
// @borjie/voice-agent, which is not one of its declared dependencies).
// ───────────────────────────────────────────────────────────────────────────

/** A function-declaration the realtime model may call (OpenAPI-subset schema). */
export interface VoiceFunctionDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/** A tool-call the model emitted. */
export interface VoiceToolCall {
  readonly callId?: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
}

/** PCM/Opus chunk pushed up from the caller. */
export interface VoiceAudioChunk {
  readonly bytes: Uint8Array;
  readonly mimeType: 'audio/pcm' | 'audio/opus' | 'audio/wav';
  readonly sampleRate: 8000 | 16000 | 24000 | 48000;
}

/**
 * Events the bridge emits BACK toward the owner's browser. The transport
 * layer (the WS-upgrade adapter) serialises these to the client socket.
 */
export type BridgeOutboundEvent =
  | { readonly kind: 'ready'; readonly sessionId: string; readonly locale: VoiceLocale }
  | { readonly kind: 'audio'; readonly base64: string; readonly sampleRate: number; readonly isFinal: boolean }
  | { readonly kind: 'transcript'; readonly text: string; readonly isFinal: boolean; readonly speaker: 'user' | 'agent' }
  | { readonly kind: 'tool_call'; readonly name: string; readonly status: 'started' | 'ok' | 'error' }
  | { readonly kind: 'error'; readonly code: string; readonly message: string };

/**
 * The minimal duplex upstream the bridge drives. Implemented by
 * `openGeminiUpstream` (default) AND `openGptRealtimeUpstream` (OpenAI Realtime,
 * routes/brain-voice-openai.ts) behind this same interface; `VOICE_PROVIDER`
 * selects which one `openVoiceUpstream` opens.
 */
export interface DuplexUpstream {
  readonly sessionId: string;
  pushAudio(chunk: VoiceAudioChunk): void;
  speakText(text: string): void;
  respondToToolCall(args: { callId?: string; name: string; output: Record<string, unknown> }): void;
  close(): void;
}

/** Minimal upstream WebSocket shape (matches the Node global `WebSocket`). */
interface UpstreamSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(event: string, listener: (evt: unknown) => void): void;
}

// ───────────────────────────────────────────────────────────────────────────
// Auth — fail-closed Supabase JWT, exactly mirroring brain.hono.ts.
// ───────────────────────────────────────────────────────────────────────────

let brainEnvCache: ReturnType<typeof loadBrainEnv> | null = null;
function brainEnv() {
  if (brainEnvCache) return brainEnvCache;
  brainEnvCache = loadBrainEnv(process.env);
  return brainEnvCache;
}

/**
 * Derive the verify options. Defaults to the HS256 shared-secret path — the
 * exact contract brain.hono.ts uses, so voice auth behaves identically to the
 * text brain surface. An operator on a modern ES256 Supabase project opts into
 * the asymmetric JWKS path by setting `SUPABASE_JWKS_URL` (or
 * `BORJIE_SUPABASE_JWKS_URL`); when set it WINS per the dual-mode contract in
 * packages/ai-copilot/src/config/supabase-auth.ts.
 */
function verifyOptions(): Parameters<typeof verifySupabaseJwt>[1] {
  const env = brainEnv();
  const jwksUrl =
    process.env.SUPABASE_JWKS_URL?.trim() ||
    process.env.BORJIE_SUPABASE_JWKS_URL?.trim();
  if (jwksUrl) {
    return {
      jwksUrl,
      jwtSecret: env.SUPABASE_JWT_SECRET,
      defaultEnvironment: 'production',
    };
  }
  return { jwtSecret: env.SUPABASE_JWT_SECRET, defaultEnvironment: 'production' };
}

/**
 * Authenticate a handshake. Accepts the token from the `Authorization`
 * header, a `?token=` query param (browsers cannot set WS headers), or the
 * first client message's `token` field. Fail-closed: any miss throws
 * SupabaseAuthError.
 */
export async function authenticateVoiceHandshake(
  rawToken: string | null | undefined,
): Promise<BrainAuthPrincipal> {
  const token = rawToken?.startsWith('Bearer ')
    ? extractBearer(rawToken)
    : (rawToken ?? null);
  if (!token) throw new SupabaseAuthError('missing_voice_auth_token', 401);
  return verifySupabaseJwt(token, verifyOptions());
}

// ───────────────────────────────────────────────────────────────────────────
// Brain registry — one shared instance, tenant-scoped per session. Identical
// construction to brain.hono.ts so voice reaches the SAME brain + tools.
// ───────────────────────────────────────────────────────────────────────────

let dbCache: ReturnType<typeof createDatabaseClient> | null = null;
let registryCache: BrainRegistry | null = null;

function db() {
  if (dbCache) return dbCache;
  dbCache = createDatabaseClient(brainEnv().DATABASE_URL);
  return dbCache;
}

function registry(): BrainRegistry {
  if (registryCache) return registryCache;
  const e = brainEnv();
  registryCache = new BrainRegistry((tenantId) => {
    const repo = new BrainThreadRepository(db());
    const backend = new PostgresThreadStoreBackend(repo, () => tenantId);
    const anthropic: { apiKey: string; baseUrl?: string; defaultModel?: string } = {
      apiKey: e.ANTHROPIC_API_KEY,
    };
    if (e.ANTHROPIC_BASE_URL !== undefined) anthropic.baseUrl = e.ANTHROPIC_BASE_URL;
    if (e.ANTHROPIC_MODEL_DEFAULT !== undefined) anthropic.defaultModel = e.ANTHROPIC_MODEL_DEFAULT;
    return createBrain({ anthropic, threadStoreBackend: backend });
  });
  return registryCache;
}

/**
 * Project the brain's registered tool catalog onto realtime function-calling
 * declarations. This is what makes voice ACTION-capable: the model can invoke
 * the exact same tools the text `/brain` surface exposes.
 *
 * Returns `[]` (conversational-only) when the brain cannot be constructed
 * (e.g. ANTHROPIC/DATABASE env unset) rather than throwing — the voice channel
 * still works for talk, it just can't take actions.
 */
export function buildVoiceToolDeclarations(tenantId: string): VoiceFunctionDeclaration[] {
  let catalog: VoiceFunctionDeclaration[];
  try {
    const brain = registry().for(tenantId);
    catalog = brain.tools.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), tenantId },
      'brain-voice: tool catalog unavailable — voice session will be conversational-only',
    );
    catalog = [];
  }
  // ALWAYS expose the spoken-confirmation completion tool, even when the brain
  // catalog is empty. This is the SECOND half of the verbal-confirmation
  // round-trip: when a confirm-required verb was proposed, the model received a
  // short-lived `confirmationToken`; after the owner says "yes" out loud the
  // model calls THIS tool with that token to actually run the action. Without
  // it the round-trip cannot complete and confirm-required verbs stay inert.
  return [...catalog, CONFIRM_PENDING_ACTION_DECLARATION];
}

// ───────────────────────────────────────────────────────────────────────────
// Gemini Live upstream — self-contained duplex client over the Node global
// WebSocket. Mirrors the proven BidiGenerateContent protocol from the
// promoted services/voice-agent/src/gemini-live/gemini-live-client.ts.
// ───────────────────────────────────────────────────────────────────────────

const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash-preview-native-audio';
const GEMINI_LIVE_BASE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export interface UpstreamCallbacks {
  readonly onAudio: (base64: string, sampleRate: number, isFinal: boolean) => void;
  readonly onTranscript: (text: string, isFinal: boolean, speaker: 'user' | 'agent') => void;
  readonly onToolCall: (call: VoiceToolCall) => void;
  readonly onError: (code: string, message: string) => void;
  readonly onClose: () => void;
}

export interface OpenGeminiUpstreamArgs {
  readonly systemInstruction: string;
  readonly tools: ReadonlyArray<VoiceFunctionDeclaration>;
  readonly locale: VoiceLocale;
  readonly tenantId: string;
  readonly voiceName?: string;
  readonly callbacks: UpstreamCallbacks;
  /** Injectable for tests — defaults to the Node global WebSocket. */
  readonly socketFactory?: (url: string) => UpstreamSocket;
}

/**
 * Open a Gemini Live duplex session and wire its events to the callbacks.
 * Returns a `DuplexUpstream` the bridge drives. Throws when GEMINI_API_KEY is
 * absent (the caller surfaces `provider_unavailable` to the client).
 */
export function openGeminiUpstream(args: OpenGeminiUpstreamArgs): DuplexUpstream {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured — cannot open realtime upstream');
  }
  const model = process.env.GEMINI_VOICE_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
  const sessionId = `gemini-live:${args.tenantId}:${args.locale}:${Date.now()}`;
  const factory = args.socketFactory ?? defaultUpstreamSocketFactory;
  const ws = factory(`${GEMINI_LIVE_BASE_URL}?key=${apiKey}`);

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify(buildGeminiSetupFrame(model, args)));
  });
  ws.addEventListener('message', (evt: unknown) => {
    const frame = safeParseFrame((evt as { data?: unknown }).data);
    if (!frame) return;
    routeGeminiServerFrame(frame, sessionId, args.callbacks);
  });
  ws.addEventListener('error', (evt: unknown) => {
    const message = (evt as { message?: string }).message ?? 'unknown';
    args.callbacks.onError('upstream_websocket_error', `gemini-live: ${message}`);
  });
  ws.addEventListener('close', () => args.callbacks.onClose());

  return {
    sessionId,
    pushAudio(chunk: VoiceAudioChunk): void {
      if (ws.readyState !== 1) return;
      const base64 = Buffer.from(chunk.bytes).toString('base64');
      ws.send(
        JSON.stringify({
          realtimeInput: { mediaChunks: [{ mimeType: chunk.mimeType, data: base64 }] },
        }),
      );
    },
    speakText(text: string): void {
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
    respondToToolCall(toolArgs): void {
      if (ws.readyState !== 1) return;
      ws.send(
        JSON.stringify({
          toolResponse: {
            functionResponses: [
              {
                ...(toolArgs.callId !== undefined ? { id: toolArgs.callId } : {}),
                name: toolArgs.name,
                response: toolArgs.output,
              },
            ],
          },
        }),
      );
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

// ───────────────────────────────────────────────────────────────────────────
// Provider selection — Gemini Live (default) vs OpenAI Realtime (gpt-realtime).
//
// `VOICE_PROVIDER` chooses the upstream. It DEFAULTS to `gemini` so nothing
// breaks when OPENAI_API_KEY is absent — the OpenAI path is opt-in. The value
// is read here the same localized way `verifyOptions()` reads the optional
// SUPABASE_JWKS_URL: a small reader co-located with the upstream openers (the
// strict `brainEnv()` loader is for brain/auth/db keys and must not be widened
// with optional provider knobs). Both openers share the SAME `DuplexUpstream`
// contract + `OpenGeminiUpstreamArgs` shape, so the selector is a pure switch.
// ───────────────────────────────────────────────────────────────────────────

/** Realtime voice provider. `gemini` (default) or `openai` (gpt-realtime). */
export type VoiceProvider = 'gemini' | 'openai';

/**
 * Resolve the configured voice provider. Reads `VOICE_PROVIDER`, normalising
 * case + whitespace; anything other than an explicit `openai` falls back to the
 * `gemini` default (fail-safe: an unset / typo'd value keeps the working
 * provider rather than breaking the channel). Pure-ish + injectable for tests.
 */
export function resolveVoiceProvider(raw?: string | null): VoiceProvider {
  const value = (raw ?? process.env.VOICE_PROVIDER ?? '').trim().toLowerCase();
  return value === 'openai' ? 'openai' : 'gemini';
}

/**
 * Open the realtime upstream for the configured provider. Single seam the
 * session bridge calls; both branches return a `DuplexUpstream` driven
 * identically by the bridge (audio ⇄ audio, transcripts, fail-closed
 * tool-calls, barge-in). The OpenAI opener is harvested from the proven
 * gpt-realtime event map (see routes/brain-voice-openai.ts).
 */
export function openVoiceUpstream(args: OpenGeminiUpstreamArgs): DuplexUpstream {
  const provider = resolveVoiceProvider();
  logger.info({ provider, tenantId: args.tenantId, locale: args.locale }, 'brain-voice: opening realtime upstream');
  return provider === 'openai'
    ? openGptRealtimeUpstream(args)
    : openGeminiUpstream(args);
}

/** Build the Gemini Live `setup` frame (persona + tools + audio config). */
export function buildGeminiSetupFrame(
  model: string,
  args: Pick<OpenGeminiUpstreamArgs, 'systemInstruction' | 'tools' | 'voiceName'>,
): Record<string, unknown> {
  const tools =
    args.tools.length > 0
      ? [{ functionDeclarations: args.tools.map((t) => ({ ...t })) }]
      : undefined;
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: args.voiceName ?? 'Aoede' },
          },
        },
      },
      systemInstruction: { parts: [{ text: args.systemInstruction }] },
      ...(tools !== undefined ? { tools } : {}),
    },
  };
}

/** Narrow Gemini Live server-frame shape we consume. */
interface GeminiServerFrame {
  readonly serverContent?: {
    readonly modelTurn?: {
      readonly parts?: ReadonlyArray<{
        readonly inlineData?: { readonly mimeType?: string; readonly data?: string };
        readonly text?: string;
      }>;
    };
    readonly inputTranscription?: { readonly text?: string; readonly finished?: boolean };
    readonly outputTranscription?: { readonly text?: string; readonly finished?: boolean };
    readonly turnComplete?: boolean;
  };
  readonly toolCall?: {
    readonly functionCalls?: ReadonlyArray<{
      readonly id?: string;
      readonly name?: string;
      readonly args?: Record<string, unknown>;
    }>;
  };
  readonly error?: { readonly code?: number; readonly message?: string };
}

/**
 * Route one Gemini Live server frame to the bridge callbacks. Pure dispatch —
 * no socket I/O — so it is unit-testable in isolation.
 */
export function routeGeminiServerFrame(
  frame: GeminiServerFrame,
  _sessionId: string,
  cb: UpstreamCallbacks,
): void {
  if (frame.error) {
    cb.onError('upstream_error', `gemini-live: ${frame.error.message ?? 'error'}`);
    return;
  }
  for (const call of frame.toolCall?.functionCalls ?? []) {
    if (!call?.name) continue;
    cb.onToolCall({
      ...(typeof call.id === 'string' ? { callId: call.id } : {}),
      name: call.name,
      args: (call.args ?? {}) as Record<string, unknown>,
    });
  }
  const sc = frame.serverContent;
  if (!sc) return;
  if (sc.inputTranscription?.text) {
    cb.onTranscript(sc.inputTranscription.text, sc.inputTranscription.finished === true, 'user');
  }
  if (sc.outputTranscription?.text) {
    cb.onTranscript(sc.outputTranscription.text, sc.outputTranscription.finished === true, 'agent');
  }
  for (const part of sc.modelTurn?.parts ?? []) {
    const data = part.inlineData?.data;
    if (data) cb.onAudio(data, 24000, false);
  }
  if (sc.turnComplete === true) cb.onAudio('', 24000, true);
}

function safeParseFrame(data: unknown): GeminiServerFrame | null {
  try {
    if (typeof data === 'string') return JSON.parse(data) as GeminiServerFrame;
    if (data instanceof Buffer) return JSON.parse(data.toString('utf8')) as GeminiServerFrame;
    if (data instanceof Uint8Array) return JSON.parse(Buffer.from(data).toString('utf8')) as GeminiServerFrame;
    return null;
  } catch {
    return null;
  }
}

function defaultUpstreamSocketFactory(url: string): UpstreamSocket {
  // Node ≥ 22 ships a global WebSocket (undici). Typed as `any` here for the
  // same reason gpt-realtime-2.ts does it — the lib/types matrix varies and
  // the call sites narrow inside their own handlers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const WS = (globalThis as any).WebSocket;
  if (!WS) {
    throw new Error('global WebSocket unavailable; upgrade to Node ≥ 22 or inject a socketFactory');
  }
  return new WS(url) as UpstreamSocket;
}

// ───────────────────────────────────────────────────────────────────────────
// Inbound client-frame router — PURE. Maps a parsed client message to a
// bridge action. Unit-tested in isolation (no sockets, no upstream).
// ───────────────────────────────────────────────────────────────────────────

/** Messages the owner's browser sends over the WS, before auth and after. */
export type InboundClientFrame =
  | { readonly type: 'auth'; readonly token?: string; readonly locale?: string }
  | { readonly type: 'audio'; readonly base64?: string; readonly sampleRate?: number; readonly mimeType?: string }
  | { readonly type: 'text'; readonly text?: string }
  | { readonly type: 'tool_result'; readonly callId?: string; readonly name?: string; readonly output?: Record<string, unknown> }
  | { readonly type: 'close' }
  | { readonly type: string; readonly [k: string]: unknown };

/** The decoded action the bridge should perform for an inbound frame. */
export type FrameAction =
  | { readonly action: 'authenticate'; readonly token: string | undefined; readonly locale: VoiceLocale }
  | { readonly action: 'push_audio'; readonly chunk: VoiceAudioChunk }
  | { readonly action: 'speak_text'; readonly text: string }
  | { readonly action: 'tool_result'; readonly callId?: string; readonly name: string; readonly output: Record<string, unknown> }
  | { readonly action: 'close' }
  | { readonly action: 'ignore'; readonly reason: string };

/**
 * Decode an inbound client frame into a `FrameAction`. Pure + total — every
 * input yields a defined action (unknown/malformed → `ignore` with a reason).
 * This is the unit-testable heart of the message-handling logic.
 */
export function routeInboundClientFrame(frame: InboundClientFrame): FrameAction {
  switch (frame.type) {
    case 'auth':
      return {
        action: 'authenticate',
        token: typeof frame.token === 'string' ? frame.token : undefined,
        locale: normalizeLocale(typeof frame.locale === 'string' ? frame.locale : undefined),
      };
    case 'audio': {
      if (typeof frame.base64 !== 'string' || frame.base64.length === 0) {
        return { action: 'ignore', reason: 'audio_frame_missing_base64' };
      }
      const bytes = decodeBase64Audio(frame.base64);
      if (!bytes) return { action: 'ignore', reason: 'audio_frame_bad_base64' };
      return {
        action: 'push_audio',
        chunk: {
          bytes,
          mimeType: normalizeMime(frame.mimeType),
          sampleRate: normalizeSampleRate(frame.sampleRate),
        },
      };
    }
    case 'text': {
      const text = typeof frame.text === 'string' ? frame.text.trim() : '';
      if (!text) return { action: 'ignore', reason: 'text_frame_empty' };
      return { action: 'speak_text', text };
    }
    case 'tool_result': {
      const name = typeof frame.name === 'string' ? frame.name : '';
      if (!name) return { action: 'ignore', reason: 'tool_result_missing_name' };
      return {
        action: 'tool_result',
        ...(typeof frame.callId === 'string' ? { callId: frame.callId } : {}),
        name,
        output:
          frame.output && typeof frame.output === 'object'
            ? (frame.output as Record<string, unknown>)
            : {},
      };
    }
    case 'close':
      return { action: 'close' };
    default:
      return { action: 'ignore', reason: `unknown_frame_type:${String(frame.type)}` };
  }
}

function decodeBase64Audio(base64: string): Uint8Array | null {
  try {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  } catch {
    return null;
  }
}

function normalizeMime(raw: unknown): VoiceAudioChunk['mimeType'] {
  if (raw === 'audio/opus' || raw === 'audio/wav') return raw;
  return 'audio/pcm';
}

function normalizeSampleRate(raw: unknown): VoiceAudioChunk['sampleRate'] {
  if (raw === 8000 || raw === 24000 || raw === 48000) return raw;
  return 16000;
}

// ───────────────────────────────────────────────────────────────────────────
// Tool-call dispatch — SAFE verbal-confirmation flow.
//
// Voice tool-calls now REACH the executor, but only through the same
// fail-closed gate the tapped surfaces use, and confirm-required verbs only
// after an explicit SPOKEN confirmation round-trip:
//
//   AUTO-SAFE (isSafeVerb → reminders): gate → execute immediately. "Remind
//     me…" runs by voice.
//   CONFIRM-REQUIRED (requiresConfirmation → create_site / add_employee /
//     create_licence / log_production / draft_payroll_run / draft_royalty_return):
//     NEVER executed on first mention. We mint a short-lived, single-use,
//     tenant-bound TOKEN and tell the model the action needs spoken
//     confirmation. The model asks the owner aloud; on a spoken "yes" it calls
//     the `confirm_pending_action` tool with the token → we validate (tenant
//     match + not expired), consume it, run the gate, and only THEN execute.
//   `confirm_pending_action`: the completion tool above.
//
// HARD RULES preserved:
//   • Fail-closed gate runs before EVERY execution (auto-safe AND the
//     confirmed path). On any gate error → deny, never execute.
//   • Tenant GUC bound via `SET LOCAL` inside a transaction before any
//     executor DB write (mirrors brain-teach.hono.ts) — never leaks to the
//     next pooled-connection request, never double-filters RLS.
//   • The executor (handlers) hash-chain-audit + RLS-scope every write; no
//     extra audit row is appended here.
//   • NO LedgerService from voice. Money/draft verbs: even WITH the token, the
//     gate runs (fails closed on HIGH-risk prefixes) and the executor only
//     creates a non-binding DRAFT header — voice never moves money.
// ───────────────────────────────────────────────────────────────────────────

/** The name the model must call to COMPLETE a confirm-required action. */
export const CONFIRM_PENDING_ACTION_TOOL = 'confirm_pending_action';

/**
 * Function declaration for the spoken-confirmation completion tool. Registered
 * by `buildVoiceToolDeclarations` so the realtime model can invoke it after the
 * owner verbally approves a pending confirm-required action.
 */
export const CONFIRM_PENDING_ACTION_DECLARATION: VoiceFunctionDeclaration =
  Object.freeze({
    name: CONFIRM_PENDING_ACTION_TOOL,
    description:
      'Complete a previously-proposed action that requires the owner\'s spoken ' +
      'confirmation. Call this ONLY after the owner has clearly said yes out ' +
      'loud, passing the exact confirmationToken you were given when the action ' +
      'was first proposed. Never call it pre-emptively or without an explicit ' +
      'spoken approval.',
    parameters: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description:
            'The confirmationToken returned when the action was first proposed.',
        },
      },
      required: ['token'],
    },
  });

/** Default token time-to-live: a confirmation must complete within ~2 minutes. */
export const CONFIRMATION_TTL_MS = 2 * 60 * 1000;

/**
 * Hard cap on simultaneously-pending confirmations PER PROCESS. Bounds the
 * in-memory store so an adversarial / looping model that proposes
 * confirm-required verbs without ever confirming cannot grow it without limit
 * (memory-DoS). When full, the oldest entry is evicted first — it would expire
 * soonest anyway. Generous vs. real usage: a voice session proposes one action
 * at a time. Disappears once the store moves to the flagged Redis TTL seam.
 */
export const MAX_PENDING_CONFIRMATIONS = 1000;

/**
 * One pending confirm-required action, awaiting a SPOKEN "yes". Bound to the
 * tenant that proposed it so a token can never be replayed across tenants.
 */
interface PendingConfirmation {
  readonly tenantId: string;
  readonly userId: string;
  readonly verb: string;
  readonly params: Record<string, unknown>;
  readonly expiresAt: number;
}

/**
 * In-memory, single-use confirmation-token store.
 *
 * ⚠️ MULTI-REPLICA FLAG: this Map is PER-PROCESS. It is correct for a single
 * gateway replica because a realtime voice session is pinned to one WS
 * connection — propose and confirm hit the SAME process. Under horizontal
 * scaling (multiple gateway replicas / pods) a confirm that lands on a
 * different replica than the propose would not find the token and would be
 * rejected (fail-closed — safe, but the owner would have to re-confirm). Before
 * running multi-replica, back this with a SHARED, TTL'd store keyed by token
 * (Redis `SET token … EX 120 NX` + atomic `GETDEL` on consume) so the
 * propose/confirm pair can cross replicas while staying single-use. The
 * surface below (`mintConfirmationToken` / `consumeConfirmationToken`) is the
 * exact seam to swap. See BRAIN_VOICE_RUNTIME_FLAGS.confirmationStore.
 */
const confirmationStore = new Map<string, PendingConfirmation>();

/** Drop expired tokens. Cheap lazy GC — runs on each mint/consume. */
function sweepExpiredConfirmations(now: number): void {
  for (const [token, pending] of confirmationStore) {
    if (pending.expiresAt <= now) confirmationStore.delete(token);
  }
}

/**
 * Mint a single-use confirmation token for a confirm-required action. The
 * token is an opaque UUID — it carries no verb/params itself, so an
 * intercepted token reveals nothing and cannot be forged into a different
 * action. `now`/`newToken` are injectable for deterministic tests.
 */
export function mintConfirmationToken(
  pending: Omit<PendingConfirmation, 'expiresAt'>,
  opts?: { readonly now?: number; readonly ttlMs?: number; readonly newToken?: () => string },
): { readonly token: string; readonly expiresAt: number } {
  const now = opts?.now ?? Date.now();
  sweepExpiredConfirmations(now);
  // Bound the store (memory-DoS guard). Map preserves insertion order, so the
  // first key is the oldest / soonest-to-expire — evict it first when full.
  while (confirmationStore.size >= MAX_PENDING_CONFIRMATIONS) {
    const oldest = confirmationStore.keys().next().value;
    if (oldest === undefined) break;
    confirmationStore.delete(oldest);
  }
  const token = (opts?.newToken ?? randomUUID)();
  const expiresAt = now + (opts?.ttlMs ?? CONFIRMATION_TTL_MS);
  confirmationStore.set(token, { ...pending, expiresAt });
  return { token, expiresAt };
}

/**
 * Look up + atomically CONSUME (single-use) a confirmation token, enforcing
 * tenant match, USER match, and expiry. Returns the pending action on success,
 * or a typed rejection reason. The token is removed whether or not validation
 * passes for an existing entry, so a token can never be used twice. Binding to
 * BOTH tenant and the originating user means a token proposed in one principal's
 * session can never be completed by a different user — even within the same
 * tenant (defense-in-depth for any future handler that trusts `created_by`).
 */
export function consumeConfirmationToken(
  token: string,
  ctx: { readonly tenantId: string; readonly userId: string; readonly now?: number },
):
  | { readonly ok: true; readonly pending: PendingConfirmation }
  | {
      readonly ok: false;
      readonly reason: 'unknown_token' | 'expired_token' | 'tenant_mismatch' | 'user_mismatch';
    } {
  const now = ctx.now ?? Date.now();
  const pending = confirmationStore.get(token);
  if (!pending) return { ok: false, reason: 'unknown_token' };
  // Single-use: remove on first lookup, before any further validation, so a
  // mismatched/expired token cannot be retried either.
  confirmationStore.delete(token);
  if (pending.expiresAt <= now) return { ok: false, reason: 'expired_token' };
  if (pending.tenantId !== ctx.tenantId) return { ok: false, reason: 'tenant_mismatch' };
  if (pending.userId !== ctx.userId) return { ok: false, reason: 'user_mismatch' };
  return { ok: true, pending };
}

/** Test-only: clear the in-memory token store between cases. */
export function __resetConfirmationStoreForTests(): void {
  confirmationStore.clear();
}

/**
 * Injectable seams for `dispatchVoiceToolCall`. Production uses the real
 * module-level db + gate + executor; tests pass stubs so the dispatch's own
 * branching (not Postgres / the kernel) is what's under test. `now`/`newToken`
 * make token lifecycle deterministic.
 */
export interface VoiceDispatchDeps {
  readonly db?: { transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T> } | null;
  readonly decideAuthorization?: typeof decideAutoAuthorization;
  readonly dispatch?: typeof dispatchAction;
  readonly now?: () => number;
  readonly newToken?: () => string;
}

/** Build the tenant scope the fail-closed gate authorizes against. */
function voiceScope(principal: BrainAuthPrincipal): ScopeContext {
  return {
    kind: 'tenant',
    tenantId: principal.tenantId,
    actorUserId: principal.userId,
    roles: [...principal.roles],
    personaId: 'mr-mwikila-head',
  };
}

/**
 * Run the fail-closed gate, then — only if authorized — dispatch the verb to
 * the typed executor inside a transaction whose `app.current_tenant_id` GUC is
 * bound with `SET LOCAL`. The bridge bypasses `databaseMiddleware`, so the
 * pooled connection has no tenant bound; binding it transaction-locally keeps
 * the executor's writes RLS-scoped to the caller and prevents the binding from
 * leaking to the next request that reuses the connection.
 *
 * Returns a model-facing envelope. Never throws for an authorization denial or
 * an unknown/failed verb (all become `executed:false` envelopes).
 */
async function gateAndExecuteVoiceAction(args: {
  readonly principal: BrainAuthPrincipal;
  readonly verb: string;
  readonly params: Record<string, unknown>;
  readonly rationale: string;
  readonly deps: VoiceDispatchDeps;
}): Promise<Record<string, unknown>> {
  const { principal, verb, params, rationale, deps } = args;
  const decide = deps.decideAuthorization ?? decideAutoAuthorization;
  const runDispatch = deps.dispatch ?? dispatchAction;
  const database = deps.db === undefined ? db() : deps.db;

  // 1) FAIL-CLOSED gate FIRST. The gate itself returns authorized:false on any
  //    internal error (never throws an allow); an exception here can only be a
  //    programmer error, which we also treat as a denial (defence-in-depth).
  let authorized = false;
  let reason = 'not_authorized';
  try {
    const decision = decide(verb, rationale, voiceScope(principal));
    authorized = decision.authorized;
    reason = decision.reason;
  } catch (err) {
    logger.error(
      {
        wiring: 'brain-voice-gate',
        verb,
        tenantId: principal.tenantId,
        error: err instanceof Error ? err.message : String(err),
      },
      'brain-voice: authorization gate threw (fail-closed deny)',
    );
    return { status: 'denied', executed: false, reason: 'gate_error_fail_closed', tool: verb };
  }

  if (!authorized) {
    logger.info(
      { wiring: 'brain-voice-gate', verb, tenantId: principal.tenantId, reason },
      'brain-voice: action not authorized',
    );
    return { status: 'denied', executed: false, reason, tool: verb };
  }

  // 2) No DB → cannot execute. Surface a graceful not-executed envelope rather
  //    than throwing, so the model narrates a deferral instead of crashing.
  if (!database) {
    logger.warn(
      { wiring: 'brain-voice-execute', verb, tenantId: principal.tenantId },
      'brain-voice: database unavailable — action authorized but not executed',
    );
    return { status: 'unavailable', executed: false, reason: 'database_unavailable', tool: verb };
  }

  // 3) Bind the tenant GUC transaction-locally, then dispatch. The executor's
  //    handlers RLS-scope + hash-chain-audit the write themselves.
  let dispatched: DispatchResult;
  try {
    dispatched = await database.transaction(async (tx) => {
      await (tx as { execute: (q: unknown) => Promise<unknown> }).execute(
        sql`SELECT set_config('app.current_tenant_id', ${principal.tenantId}, true)`,
      );
      const execCtx: ExecContext = {
        db: tx as unknown as ExecContext['db'],
        tenantId: principal.tenantId,
        userId: principal.userId,
        logger: logger as unknown as ExecContext['logger'],
      };
      return runDispatch(verb, params, execCtx);
    });
  } catch (err) {
    logger.error(
      {
        wiring: 'brain-voice-execute',
        verb,
        tenantId: principal.tenantId,
        error: err instanceof Error ? err.message : String(err),
      },
      'brain-voice: executor transaction threw',
    );
    return { status: 'error', executed: false, reason: 'execution_failed', tool: verb };
  }

  if (!dispatched.executed) {
    return { status: 'not_executed', executed: false, reason: dispatched.reason, tool: verb };
  }
  return {
    status: 'executed',
    executed: true,
    tool: verb,
    result: dispatched.result as unknown as Record<string, unknown>,
  };
}

/**
 * Dispatch a tool-call the realtime model emitted, applying the SAFE
 * verbal-confirmation flow.
 *
 * Routing:
 *   • `confirm_pending_action` → validate + consume the token, then gate +
 *     execute the originally-proposed verb (the spoken-"yes" completion).
 *   • AUTO-SAFE verb (isSafeVerb) → gate + execute immediately.
 *   • CONFIRM-REQUIRED verb (requiresConfirmation) → DO NOT execute; mint a
 *     single-use token and tell the model to ask for spoken confirmation.
 *   • Anything else (read tools / brain-catalog verbs not in the executor) →
 *     acknowledged, not executed (unchanged conversational behaviour).
 *
 * The tenant + principal are threaded; `deps` is injectable for tests.
 */
export async function dispatchVoiceToolCall(args: {
  readonly principal: BrainAuthPrincipal;
  readonly call: VoiceToolCall;
  readonly deps?: VoiceDispatchDeps;
}): Promise<Record<string, unknown>> {
  const { principal, call } = args;
  const deps = args.deps ?? {};
  const verb = call.name;

  logger.info(
    { tenantId: principal.tenantId, userId: principal.userId, tool: verb },
    'brain-voice: tool_call received',
  );

  // (A) Completion tool — the owner has spoken "yes"; finish a pending action.
  if (verb === CONFIRM_PENDING_ACTION_TOOL) {
    const token = typeof call.args?.token === 'string' ? call.args.token : '';
    if (!token) {
      return { status: 'rejected', executed: false, reason: 'missing_token', tool: verb };
    }
    const now = deps.now?.() ?? Date.now();
    const outcome = consumeConfirmationToken(token, {
      tenantId: principal.tenantId,
      userId: principal.userId,
      now,
    });
    if (!outcome.ok) {
      logger.warn(
        { wiring: 'brain-voice-confirm', tenantId: principal.tenantId, reason: outcome.reason },
        'brain-voice: confirmation token rejected',
      );
      return { status: 'rejected', executed: false, reason: outcome.reason };
    }
    // Token valid + consumed (single-use). Run the SAME gate + GUC-bound
    // dispatch as any other write — even here the gate fails closed on
    // HIGH-risk prefixes and money/draft verbs only ever create a draft.
    return gateAndExecuteVoiceAction({
      principal,
      verb: outcome.pending.verb,
      params: outcome.pending.params,
      rationale: `voice_confirmed:${outcome.pending.verb}`,
      deps,
    });
  }

  // (B) AUTO-SAFE verb (reminders) — gate + execute on first mention.
  if (isSafeVerb(verb)) {
    return gateAndExecuteVoiceAction({
      principal,
      verb,
      params: call.args,
      rationale: `voice_auto_safe:${verb}`,
      deps,
    });
  }

  // (C) CONFIRM-REQUIRED verb — NEVER execute on first mention. Mint a
  //     single-use, tenant-bound token and ask the model to seek spoken
  //     confirmation. Execution happens ONLY on the `confirm_pending_action`
  //     round-trip above.
  if (requiresConfirmation(verb)) {
    const { token, expiresAt } = mintConfirmationToken(
      { tenantId: principal.tenantId, userId: principal.userId, verb, params: call.args },
      {
        ...(deps.now ? { now: deps.now() } : {}),
        ...(deps.newToken ? { newToken: deps.newToken } : {}),
      },
    );
    logger.info(
      { wiring: 'brain-voice-confirm', verb, tenantId: principal.tenantId },
      'brain-voice: confirm-required verb pending spoken confirmation',
    );
    return {
      status: 'confirmation_required',
      executed: false,
      tool: verb,
      confirmationToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
      instruction:
        'This action changes durable records and must be confirmed by the owner ' +
        'out loud first. Briefly restate what will happen, ask the owner to ' +
        'confirm, and ONLY after a clear spoken "yes" call the ' +
        `${CONFIRM_PENDING_ACTION_TOOL} tool with this confirmationToken. Do not ` +
        'imply the action is done yet.',
    };
  }

  // (D) Anything else (read tools / brain-catalog verbs outside the executor
  //     registry) — acknowledged, NOT executed. Unchanged conversational
  //     behaviour; the persona forbids implying completion.
  return {
    status: 'acknowledged',
    executed: false,
    tool: verb,
    note: 'This is not a write action wired into the action-executor from voice; it was acknowledged only.',
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Session bridge — owns one owner↔model conversation. Transport-agnostic: the
// WS-upgrade adapter feeds it parsed inbound frames and consumes its outbound
// events via the `emit` callback.
// ───────────────────────────────────────────────────────────────────────────

export interface VoiceSessionDeps {
  /** Emit an outbound event toward the owner's browser. */
  readonly emit: (event: BridgeOutboundEvent) => void;
  /** Override the upstream opener for tests. */
  readonly openUpstream?: (a: OpenGeminiUpstreamArgs) => DuplexUpstream;
}

/**
 * One realtime voice session. Lifecycle:
 *   1. `handleFrame({type:'auth', token})` → verify JWT, bind tenant, open
 *      the Gemini Live upstream with persona + tools, emit `ready`.
 *   2. Subsequent `audio` / `text` / `tool_result` frames are forwarded to
 *      the upstream.
 *   3. Upstream audio / transcripts / tool-calls are emitted back; tool-calls
 *      are dispatched (deferred) and their result fed back to the model.
 */
export class VoiceSession {
  private principal: BrainAuthPrincipal | null = null;
  private upstream: DuplexUpstream | null = null;
  private locale: VoiceLocale = 'en';
  private closed = false;

  constructor(private readonly deps: VoiceSessionDeps) {}

  /** Feed a raw (already JSON-parsed) inbound client frame. */
  async handleFrame(raw: InboundClientFrame): Promise<void> {
    if (this.closed) return;
    const decoded = routeInboundClientFrame(raw);
    switch (decoded.action) {
      case 'authenticate':
        await this.authenticate(decoded.token, decoded.locale);
        return;
      case 'push_audio':
        if (this.requireReady()) this.upstream!.pushAudio(decoded.chunk);
        return;
      case 'speak_text':
        if (this.requireReady()) this.upstream!.speakText(decoded.text);
        return;
      case 'tool_result':
        if (this.requireReady()) {
          this.upstream!.respondToToolCall({
            ...(decoded.callId !== undefined ? { callId: decoded.callId } : {}),
            name: decoded.name,
            output: decoded.output,
          });
        }
        return;
      case 'close':
        this.close();
        return;
      case 'ignore':
        logger.debug({ reason: decoded.reason }, 'brain-voice: inbound frame ignored');
        return;
    }
  }

  private requireReady(): boolean {
    if (!this.upstream) {
      this.deps.emit({ kind: 'error', code: 'not_authenticated', message: 'Send an auth frame first.' });
      return false;
    }
    return true;
  }

  private async authenticate(token: string | undefined, locale: VoiceLocale): Promise<void> {
    if (this.upstream) return; // already authenticated — ignore re-auth
    try {
      this.principal = await authenticateVoiceHandshake(token);
      this.locale = locale;
    } catch (err) {
      const status = err instanceof SupabaseAuthError ? err.status : 401;
      logger.warn({ status }, 'brain-voice: handshake auth failed');
      this.deps.emit({ kind: 'error', code: 'unauthorized', message: 'Authentication failed.' });
      this.close();
      return;
    }
    await this.openUpstream();
  }

  private async openUpstream(): Promise<void> {
    const principal = this.principal!;
    const tenantId = principal.tenantId;
    // Provider-selectable (VOICE_PROVIDER): gemini (default) | openai. Tests
    // still override via deps.openUpstream; production picks per config.
    const opener = this.deps.openUpstream ?? openVoiceUpstream;
    try {
      this.upstream = opener({
        systemInstruction: buildVoiceSystemInstruction(this.locale),
        tools: buildVoiceToolDeclarations(tenantId),
        locale: this.locale,
        tenantId,
        callbacks: this.upstreamCallbacks(principal),
      });
      this.deps.emit({ kind: 'ready', sessionId: this.upstream.sessionId, locale: this.locale });
      logger.info({ tenantId, locale: this.locale }, 'brain-voice: realtime session ready');
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), tenantId },
        'brain-voice: failed to open realtime upstream',
      );
      this.deps.emit({
        kind: 'error',
        code: 'provider_unavailable',
        message: 'Realtime voice provider is not available (missing key or upstream error).',
      });
      this.close();
    }
  }

  private upstreamCallbacks(principal: BrainAuthPrincipal): UpstreamCallbacks {
    return {
      onAudio: (base64, sampleRate, isFinal) =>
        this.deps.emit({ kind: 'audio', base64, sampleRate, isFinal }),
      onTranscript: (text, isFinal, speaker) =>
        this.deps.emit({ kind: 'transcript', text, isFinal, speaker }),
      onToolCall: (call) => {
        void this.onToolCall(principal, call);
      },
      onError: (code, message) => this.deps.emit({ kind: 'error', code, message }),
      onClose: () => this.close(),
    };
  }

  private async onToolCall(principal: BrainAuthPrincipal, call: VoiceToolCall): Promise<void> {
    this.deps.emit({ kind: 'tool_call', name: call.name, status: 'started' });
    try {
      const output = await dispatchVoiceToolCall({ principal, call });
      this.upstream?.respondToToolCall({
        ...(call.callId !== undefined ? { callId: call.callId } : {}),
        name: call.name,
        output,
      });
      this.deps.emit({ kind: 'tool_call', name: call.name, status: 'ok' });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err), tool: call.name },
        'brain-voice: tool dispatch failed',
      );
      this.upstream?.respondToToolCall({
        ...(call.callId !== undefined ? { callId: call.callId } : {}),
        name: call.name,
        output: { status: 'error', executed: false },
      });
      this.deps.emit({ kind: 'tool_call', name: call.name, status: 'error' });
    }
  }

  /** Tear down the upstream + mark closed. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.upstream?.close();
    } catch {
      /* already closed */
    }
    this.upstream = null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// WS-UPGRADE TRANSPORT — the one piece that needs a runtime dependency.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Minimal client-socket shape (matches the `ws` package's `WebSocket`). The
 * transport adapter wraps each accepted connection in this so the rest of the
 * file never depends on `ws` types (which are not installed).
 */
export interface ClientSocketLike {
  send(data: string): void;
  close(): void;
  on(event: 'message' | 'close' | 'error', listener: (arg?: unknown) => void): void;
}

/**
 * Factory that upgrades raw HTTP `upgrade` events on the given path into
 * `ClientSocketLike` connections, invoking `onConnection` per accepted socket
 * with the parsed query string. Implemented by `ws.WebSocketServer` or
 * `@hono/node-ws` at the call site — neither of which is installed yet.
 */
export type WebSocketServerLike = (deps: {
  readonly server: HttpServer;
  readonly path: string;
  readonly onConnection: (socket: ClientSocketLike, query: URLSearchParams) => void;
}) => void;

const VOICE_WS_PATH = '/api/v1/brain/voice/stream';

/**
 * Attach the brain-voice WebSocket endpoint to the gateway's HTTP server.
 *
 * REAL + READY, but transport-gated: when no `webSocketServerFactory` is
 * supplied this logs a precise warning and NO-OPS — it never throws, so gateway
 * boot is unchanged. The real `ws`-backed factory is built by
 * `composition/voice/voice-wiring.ts` (`createVoiceWiring`); once it is passed
 * here the endpoint goes fully live with zero changes to the bridge logic
 * above.
 *
 * Each accepted connection gets its own `VoiceSession`; inbound text frames
 * are JSON-parsed and routed; outbound events are serialised back to the
 * client socket.
 */
export function attachBrainVoiceWebSocket(deps: {
  readonly server: HttpServer;
  readonly webSocketServerFactory?: WebSocketServerLike;
}): void {
  if (!deps.webSocketServerFactory) {
    logger.warn(
      { path: VOICE_WS_PATH },
      'brain-voice: WS-upgrade transport not wired (install `ws` + pass webSocketServerFactory). ' +
        'Endpoint is INACTIVE — see §RUNTIME-FLAGS in routes/brain-voice.hono.ts.',
    );
    return;
  }

  deps.webSocketServerFactory({
    server: deps.server,
    path: VOICE_WS_PATH,
    onConnection: (socket, query) => {
      const session = new VoiceSession({
        emit: (event) => {
          try {
            socket.send(JSON.stringify(event));
          } catch (err) {
            logger.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'brain-voice: failed to send outbound frame',
            );
          }
        },
      });

      // Browsers cannot set WS request headers, so the token may ride the
      // query string. If present, kick the auth handshake immediately.
      const queryToken = query.get('token') ?? undefined;
      const queryLocale = query.get('locale') ?? undefined;
      if (queryToken) {
        void session.handleFrame({ type: 'auth', token: queryToken, locale: queryLocale });
      }

      socket.on('message', (raw) => {
        const parsed = parseClientTextFrame(raw);
        if (!parsed) return;
        void session.handleFrame(parsed);
      });
      socket.on('close', () => session.close());
      socket.on('error', () => session.close());
    },
  });

  logger.info({ path: VOICE_WS_PATH }, 'brain-voice: realtime WS endpoint attached');
}

/** Parse a client text frame to an `InboundClientFrame`. Tolerant — bad JSON → null. */
export function parseClientTextFrame(raw: unknown): InboundClientFrame | null {
  try {
    let text: string;
    if (typeof raw === 'string') text = raw;
    else if (raw instanceof Buffer) text = raw.toString('utf8');
    else if (raw instanceof Uint8Array) text = Buffer.from(raw).toString('utf8');
    else if (raw && typeof raw === 'object' && 'toString' in raw) text = String(raw);
    else return null;
    const obj = JSON.parse(text) as unknown;
    if (!obj || typeof obj !== 'object' || typeof (obj as { type?: unknown }).type !== 'string') {
      return null;
    }
    return obj as InboundClientFrame;
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// §RUNTIME-FLAGS — what must be validated against real infra before this is
// a fully-live voice channel. Exported so a smoke-test / readiness probe can
// assert on it.
// ───────────────────────────────────────────────────────────────────────────

export const BRAIN_VOICE_RUNTIME_FLAGS = Object.freeze({
  wsUpgrade:
    'WS-UPGRADE TRANSPORT: gateway HTTP server is Express; the real `ws`-backed ' +
    '`webSocketServerFactory` is built in composition/voice/voice-wiring.ts and mounted ' +
    'via createVoiceWiring({ server }) after app.listen. When that factory is passed to ' +
    'attachBrainVoiceWebSocket the endpoint is LIVE; without it (e.g. `ws` unavailable) ' +
    'attach NO-OPs and the endpoint stays INACTIVE.',
  providerKey:
    'PROVIDER KEY: VOICE_PROVIDER selects the upstream — `gemini` (DEFAULT, ' +
    'native-audio duplex; needs GEMINI_API_KEY) or `openai` (gpt-realtime ' +
    'speech-to-speech, server-VAD; needs OPENAI_API_KEY, optional ' +
    'OPENAI_VOICE_MODEL / OPENAI_TRANSCRIPTION_MODEL). Default stays gemini so ' +
    'an absent OPENAI_API_KEY breaks nothing. Without the selected provider\'s ' +
    'key, sessions emit `provider_unavailable`.',
  audioCodec:
    'AUDIO CODEC: client must stream 16 kHz mono PCM little-endian (audio/pcm); ' +
    'Gemini returns 24 kHz PCM. Opus transcode + sample-rate negotiation are not ' +
    'handled here.',
  toolDispatch:
    'TOOL DISPATCH: WIRED. Auto-safe verbs (reminders) execute on first mention; ' +
    'confirm-required verbs (sites / employees / licences / production / payroll & ' +
    'royalty DRAFTS) execute ONLY after an explicit SPOKEN confirmation via the ' +
    'confirm_pending_action token round-trip. Every execution passes the fail-closed ' +
    'gate, binds the tenant GUC (SET LOCAL), and the executor hash-chain-audits + ' +
    'RLS-scopes the write. NO LedgerService from voice — money/draft verbs only ever ' +
    'create a non-binding draft. See dispatchVoiceToolCall.',
  confirmationStore:
    'CONFIRMATION STORE: the pending-confirmation token Map is PER-PROCESS (correct ' +
    'for a single replica — a voice session is pinned to one WS connection, so ' +
    'propose + confirm hit the same process). For MULTI-REPLICA gateways back it with ' +
    'a shared TTL store (Redis SET … EX 120 NX + atomic GETDEL on consume) so the ' +
    'propose/confirm pair can cross replicas while staying single-use; swap at ' +
    'mintConfirmationToken / consumeConfirmationToken.',
} as const);
