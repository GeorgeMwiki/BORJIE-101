/**
 * Voice-agent wiring — composes the conversational `createVoiceAgent`
 * factory from `@borjie/ai-copilot/ai-native` (namespace `VoiceAgent`)
 * with the Drizzle-backed `voice_turns` storage adapter shipped from
 * `@borjie/database` (`createVoiceTurnsService`, migration 0110).
 *
 * STT, TTS, and CustomerResolver ports are intentionally `null` here —
 * production deployment of those adapters lands in a follow-up. The
 * agent itself supports `null` for all three: STT-missing requests fall
 * back to inline transcripts, TTS-missing turns degrade to text-only
 * responses, and an unresolved caller still gets answered (just without
 * personalized context).
 *
 * The `VoiceBrainPort` is wired in two modes:
 *
 *   - When `deps.kernelThink` is provided (the central-intelligence
 *     `BrainKernel.think` reference), the brain adapts every turn into
 *     a `ThoughtRequest`, invokes the kernel's disciplined 13-step
 *     pipeline, and maps the resulting `BrainDecision` back onto the
 *     voice-agent's `VoiceBrainResponse` shape — model version is
 *     surfaced from the decision provenance, refusals and softens
 *     degrade gracefully into a text reply, tenant isolation is
 *     preserved on every kernel call.
 *   - When `kernelThink` is null/undefined the wiring falls back to a
 *     polite degraded stub that signals `VOICE_BRAIN_NOT_CONFIGURED`
 *     in the detected language — same behaviour as commit f3f02d2.
 *
 * Tenant isolation: enforced by the agent's input contract
 * (`tenantId` mandatory on every turn), by the storage adapter's
 * `tenant_id` column index on every read/write, and by the kernel
 * adapter scoping every `ThoughtRequest.scope` to the calling tenant.
 *
 * Duck-typed kernel coupling: `kernelThink` is duck-typed via
 * structural input/output shapes so this composition file remains
 * importable even when `@borjie/central-intelligence` is not
 * installed (test isolation, partial deployments, lighter-weight
 * service builds).
 */

import { createDatabaseClient, createVoiceTurnsService } from '@borjie/database';
import { VoiceAgent as VoiceAgentNs } from '@borjie/ai-copilot/ai-native';
import {
  withAgentSpan,
  recordDegraded,
} from '../instrumentation/agent-spans.js';

/**
 * DatabaseClient + VoiceTurnsService types derived via `ReturnType<typeof
 * factory>` to sidestep the package-barrel namespace/type drift
 * (TS2709) — see `service-registry.ts` and `classroom-wiring.ts` for
 * the full explanation.
 */
type DatabaseClient = ReturnType<typeof createDatabaseClient>;
type VoiceTurnsService = ReturnType<typeof createVoiceTurnsService>;
type VoiceTurnRowShape = Awaited<ReturnType<VoiceTurnsService['list']>>[number];

type VoiceAgent = ReturnType<typeof VoiceAgentNs.createVoiceAgent>;
type VoiceTurnRow = VoiceAgentNs.VoiceTurnRow;
type VoiceTurnRepository = VoiceAgentNs.VoiceTurnRepository;
type VoiceBrainPort = VoiceAgentNs.VoiceBrainPort;
type VoiceBrainResponse = VoiceAgentNs.VoiceBrainResponse;

/**
 * Structural shape of `BrainKernel.think` from
 * `@borjie/central-intelligence`. Duck-typed so this file does
 * NOT pull a hard import on the kernel package — composition root
 * binds the real reference at registry-construction time.
 *
 * The kernel's `ThoughtRequest` exposes more knobs than the voice
 * agent needs (attachments, judge requests, ipHash). The adapter
 * builds the minimal request shape from the per-turn voice input and
 * leaves optional fields unset.
 */
export interface KernelThoughtRequestLike {
  readonly threadId: string;
  readonly userMessage: string;
  readonly scope:
    | {
        readonly kind: 'tenant';
        readonly tenantId: string;
        readonly actorUserId: string;
        readonly roles: ReadonlyArray<string>;
        readonly personaId: string;
      }
    | {
        readonly kind: 'platform';
        readonly actorUserId: string;
        readonly roles: ReadonlyArray<string>;
        readonly personaId: string;
      };
  readonly tier:
    | 'tenant'
    | 'lease'
    | 'unit'
    | 'block'
    | 'property'
    | 'portfolio'
    | 'org'
    | 'industry';
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  readonly surface:
    | 'marketing'
    | 'tenant-app'
    | 'owner-portal'
    | 'estate-manager-app'
    | 'admin-portal'
    | 'platform-hq'
    | 'classroom';
}

/**
 * Structural shape of the kernel's `BrainDecision` discriminated
 * union. Adapter only reads the fields it needs (`text`, `reason`,
 * `provenance.modelId`).
 */
export interface KernelBrainDecisionLike {
  readonly kind: 'answer' | 'softened' | 'refusal';
  readonly text?: string;
  readonly reason?: string;
  readonly provenance: {
    readonly modelId: string;
  };
}

export type KernelThinkFn = (
  req: KernelThoughtRequestLike,
) => Promise<KernelBrainDecisionLike>;

export interface VoiceAgentWiringDeps {
  readonly db: DatabaseClient | null;
  readonly logger?: { warn(meta: object, msg: string): void };
  /**
   * Optional reference to `BrainKernel.think` from
   * `@borjie/central-intelligence`. When provided, every voice
   * turn round-trips through the kernel's 13-step disciplined
   * pipeline. When null/undefined, the wiring falls back to the
   * polite degraded stub that emits `VOICE_BRAIN_NOT_CONFIGURED`.
   */
  readonly kernelThink?: KernelThinkFn | null;
}

export interface VoiceAgentWiring {
  readonly agent: VoiceAgent;
}

/**
 * Polite degraded-mode reply text per detected language. Operators
 * see `VOICE_BRAIN_NOT_CONFIGURED` in logs; callers hear an apology
 * in their own language. Languages fall back to English.
 */
const DEGRADED_REPLIES: Readonly<Record<string, string>> = Object.freeze({
  en: 'Thanks for calling. The voice service is not yet fully configured here. A team member will follow up.',
  sw: 'Asante kwa kupiga simu. Huduma ya sauti bado haijasanidiwa kikamilifu. Mwanachama wa timu atafuatilia.',
  es: 'Gracias por llamar. El servicio de voz aún no está completamente configurado. Un miembro del equipo lo contactará.',
  fr: 'Merci de votre appel. Le service vocal n’est pas encore entièrement configuré. Un membre de l’équipe vous recontactera.',
});

/**
 * Ultra-light language heuristic — mirrors `heuristicDetect` in the
 * agent so the brain stub picks the same code the agent emits when
 * STT does not provide one. Never hard-code English as the only
 * choice; this is a fallback chain, not a jurisdiction lock.
 */
function detectLanguageFromTranscript(text: string): string {
  const lower = text.toLowerCase();
  if (/(habari|asante|karibu|nyumba|jambo)/.test(lower)) return 'sw';
  if (/\b(hola|gracias|por favor)\b/.test(lower)) return 'es';
  if (/\b(bonjour|merci|s'il vous plait)\b/.test(lower)) return 'fr';
  return 'en';
}

/**
 * Build the degraded-mode `VoiceBrainPort`.
 *
 * Used when `kernelThink` is not wired (`KERNEL_NOT_WIRED`). Every
 * turn returns a polite "voice service not yet configured" reply in
 * the detected language. `modelVersion` is tagged
 * `VOICE_BRAIN_NOT_CONFIGURED` so audit and dashboards can flag these
 * turns explicitly.
 */
function createDegradedVoiceBrainStub(
  logger?: VoiceAgentWiringDeps['logger'],
): VoiceBrainPort {
  recordDegraded('voice-agent', 'VoiceBrainPort', 'KERNEL_NOT_WIRED');
  if (logger) {
    logger.warn(
      {
        port: 'VoiceBrainPort',
        degraded_reason: 'KERNEL_NOT_WIRED',
      },
      'voice-brain stub installed (KERNEL_NOT_WIRED)',
    );
  }
  return {
    async turn(input) {
      const lang = input.languageCode || detectLanguageFromTranscript(input.userTranscript);
      const reply = DEGRADED_REPLIES[lang] ?? DEGRADED_REPLIES.en;
      if (logger) {
        logger.warn(
          {
            tenantId: input.tenantId,
            sessionId: input.sessionId,
            languageCode: lang,
            promptHash: input.promptHash,
          },
          'voice-brain stub invoked (VOICE_BRAIN_NOT_CONFIGURED)',
        );
      }
      const response: VoiceBrainResponse = {
        text: reply,
        toolCalls: [],
        modelVersion: 'VOICE_BRAIN_NOT_CONFIGURED',
        inputTokens: 0,
        outputTokens: 0,
        costUsdMicro: 0,
      };
      return response;
    },
  };
}

/**
 * Persona id used when the voice agent constructs a kernel scope. The
 * kernel's `selectPersona(req)` consults `req.surface` (the voice
 * surface maps to the tenant-app default persona) so this id is the
 * fallback identifier carried through provenance / audit only — it
 * does NOT control persona selection. Surface-level persona binding
 * happens inside the kernel's identity layer.
 */
const KERNEL_VOICE_PERSONA_ID = 'voice-agent-default';

/**
 * Default actor id used when no caller-side actor is resolved. The
 * voice surface today routes anonymous calls before a customer is
 * matched (resolver port unwired); the kernel still requires a non-
 * empty `actorUserId` for memory recall. We use a stable per-session
 * identifier so memory entries cohere across turns of one call.
 */
function deriveActorUserId(input: {
  readonly customerId: string | null;
  readonly sessionId: string;
}): string {
  return input.customerId ?? `voice-session:${input.sessionId}`;
}

/**
 * Build a real `VoiceBrainPort` backed by the central-intelligence
 * kernel. Adapter is intentionally narrow — voice turns are short,
 * streaming-capable, and tenant-scoped.
 */
function createRealVoiceBrain(
  kernelThink: KernelThinkFn,
  logger?: VoiceAgentWiringDeps['logger'],
): VoiceBrainPort {
  return {
    async turn(input) {
      const actorUserId = deriveActorUserId({
        customerId: input.customerId,
        sessionId: input.sessionId,
      });

      const req: KernelThoughtRequestLike = {
        threadId: input.sessionId,
        userMessage: input.userTranscript,
        scope: {
          kind: 'tenant',
          tenantId: input.tenantId,
          actorUserId,
          roles: ['tenant'],
          personaId: KERNEL_VOICE_PERSONA_ID,
        },
        tier: 'tenant',
        // Voice turns favour latency over depth — `medium` skips the
        // judge and extended-thinking branches in the kernel.
        stakes: 'medium',
        surface: 'tenant-app',
      };

      try {
        const decision = await kernelThink(req);
        const text = pickVoiceTextFromDecision(decision, input.languageCode || detectLanguageFromTranscript(input.userTranscript));
        const response: VoiceBrainResponse = {
          text,
          toolCalls: [],
          modelVersion: decision.provenance.modelId,
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicro: 0,
        };
        return response;
      } catch (error) {
        recordDegraded(
          'voice-agent',
          'VoiceBrainPort',
          'KERNEL_THINK_FAILED',
        );
        if (logger) {
          logger.warn(
            {
              port: 'VoiceBrainPort',
              tenantId: input.tenantId,
              sessionId: input.sessionId,
              promptHash: input.promptHash,
              degraded_reason: 'KERNEL_THINK_FAILED',
              error: error instanceof Error ? error.message : String(error),
            },
            'kernel.think threw — degrading voice turn',
          );
        }
        const lang =
          input.languageCode || detectLanguageFromTranscript(input.userTranscript);
        const reply = DEGRADED_REPLIES[lang] ?? DEGRADED_REPLIES.en;
        const response: VoiceBrainResponse = {
          text: reply,
          toolCalls: [],
          modelVersion: 'VOICE_BRAIN_KERNEL_ERROR',
          inputTokens: 0,
          outputTokens: 0,
          costUsdMicro: 0,
        };
        return response;
      }
    },
  };
}

/**
 * Map a kernel `BrainDecision` onto a voice text reply.
 *
 *   - `answer`   → the answer text verbatim.
 *   - `softened` → the softened text (the hedge is dropped from the
 *     spoken reply since voice surfaces lack room for an inline
 *     "but"; future work will read the hedge as a follow-up turn).
 *   - `refusal`  → the polite degraded reply in the caller's
 *     language. The `reason` is logged separately by the kernel's
 *     drift / policy gates.
 */
function pickVoiceTextFromDecision(
  decision: KernelBrainDecisionLike,
  fallbackLanguage: string,
): string {
  if (decision.kind === 'answer' || decision.kind === 'softened') {
    return decision.text ?? DEGRADED_REPLIES[fallbackLanguage] ?? DEGRADED_REPLIES.en;
  }
  return DEGRADED_REPLIES[fallbackLanguage] ?? DEGRADED_REPLIES.en;
}

/**
 * Adapt the DB-package `VoiceTurnsService` (duck-typed `VoiceTurnRowShape`)
 * to the agent's `VoiceTurnRepository` (`VoiceTurnRow`). Both shapes are
 * structurally compatible; this thin wrapper exists so a future schema
 * drift between the two cannot break the agent at runtime.
 */
function adaptToVoiceTurnRepository(
  service: VoiceTurnsService,
): VoiceTurnRepository {
  return {
    async insert(row: VoiceTurnRow) {
      const persisted = await service.insert(rowToShape(row));
      return shapeToRow(persisted);
    },
    async countBySession(tenantId, sessionId) {
      return service.countBySession(tenantId, sessionId);
    },
    async list(tenantId, sessionId) {
      const shapes = await service.list(tenantId, sessionId);
      return shapes.map(shapeToRow);
    },
  };
}

function rowToShape(row: VoiceTurnRow): VoiceTurnRowShape {
  return {
    id: row.id,
    tenantId: row.tenantId,
    sessionId: row.sessionId,
    turnIndex: row.turnIndex,
    customerId: row.customerId,
    detectedLanguage: row.detectedLanguage,
    inputTranscript: row.inputTranscript,
    responseText: row.responseText,
    responseAudioRef: row.responseAudioRef,
    toolCalls: row.toolCalls.map((tc) => ({
      name: tc.name,
      arguments: tc.arguments,
      result: tc.result,
      error: tc.error,
    })),
    degradedMode: row.degradedMode,
    modelVersion: row.modelVersion,
    promptHash: row.promptHash,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt,
  };
}

function shapeToRow(shape: VoiceTurnRowShape): VoiceTurnRow {
  return {
    id: shape.id,
    tenantId: shape.tenantId,
    sessionId: shape.sessionId,
    turnIndex: shape.turnIndex,
    customerId: shape.customerId,
    detectedLanguage: shape.detectedLanguage,
    inputTranscript: shape.inputTranscript,
    responseText: shape.responseText,
    responseAudioRef: shape.responseAudioRef,
    toolCalls: shape.toolCalls.map((tc) => ({
      name: tc.name,
      arguments: tc.arguments,
      result: tc.result,
      error: tc.error,
    })),
    degradedMode: shape.degradedMode,
    modelVersion: shape.modelVersion,
    promptHash: shape.promptHash,
    latencyMs: shape.latencyMs,
    createdAt: shape.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Wire the voice-agent. Returns `null` when the database client is
 * unavailable — the caller (composition root) decides whether to skip
 * registration or fall through to a 503 on the voice routes.
 */
export function createVoiceAgentWiring(
  deps: VoiceAgentWiringDeps,
): VoiceAgentWiring | null {
  if (!deps.db) return null;

  const turnsService = createVoiceTurnsService(deps.db);
  const repo = adaptToVoiceTurnRepository(turnsService);
  const brain = deps.kernelThink
    ? createRealVoiceBrain(deps.kernelThink, deps.logger)
    : createDegradedVoiceBrainStub(deps.logger);

  const agent = VoiceAgentNs.createVoiceAgent({
    brain,
    repo,
    stt: null,
    tts: null,
    // resolveCustomer intentionally omitted — agent tolerates undefined and
    // resolves customerId to null for the turn (best-effort contract).
  });

  return Object.freeze({ agent: instrumentVoiceAgent(agent) });
}

/**
 * Wrap the voice agent's `turn(...)` method in `withAgentSpan(...)` so
 * each call emits an `agent.voice-agent.turn` span (with `tenant_id`
 * + `sessionId` attributes) and bumps the per-agent counter +
 * latency histogram. Returns a fresh frozen object — does not mutate
 * the underlying agent.
 */
function instrumentVoiceAgent(agent: VoiceAgent): VoiceAgent {
  return Object.freeze({
    turn(input) {
      return withAgentSpan(
        'voice-agent',
        'turn',
        () => agent.turn(input),
        {
          tenantId: input?.tenantId ?? null,
          attributes: {
            ...(input?.sessionId && { sessionId: input.sessionId }),
            ...(input?.languageCode && { languageCode: input.languageCode }),
          },
        },
      );
    },
  });
}
