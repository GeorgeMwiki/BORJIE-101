/**
 * Orchestrator — deterministic state machine routing turns through personae.
 *
 * This is the heart of the Brain. It does NOT use an LLM for routing — the
 * LLM proposes intent/actions inside a persona's response; the Orchestrator
 * interprets those proposals and enforces policy, RBAC, visibility, and
 * human review gates.
 *
 * Turn lifecycle (per design rule #1):
 *   1. Receive user message -> append to thread as user_message.
 *   2. If thread has no primary persona, classify intent and bind one.
 *   3. Compose persona context: system prompt + handoff packet (if any) +
 *      filtered thread view + available tools.
 *   4. Execute persona via AdvisorExecutor (executor + optional Opus advice).
 *   5. Append persona_message to thread.
 *   6. Parse response for:
 *      - Tool calls (dispatched via ToolDispatcher, appended as events).
 *      - PROPOSED_ACTION (routed to Review Service if risk >= persona floor).
 *      - HANDOFF_TO (constructs HandoffPacket, appends handoff_out, recurses
 *        into the target persona).
 *   7. Return the final synthesized response + trace ids to the caller.
 *
 * Recursion depth on handoff is bounded (default 3) to prevent cycles.
 */

import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import {
  AITenantContext,
  AIActor,
  AIResult,
  aiOk,
  aiErr,
  RiskLevel,
} from '../types/core.types.js';
import { Persona, PersonaRegistry, bindPersona } from '../personas/persona.js';
import {
  ThreadStore,
  ThreadEvent,
  UserMessageEvent,
} from '../thread/thread-store.js';
import {
  VisibilityLabel,
  VisibilityScope,
  VisibilityViewer,
} from '../thread/visibility.js';
import {
  HandoffPacket,
  renderHandoffPacket,
} from '../thread/handoff-packet.js';
import {
  classifyInitialTurn,
  parseHandoffDirective,
  parseProposedAction,
} from './intent-router.js';
import { ToolDispatcher } from './tool-dispatcher.js';
import {
  AdvisorExecutor,
  AdvisorHardCategory,
} from '../providers/advisor.js';
import {
  AIProvider,
  AIMessage,
  MediaAttachment,
} from '../providers/ai-provider.js';
import {
  ANTHROPIC_MODELS,
  buildToolResultMessage,
  buildMultimodalUserMessage,
  anthropicModelSupportsVision,
} from '../providers/anthropic.js';
import { CompiledPrompt } from '../types/prompt.types.js';
import { asPromptId } from '../types/core.types.js';
import { ReviewService } from '../services/review-service.js';
import { AIGovernanceService } from '../governance/ai-governance.js';
import type { OwnerStyleService } from '../personas/owner-style/index.js';
import { logger } from '../logger.js';
import {
  spotlight,
  UNTRUSTED_BOUNDARY_DIRECTIVE,
  type IndirectContentScanner,
} from './untrusted-content.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Maximum decoded size (in bytes) of any single multimodal attachment.
 * The api-gateway accepts a slightly looser 10 MB total upload limit;
 * the orchestrator enforces 5 MB per attachment as defence-in-depth.
 */
export const MAX_MEDIA_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * Maximum number of media attachments allowed in a single multimodal turn.
 */
export const MAX_MEDIA_ATTACHMENTS_PER_TURN = 20;

export interface TurnRequest {
  threadId: string;
  tenant: AITenantContext;
  actor: AIActor;
  userText: string;
  attachments?: UserMessageEvent['attachments'];
  /**
   * Multimodal attachments (vision turns). When present, the orchestrator
   * builds an Anthropic content-array first turn (text + image blocks) and
   * targets a vision-capable model. Validated for size (<=5 MB decoded
   * each) and count (<=20) before reaching the provider.
   */
  mediaAttachments?: ReadonlyArray<MediaAttachment>;
  /** Explicit persona override (e.g. employee chatting with Coworker). */
  forcePersonaId?: string;
  /** Viewer for visibility filtering when rendering context. */
  viewer: VisibilityViewer;
  /** Max handoff depth for this turn. Defaults to 3. */
  maxHandoffDepth?: number;
  /** Max tool-call loop iterations per persona invocation. Default 5. */
  maxToolLoopIterations?: number;
}

export interface TurnResult {
  threadId: string;
  /** Final persona that produced the user-visible response. */
  finalPersonaId: string;
  /** The persona's text. */
  responseText: string;
  /** Tool calls made during the turn. */
  toolCalls: Array<{ tool: string; ok: boolean }>;
  /** Any handoffs that happened. */
  handoffs: Array<{ from: string; to: string; objective: string }>;
  /** Proposed action if the persona emitted one. */
  proposedAction?: {
    verb: string;
    object: string;
    riskLevel: RiskLevel;
    reviewRequired: boolean;
    /**
     * When true, the action is BLOCKED from execution until a
     * `review_decision` event with `decision: "approved"` arrives on the
     * thread. Callers must treat this as a hard gate, not a hint.
     */
    executionHeld?: boolean;
  };
  /** Whether Opus advisor was consulted on the final turn. */
  advisorConsulted: boolean;
  /** Total token usage across all LLM calls in this turn. */
  tokensUsed: number;
  /** Total time in ms across the turn. */
  timeMs: number;
}

export interface OrchestratorConfig {
  personas: PersonaRegistry;
  threads: ThreadStore;
  tools: ToolDispatcher;
  reviewService: ReviewService;
  governance: AIGovernanceService;
  /** Primary AIProvider — should be Anthropic in production. */
  executorProvider: AIProvider;
  /** Advisor provider — Anthropic (Opus) in production. */
  advisorProvider: AIProvider;
  /** Default token budget per turn. */
  defaultTokenBudget?: number;
  /**
   * Optional owner-style learning loop (gap-8). When wired, the orchestrator:
   *   - folds the learned style hint into the persona system prompt before
   *     each turn (how to speak — verbosity/detail/language/formality/posture);
   *   - refines the profile from the latest user turn AFTER the turn completes.
   * Entirely OPTIONAL and guarded: a missing service or an unavailable
   * `owner_style_profiles` table NEVER breaks a turn (honest-degrade — see
   * the pre-turn + post-turn seams in `executePersona`).
   */
  ownerStyle?: OwnerStyleService;
  /**
   * INPUT-CONTAINMENT (BP-1). Optional indirect-prompt-injection scanner run
   * over EVERY tool/junior result BEFORE it is re-ingested into the next LLM
   * call. Production composition injects
   * `@borjie/agent-security-guard`'s `createIndirectInjectionDetector()`; tests
   * may pass a deterministic fake. Injected as a structural PORT so this leaf
   * package takes no hard security-guard dependency. When absent the
   * re-ingestion scan is skipped (the spotlighting fence still applies).
   *
   * FAIL-OPEN: a scanner throw NEVER drops the turn — the raw text passes
   * through and a single Pino signal is logged.
   */
  indirectScanner?: IndirectContentScanner;
  /**
   * INPUT-CONTAINMENT audit sink (BP-5). Optional fire-and-forget callback
   * invoked when {@link indirectScanner} neutralises an injected span in a
   * re-ingested tool/junior result. Production composition wires this to the
   * hash-chained `PromptInjectionAttemptRepository` / `AgentSecuritySignalRepository`.
   * A sink fault NEVER blocks or opens the gate (the text is already cleaned).
   */
  onIndirectInjection?: (event: IndirectInjectionAuditEvent) => void;
}

/**
 * Audit event emitted when a re-ingested tool/junior result carried an
 * injected instruction that the {@link OrchestratorConfig.indirectScanner}
 * neutralised. Consumed fire-and-forget by the optional audit sink.
 */
export interface IndirectInjectionAuditEvent {
  readonly tenantId: string;
  readonly userId: string | null;
  readonly source: string;
  readonly highestSeverity: 'low' | 'medium' | 'high' | 'critical' | null;
  readonly matchKinds: ReadonlyArray<string>;
  readonly redactedExcerpt: string;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class Orchestrator {
  private readonly advisor: AdvisorExecutor;

  constructor(private readonly cfg: OrchestratorConfig) {
    this.advisor = new AdvisorExecutor({
      executorProvider: cfg.executorProvider,
      advisorProvider: cfg.advisorProvider,
    });
  }

  /**
   * Execute a single turn.
   */
  async handleTurn(
    req: TurnRequest
  ): Promise<AIResult<TurnResult, { code: string; message: string; retryable: boolean }>> {
    const turnStart = Date.now();

    // Validate multimodal attachments up front — fail fast, before any
    // thread read / persona resolve, with a structured error the caller
    // can surface back to the user.
    if (req.mediaAttachments && req.mediaAttachments.length > 0) {
      const attErr = validateMediaAttachments(req.mediaAttachments);
      if (attErr) return aiErr(attErr);
    }

    const thread = await this.cfg.threads.getThread(req.threadId);
    if (!thread) {
      return aiErr({
        code: 'THREAD_NOT_FOUND',
        message: `Thread ${req.threadId} not found`,
        retryable: false,
      });
    }

    // 1. Resolve the persona that owns this turn
    const personaId = req.forcePersonaId ?? thread.primaryPersonaId;
    const boundPersona = this.resolvePersona(personaId, req.tenant.tenantId, {
      ...(thread.teamId !== undefined ? { teamId: thread.teamId } : {}),
      ...(thread.employeeId !== undefined ? { employeeId: thread.employeeId } : {}),
    });
    if (!boundPersona) {
      return aiErr({
        code: 'PERSONA_NOT_FOUND',
        message: `Persona ${personaId} not registered`,
        retryable: false,
      });
    }

    // Default visibility for this turn is the persona's default, but capped
    // by the persona's budget and by the thread's scope context.
    const defaultVisibility: VisibilityLabel = {
      scope: boundPersona.defaultVisibility,
      authorActorId: boundPersona.id,
      initiatingUserId: req.actor.id,
      ...(thread.teamId !== undefined ? { teamId: thread.teamId } : {}),
      rationale: 'persona_default',
    };

    // 2. Append user message
    await this.cfg.threads.append({
      id: uuid(),
      threadId: req.threadId,
      kind: 'user_message',
      createdAt: new Date().toISOString(),
      visibility: defaultVisibility,
      actorId: req.actor.id,
      text: req.userText,
      ...(req.attachments !== undefined ? { attachments: req.attachments } : {}),
    });

    // 3. Execute the persona (may recurse on handoff)
    const budget = req.maxHandoffDepth ?? 3;
    const acc: TurnAccumulator = {
      toolCalls: [],
      handoffs: [],
      tokensUsed: 0,
      advisorConsulted: false,
    };

    const execResult = await this.executePersona({
      persona: boundPersona,
      thread,
      req,
      acc,
      depth: 0,
      maxDepth: budget,
    });
    if (!execResult.success) {
      const e = (execResult as { success: false; error: { code: string; message: string; retryable: boolean } }).error;
      return aiErr(e);
    }
    const final = execResult.data;

    return aiOk<TurnResult>({
      threadId: req.threadId,
      finalPersonaId: final.personaId,
      responseText: final.responseText,
      toolCalls: acc.toolCalls,
      handoffs: acc.handoffs,
      ...(final.proposedAction !== undefined ? { proposedAction: final.proposedAction } : {}),
      advisorConsulted: acc.advisorConsulted,
      tokensUsed: acc.tokensUsed,
      timeMs: Date.now() - turnStart,
    });
  }

  /**
   * Start a new thread and dispatch the first turn. Performs intent
   * classification to pick the primary persona.
   */
  async startThread(input: {
    tenant: AITenantContext;
    actor: AIActor;
    initialUserText: string;
    viewer: VisibilityViewer;
    title?: string;
    teamId?: string;
    employeeId?: string;
    forcePersonaId?: string;
    /**
     * Multimodal attachments forwarded to the first turn. Same validation
     * rules as `handleTurn.mediaAttachments` — applied inside `handleTurn`.
     */
    mediaAttachments?: ReadonlyArray<MediaAttachment>;
  }): Promise<AIResult<{ thread: { id: string; primaryPersonaId: string }; turn: TurnResult }, { code: string; message: string; retryable: boolean }>> {
    const intent = input.forcePersonaId
      ? {
          personaId: input.forcePersonaId,
          confidence: 1,
          rationale: 'forced',
        }
      : classifyInitialTurn(input.initialUserText);

    const threadId = uuid();
    const thread = await this.cfg.threads.createThread({
      id: threadId,
      tenantId: input.tenant.tenantId,
      initiatingUserId: input.actor.id,
      primaryPersonaId: intent.personaId,
      ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
      ...(input.employeeId !== undefined ? { employeeId: input.employeeId } : {}),
      title: input.title ?? input.initialUserText.slice(0, 80),
      status: 'open',
    });

    await this.cfg.threads.append({
      id: uuid(),
      threadId: thread.id,
      kind: 'system_note',
      noteKind: 'info',
      createdAt: new Date().toISOString(),
      visibility: {
        scope: 'management',
        authorActorId: 'orchestrator',
        initiatingUserId: input.actor.id,
        rationale: 'intent_classification',
      },
      actorId: 'orchestrator',
      text: `intent: ${intent.personaId} (${intent.rationale}, confidence=${intent.confidence.toFixed(2)})`,
    });

    const turn = await this.handleTurn({
      threadId: thread.id,
      tenant: input.tenant,
      actor: input.actor,
      userText: input.initialUserText,
      viewer: input.viewer,
      ...(input.forcePersonaId !== undefined
        ? { forcePersonaId: input.forcePersonaId }
        : {}),
      ...(input.mediaAttachments !== undefined
        ? { mediaAttachments: input.mediaAttachments }
        : {}),
    });
    if (!turn.success) {
      const e = (turn as { success: false; error: { code: string; message: string; retryable: boolean } }).error;
      return aiErr(e);
    }

    return aiOk({
      thread: { id: thread.id, primaryPersonaId: intent.personaId },
      turn: turn.data,
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * BP-1 + BP-3 — INPUT CONTAINMENT on tool/junior result re-ingestion.
   *
   * For ONE result string, in order:
   *   1. (BP-1) Run the injected indirect-injection scanner over the RAW
   *      content. On detection, substitute the scanner's `redactedInput`
   *      (offending spans + zero-width payloads stripped in-line) and fire
   *      the optional audit sink (BP-5, fire-and-forget).
   *   2. (BP-3) Fence the (now cleaned) content in the unambiguous
   *      data-spotlight delimiter so the model treats it as DATA, never
   *      instructions, even if step 1 missed a novel phrasing.
   *
   * FAIL-OPEN per result: a scanner throw NEVER drops the turn — the raw
   * text is still spotlighted and passed through, and a single Pino signal
   * is logged. Immutability: returns a NEW result object.
   */
  private neutraliseToolResult(
    result: {
      toolUseId: string;
      content: string;
      isError?: boolean;
      toolName?: string;
    },
    req: TurnRequest
  ): { toolUseId: string; content: string; isError?: boolean } {
    const source = result.toolName ?? 'tool';
    let cleaned = result.content;
    const scanner = this.cfg.indirectScanner;
    if (scanner) {
      try {
        const scan = scanner.scan({ source, text: result.content });
        if (scan.detected) {
          cleaned = scan.redactedInput;
          logger.warn('orchestrator: indirect injection neutralised in tool result', {
            wiring: 'input-containment',
            tenantId: req.tenant.tenantId,
            source,
            highestSeverity: scan.highestSeverity,
            matchKinds: scan.matches.map((m) => m.kind),
          });
          // BP-5 — fire-and-forget audit sink (never blocks/opens the gate).
          const sink = this.cfg.onIndirectInjection;
          if (sink) {
            try {
              sink({
                tenantId: req.tenant.tenantId,
                userId: req.actor.id ?? null,
                source,
                highestSeverity: scan.highestSeverity,
                matchKinds: scan.matches.map((m) => m.kind),
                redactedExcerpt: cleaned.slice(0, 200),
              });
            } catch (sinkErr) {
              logger.warn('orchestrator: indirect-injection audit sink failed', {
                wiring: 'input-containment',
                err: sinkErr instanceof Error ? sinkErr.message : String(sinkErr),
              });
            }
          }
        }
      } catch (err) {
        // FAIL-OPEN: a scanner fault must NEVER drop the turn. Pass the raw
        // text through (still spotlighted below) and log a single signal.
        logger.warn('orchestrator: indirect-injection scan threw (failing open)', {
          wiring: 'input-containment',
          source,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    // BP-3 — always spotlight the (cleaned) untrusted content.
    return {
      toolUseId: result.toolUseId,
      content: spotlight(cleaned, source),
      ...(result.isError !== undefined ? { isError: result.isError } : {}),
    };
  }

  private resolvePersona(
    personaId: string,
    tenantId: string,
    bindings: { teamId?: string; employeeId?: string }
  ): Persona | null {
    // Handle Coworker `coworker.<employeeId>` family form.
    let template: Persona | null;
    if (personaId.startsWith('coworker.') && personaId.length > 'coworker.'.length) {
      template = this.cfg.personas.resolveCoworker();
      if (template) {
        return bindPersona(template, {
          tenantId,
          ...(bindings.teamId !== undefined ? { teamId: bindings.teamId } : {}),
          employeeId: personaId.slice('coworker.'.length),
        });
      }
      return null;
    }
    template = this.cfg.personas.get(personaId);
    if (!template) return null;
    return bindPersona(template, {
      tenantId,
      ...(bindings.teamId !== undefined ? { teamId: bindings.teamId } : {}),
      ...(bindings.employeeId !== undefined ? { employeeId: bindings.employeeId } : {}),
    });
  }

  private async executePersona(args: {
    persona: Persona;
    thread: { id: string; teamId?: string; employeeId?: string };
    req: TurnRequest;
    acc: TurnAccumulator;
    depth: number;
    maxDepth: number;
    handoffPacket?: HandoffPacket;
  }): Promise<AIResult<FinalPersonaResult, { code: string; message: string; retryable: boolean }>> {
    const { persona, thread, req, acc, depth, maxDepth, handoffPacket } = args;

    // Render filtered context as the human principal (enforces visibility).
    const contextText = await this.cfg.threads.renderContextAs(
      thread.id,
      req.viewer,
      { maxEvents: 40 }
    );

    const handoffText = handoffPacket ? renderHandoffPacket(handoffPacket) : '';
    // BP-3 — spotlight the rendered thread context (which can carry prior
    // tool outputs, recalled memories, and retrieved corpus chunks) as
    // untrusted DATA. The user's OWN latest message is the principal's
    // instruction channel (guarded on ingress, not fenced as data). The
    // trusted boundary directive NAMES the fence so the model treats any
    // bytes between the sentinels as data-only, never instructions.
    const userPrompt = [
      UNTRUSTED_BOUNDARY_DIRECTIVE,
      handoffText,
      'Thread context (filtered to your visibility):',
      spotlight(contextText, 'thread-context'),
      '',
      'Latest user message:',
      req.userText,
    ]
      .filter(Boolean)
      .join('\n');

    // When the turn carries media attachments (vision), confirm the
    // persona's tier maps to a vision-capable Anthropic model.
    const resolvedModelId = modelForTier(persona.modelTier);
    if (req.mediaAttachments && req.mediaAttachments.length > 0) {
      if (!anthropicModelSupportsVision(resolvedModelId)) {
        return aiErr({
          code: 'VISION_UNSUPPORTED_MODEL',
          message: `Persona ${persona.id} resolves to model ${resolvedModelId} which does not support vision input`,
          retryable: false,
        });
      }
    }

    // Owner-style (gap-8): fold the learned style hint into the system prompt
    // so future turns adapt HOW Mr. Mwikila speaks (verbosity / detail /
    // language / formality / posture). Strictly additive + guarded: if the
    // service is absent or unavailable we keep the base prompt unchanged
    // (honest-degrade — never fabricate, never break the turn).
    const systemPrompt = await this.applyOwnerStyleHint(
      persona.systemPrompt,
      req.tenant.tenantId
    );

    const compiled: CompiledPrompt = {
      promptId: asPromptId(`persona:${persona.id}`),
      version: '1.0.0',
      systemPrompt,
      userPrompt,
      modelConfig: {
        modelId: resolvedModelId,
        maxTokens: 2048,
        temperature: 0.4,
      },
      guardrails: { piiHandling: 'redact' },
    };

    // Tool definitions for this persona — Anthropic tool-use schema.
    const toolDefs = this.cfg.tools
      .getDefinitionsFor(persona)
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.parameters,
      }));

    const visibility: VisibilityLabel = handoffPacket
      ? handoffPacket.visibility
      : {
          scope: persona.defaultVisibility,
          authorActorId: persona.id,
          initiatingUserId: req.actor.id,
          ...(thread.teamId !== undefined ? { teamId: thread.teamId } : {}),
          rationale: 'persona_default',
        };

    // Drive the tool-call loop. Each iteration:
    //   - call the model (advisor pattern wraps executor + optional Opus)
    //   - if it returned tool_use blocks, dispatch them, append tool_result
    //     blocks to the conversation, and loop
    //   - otherwise, break with the final text
    const hardCategory = inferHardCategory(persona, req.userText);
    // First user message: if the turn carries media attachments, build a
    // content-array message with text + image blocks (multimodal). Otherwise
    // pass the plain text userPrompt as today.
    const initialUserMessage: AIMessage =
      req.mediaAttachments && req.mediaAttachments.length > 0
        ? buildMultimodalUserMessage(userPrompt, req.mediaAttachments)
        : { role: 'user', content: userPrompt };
    const messages: AIMessage[] = [initialUserMessage];
    const maxLoops = req.maxToolLoopIterations ?? 5;
    const tokenBudget =
      handoffPacket?.tokenBudget ??
      this.cfg.defaultTokenBudget ??
      8192;

    let outcome:
      | {
          executor: import('../providers/ai-provider.js').AICompletionResponse;
          advisor?: import('../providers/ai-provider.js').AICompletionResponse;
          finalContent: string;
          advisorConsulted: boolean;
          totalTokens: number;
          totalProcessingTimeMs: number;
          advisorReason: string;
        }
      | null = null;
    let responseText = '';

    for (let iter = 0; iter < maxLoops; iter++) {
      // Cost ceiling — every iteration we check the per-turn token budget.
      if (acc.tokensUsed >= tokenBudget) {
        await this.cfg.threads.append({
          id: uuid(),
          threadId: thread.id,
          kind: 'system_note',
          noteKind: 'governance',
          createdAt: new Date().toISOString(),
          visibility: { ...visibility, scope: 'management' },
          actorId: 'orchestrator',
          text: `token budget exhausted: used=${acc.tokensUsed} budget=${tokenBudget}`,
        });
        return aiErr({
          code: 'TOKEN_BUDGET_EXHAUSTED',
          message: `Token budget ${tokenBudget} exhausted (used=${acc.tokensUsed})`,
          retryable: false,
        });
      }

      const advResult = await this.advisor.run(
        {
          prompt: compiled,
          jsonMode: false,
          ...(toolDefs.length ? { tools: toolDefs } : {}),
          priorMessages: messages,
        },
        {
          ...(hardCategory !== null && hardCategory !== undefined ? { category: hardCategory } : {}),
          reason: `persona:${persona.id} depth:${depth} iter:${iter}`,
        }
      );
      if (!advResult.success) {
        const advErr = (advResult as { success: false; error: { code: string; message: string; retryable: boolean } }).error;
        return aiErr({
          code: 'EXECUTOR_FAILED',
          message: advErr.message,
          retryable: advErr.retryable,
        });
      }
      outcome = advResult.data;
      acc.tokensUsed += outcome.totalTokens;
      if (outcome.advisorConsulted) acc.advisorConsulted = true;

      // Inspect tool calls on the executor turn (advisor cannot dispatch).
      const exec = outcome.executor;
      const toolCalls = exec.toolCalls ?? [];

      // If the model emitted tool calls, append assistant turn + dispatch each.
      if (toolCalls.length && exec.rawContent) {
        messages.push({ role: 'assistant', content: exec.rawContent });
        const results: Array<{
          toolUseId: string;
          content: string;
          isError?: boolean;
          /** Trusted tool name for the spotlight provenance tag (BP-3). */
          toolName?: string;
        }> = [];
        for (const call of toolCalls) {
          const dispatch = await this.cfg.tools.dispatch(
            call.name,
            call.input,
            {
              tenant: req.tenant,
              actor: req.actor,
              persona,
              threadId: thread.id,
            },
            visibility
          );
          if (dispatch.success) {
            const data = dispatch.data;
            acc.toolCalls.push({ tool: call.name, ok: data.ok });
            // Raw (UNSCANNED, UNFENCED) content. BP-1 neutralisation + BP-3
            // spotlighting are applied together below, just before
            // re-ingestion (see `neutraliseToolResult`), so the scanner sees
            // the raw payload and the fence wraps the cleaned result.
            results.push({
              toolUseId: call.id,
              content:
                (data.evidenceSummary ?? JSON.stringify(data.data)).slice(
                  0,
                  4_000
                ),
              isError: !data.ok,
              toolName: call.name,
            });
          } else {
            const dErr = (dispatch as { success: false; error: { code: string; message: string } }).error;
            acc.toolCalls.push({ tool: call.name, ok: false });
            results.push({
              toolUseId: call.id,
              content: `${dErr.code}: ${dErr.message}`,
              isError: true,
              toolName: call.name,
            });
          }
        }
        // BP-1 — INPUT CONTAINMENT: scan + neutralise every tool/junior
        // result BEFORE re-ingestion. A poisoned result ("ignore previous",
        // "reveal your system prompt", a markdown-image exfil url, zero-width
        // payload) is stripped in-line so the surrounding doc stays usable.
        // Immutability: build a NEW results array. Fail-OPEN per result.
        const guardedResults = results.map((r) =>
          this.neutraliseToolResult(r, req)
        );
        // Feed results back as a user turn and continue.
        messages.push(buildToolResultMessage(guardedResults));
        // If the model also produced text alongside the tool calls, capture
        // it so we still have something to append on early-exit.
        if (exec.content && exec.content.trim()) responseText = exec.content;
        continue;
      }

      // No tool calls — terminal turn for this persona.
      responseText = (outcome.finalContent || '').trim();
      break;
    }

    if (!outcome) {
      return aiErr({
        code: 'EXECUTOR_FAILED',
        message: 'persona invocation produced no outcome',
        retryable: false,
      });
    }

    // Append persona message (visibility was computed at the top of the turn)
    await this.cfg.threads.append({
      id: uuid(),
      threadId: thread.id,
      kind: 'persona_message',
      createdAt: new Date().toISOString(),
      visibility,
      actorId: persona.id,
      personaId: persona.id,
      text: responseText,
      advisorConsulted: outcome.advisorConsulted,
    });

    // Governance: log the Brain turn (persona-aware, advisor-aware).
    const totalPromptTokens =
      outcome.executor.usage.promptTokens +
      (outcome.advisor?.usage.promptTokens ?? 0);
    const totalCompletionTokens =
      outcome.executor.usage.completionTokens +
      (outcome.advisor?.usage.completionTokens ?? 0);
    await this.cfg.governance
      .logBrainTurn({
        tenant: req.tenant,
        actor: req.actor,
        personaId: persona.id,
        threadId: thread.id,
        modelId: String(outcome.advisor?.modelId ?? outcome.executor.modelId),
        promptTokens: totalPromptTokens,
        completionTokens: totalCompletionTokens,
        advisorConsulted: outcome.advisorConsulted,
        depth,
        processingTimeMs: outcome.totalProcessingTimeMs,
      })
      .catch((err: unknown) => {
        // Governance is best-effort but failures must be visible in the
        // thread itself so operators see the gap rather than discovering
        // missing audit events later.
        const msg = err instanceof Error ? err.message : String(err);
        void this.cfg.threads
          .append({
            id: uuid(),
            threadId: thread.id,
            kind: 'system_note',
            noteKind: 'governance',
            createdAt: new Date().toISOString(),
            visibility: { ...visibility, scope: 'management' },
            actorId: 'orchestrator',
            text: `governance.logBrainTurn failed: ${msg}`,
          })
          .catch(() => {
            /* last-resort: thread store unreachable too — there is nowhere left to log */
          });
      });

    // Owner-style (gap-8): refine the learned profile from the user's turn
    // AFTER the persona has responded. Mirrors where other post-turn effects
    // happen (governance log above). Only at depth 0 — the top-level turn is
    // the owner's actual message; handoff sub-turns are internal and must not
    // double-count. Fully guarded + honest-degrades: the service itself never
    // throws out of refine, and we still wrap defensively so an unexpected
    // error (or a missing `owner_style_profiles` table surfaced through the
    // store) can never break the turn. We never fabricate a profile.
    if (depth === 0) {
      await this.refineOwnerStyle(req.tenant.tenantId, req.userText);
    }

    // Parse directives emitted by the persona.
    const proposed = parseProposedAction(responseText);
    const handoff = parseHandoffDirective(responseText);

    // Handoff dispatch (recursive)
    if (handoff && depth < maxDepth) {
      if (!persona.delegatesTo || !persona.delegatesTo.includes(handoff.targetPersonaId)) {
        await this.cfg.threads.append({
          id: uuid(),
          threadId: thread.id,
          kind: 'system_note',
          noteKind: 'governance',
          createdAt: new Date().toISOString(),
          visibility: { ...visibility, scope: 'management' },
          actorId: 'orchestrator',
          text: `handoff denied: ${persona.id} -> ${handoff.targetPersonaId} (not in delegatesTo)`,
        });
      } else {
        const target = this.resolvePersona(
          handoff.targetPersonaId,
          req.tenant.tenantId,
          {
            ...(thread.teamId !== undefined ? { teamId: thread.teamId } : {}),
            ...(thread.employeeId !== undefined ? { employeeId: thread.employeeId } : {}),
          }
        );
        if (target) {
          const packet: HandoffPacket = {
            id: uuid(),
            threadId: thread.id,
            targetPersonaId: target.id,
            sourcePersonaId: persona.id,
            objective: handoff.objective,
            outputFormat:
              'Return: (1) what you did, (2) evidence citations, (3) any PROPOSED_ACTION.',
            relevantEntities: [],
            priorDecisions: [],
            constraints: [],
            allowedTools: target.allowedTools,
            contextSummary: summarizeForHandoff(responseText),
            latestUserMessage: req.userText,
            visibility,
            tokensSoFar: acc.tokensUsed,
            tokenBudget: 2048,
            createdAt: new Date().toISOString(),
          };
          await this.cfg.threads.append({
            id: uuid(),
            threadId: thread.id,
            kind: 'handoff_out',
            createdAt: new Date().toISOString(),
            visibility,
            actorId: persona.id,
            packet,
          });
          acc.handoffs.push({
            from: persona.id,
            to: target.id,
            objective: handoff.objective,
          });
          return this.executePersona({
            persona: target,
            thread,
            req,
            acc,
            depth: depth + 1,
            maxDepth,
            handoffPacket: packet,
          });
        }
      }
    }

    // Review gate on proposed actions.
    //
    // When the persona's risk threshold is exceeded, the proposed action is
    // NOT executed. The orchestrator emits:
    //   - a `review_requested` event to the thread (for the review UI)
    //   - a governance audit entry (so the block is visible in SIEM)
    // The returned proposedAction carries `reviewRequired: true` AND
    // `executionHeld: true` as the contract with the caller. Callers MUST
    // not dispatch the action until a `review_decision` event with
    // `decision: "approved"` arrives on the thread.
    let reviewRequired = false;
    if (proposed) {
      reviewRequired = riskAtLeast(
        proposed.riskLevel as RiskLevel,
        persona.minReviewRiskLevel
      );
      if (reviewRequired) {
        const copilotRequestId = uuid();
        await this.cfg.threads.append({
          id: uuid(),
          threadId: thread.id,
          kind: 'review_requested',
          createdAt: new Date().toISOString(),
          visibility: { ...visibility, scope: widest(visibility.scope, 'management') },
          actorId: persona.id,
          personaId: persona.id,
          copilotRequestId,
          riskLevel: proposed.riskLevel,
        });
        // Governance audit — separate from the thread event so it survives
        // thread pruning and is visible to compliance dashboards.
        await this.cfg.governance
          .logBrainTurn({
            tenant: req.tenant,
            actor: req.actor,
            personaId: persona.id,
            threadId: thread.id,
            modelId: String(outcome.advisor?.modelId ?? outcome.executor.modelId),
            promptTokens: 0,
            completionTokens: 0,
            advisorConsulted: false,
            depth,
            processingTimeMs: 0,
            reviewBlocked: {
              copilotRequestId,
              verb: proposed.verb,
              object: proposed.object,
              riskLevel: proposed.riskLevel as RiskLevel,
            },
          } as unknown as Parameters<typeof this.cfg.governance.logBrainTurn>[0])
          .catch(() => {
            /* governance best-effort — thread event is the source of truth */
          });
      }
    }

    return aiOk<FinalPersonaResult>({
      personaId: persona.id,
      responseText,
      proposedAction: proposed
        ? {
            verb: proposed.verb,
            object: proposed.object,
            riskLevel: proposed.riskLevel as RiskLevel,
            reviewRequired,
            // Explicit block flag — the orchestrator contract is: if
            // reviewRequired is true, the caller MUST NOT execute this
            // action. executionHeld mirrors reviewRequired today but
            // keeps the block semantics independent of future rule changes.
            executionHeld: reviewRequired,
          }
        : undefined,
    });
  }

  // -------------------------------------------------------------------------
  // Owner-style learning loop (gap-8) — optional + guarded.
  // -------------------------------------------------------------------------

  /**
   * Fold the learned owner-style hint into the persona system prompt. Returns
   * the base prompt unchanged when the service is absent or unavailable, or
   * when the profile is not yet confident enough to specialise. Never throws —
   * a missing `owner_style_profiles` table can't break a turn.
   */
  private async applyOwnerStyleHint(
    baseSystemPrompt: string,
    tenantId: string
  ): Promise<string> {
    const svc = this.cfg.ownerStyle;
    if (!svc) return baseSystemPrompt;
    try {
      const hint = await svc.getStyleHint(tenantId);
      if (!hint) return baseSystemPrompt;
      return `${baseSystemPrompt.trimEnd()}\n\n${hint}`;
    } catch (err) {
      logger.debug('owner-style.hint.skipped', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return baseSystemPrompt;
    }
  }

  /**
   * Refine the learned owner-style profile from the latest user turn. No-op
   * when the service is absent. The service honest-degrades internally (it
   * never throws from `refine`); we still wrap defensively so nothing here can
   * break the turn. Never fabricates a profile.
   */
  private async refineOwnerStyle(
    tenantId: string,
    userText: string
  ): Promise<void> {
    const svc = this.cfg.ownerStyle;
    if (!svc) return;
    try {
      const result = await svc.refine(tenantId, [
        { text: userText, tsMs: Date.now() },
      ]);
      logger.debug('owner-style.refined', {
        tenantId,
        changeNote: result.changeNote,
        posture: result.profile.posture.value,
        confidence: result.profile.confidence,
        degraded: result.degraded,
      });
    } catch (err) {
      logger.debug('owner-style.refine.skipped', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TurnAccumulator {
  toolCalls: Array<{ tool: string; ok: boolean }>;
  handoffs: Array<{ from: string; to: string; objective: string }>;
  tokensUsed: number;
  advisorConsulted: boolean;
}

interface FinalPersonaResult {
  personaId: string;
  responseText: string;
  proposedAction?: TurnResult['proposedAction'];
}

function modelForTier(tier: Persona['modelTier']): string {
  switch (tier) {
    case 'advanced':
      return ANTHROPIC_MODELS.OPUS_4_8;
    case 'standard':
      return ANTHROPIC_MODELS.SONNET_4_6;
    case 'basic':
      return ANTHROPIC_MODELS.HAIKU_4_5;
  }
}

function inferHardCategory(
  persona: Persona,
  userText: string
): AdvisorHardCategory | null {
  // If persona has no hard categories, nothing fires.
  if (!persona.advisorHardCategories.length) return null;
  const text = userText.toLowerCase();
  if (
    persona.advisorHardCategories.includes('lease_interpretation') &&
    /\b(lease|renewal|clause|termination|security deposit)\b/.test(text)
  )
    return 'lease_interpretation';
  if (
    persona.advisorHardCategories.includes('legal_drafting') &&
    /\b(notice|demand|letter to|court|legal|subpoena)\b/.test(text)
  )
    return 'legal_drafting';
  if (
    persona.advisorHardCategories.includes('compliance_ruling') &&
    /\b(dpa|compliance|kra|violation)\b/.test(text)
  )
    return 'compliance_ruling';
  if (
    persona.advisorHardCategories.includes('large_financial_posting') &&
    /\b(refund|write[- ]?off|credit|adjust|large|above\s+\d)\b/.test(text)
  )
    return 'large_financial_posting';
  if (
    persona.advisorHardCategories.includes('tenant_termination') &&
    /\b(evict|terminate|quit notice|vacate)\b/.test(text)
  )
    return 'tenant_termination';
  return null;
}

const RISK_ORDER: Record<RiskLevel, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
  CRITICAL: 3,
};

function riskAtLeast(a: RiskLevel, b: RiskLevel): boolean {
  return RISK_ORDER[a] >= RISK_ORDER[b];
}

const SCOPE_ORDER: Record<VisibilityScope, number> = {
  private: 0,
  team: 1,
  management: 2,
  public: 3,
};

function widest(a: VisibilityScope, b: VisibilityScope): VisibilityScope {
  return SCOPE_ORDER[a] >= SCOPE_ORDER[b] ? a : b;
}

function summarizeForHandoff(responseText: string): string {
  // A minimal, auditable summarizer: the first 5 non-empty lines.
  return responseText
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, 5)
    .join(' | ')
    .slice(0, 1000);
}

/**
 * Approximate the decoded byte length of a base64 string without allocating
 * a Buffer. Anthropic's base64 image payload is roughly `(chars*3)/4` minus
 * padding (0–2 `=` characters).
 */
function approxDecodedBase64Bytes(base64: string): number {
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/**
 * Validate the multimodal attachments array. Returns `null` when the
 * attachments are acceptable, otherwise a structured error the orchestrator
 * surfaces to the caller. Pure function — does not mutate its input.
 */
export function validateMediaAttachments(
  attachments: ReadonlyArray<MediaAttachment>,
): { code: string; message: string; retryable: false } | null {
  if (attachments.length > MAX_MEDIA_ATTACHMENTS_PER_TURN) {
    return {
      code: 'TOO_MANY_ATTACHMENTS',
      message: `at most ${MAX_MEDIA_ATTACHMENTS_PER_TURN} media attachments allowed per turn (received ${attachments.length})`,
      retryable: false,
    };
  }
  for (let i = 0; i < attachments.length; i += 1) {
    const att = attachments[i];
    if (!att) continue;
    if (att.mediaType !== 'image/jpeg' && att.mediaType !== 'image/png') {
      return {
        code: 'ATTACHMENT_MEDIA_TYPE_UNSUPPORTED',
        message: `attachment[${i}] mediaType ${att.mediaType} is not supported (allowed: image/jpeg, image/png)`,
        retryable: false,
      };
    }
    if (typeof att.data !== 'string' || att.data.length === 0) {
      return {
        code: 'ATTACHMENT_EMPTY',
        message: `attachment[${i}] data is empty`,
        retryable: false,
      };
    }
    const decoded = approxDecodedBase64Bytes(att.data);
    if (decoded > MAX_MEDIA_ATTACHMENT_BYTES) {
      return {
        code: 'ATTACHMENT_TOO_LARGE',
        message: `attachment[${i}] is ${decoded} bytes (max ${MAX_MEDIA_ATTACHMENT_BYTES})`,
        retryable: false,
      };
    }
  }
  return null;
}

// Zod schemas reserved for future contract validation (kept here so the
// dispatcher and transport layers can import from a single symbol).
export const TurnRequestSchema = z.object({
  threadId: z.string().min(1),
  userText: z.string().min(1).max(10_000),
  forcePersonaId: z.string().optional(),
  maxHandoffDepth: z.number().int().min(0).max(5).optional(),
});

// ---------------------------------------------------------------------------
// Streaming API — sibling of `handleTurn`.
//
// The core `handleTurn` runs the full tool-use loop atomically and returns a
// single TurnResult. Streaming consumers (SSE in the gateway, the chat-ui)
// want incremental updates: typing deltas, tool-call/tool-result chips, and
// a proposed-action card before turn_end.
//
// Rather than re-implement the state machine we wrap `handleTurn` in an
// async generator: we await the real turn, then emit coarse delta events
// (chunked from the final response text). This keeps the production logic
// single-sourced in `handleTurn` and avoids duplicating governance/review/
// handoff plumbing.
//
// The event shape mirrors what the 4 chat UIs (`useChatStream` hook) expect.
// ---------------------------------------------------------------------------

export type StreamTurnEvent =
  | {
      readonly type: 'turn_start';
      readonly threadId: string;
      readonly personaId: string | undefined;
      readonly createdAt: string;
    }
  | { readonly type: 'delta'; readonly content: string }
  | {
      readonly type: 'tool_call';
      readonly name: string;
      readonly args?: Record<string, unknown>;
    }
  | { readonly type: 'tool_result'; readonly name: string; readonly ok: boolean }
  | {
      readonly type: 'proposed_action';
      readonly risk: RiskLevel;
      readonly description: string;
      readonly reviewRequired: boolean;
      readonly executionHeld: boolean;
    }
  | {
      readonly type: 'handoff';
      readonly from: string;
      readonly to: string;
      readonly objective: string;
    }
  | {
      readonly type: 'error';
      readonly code: string;
      readonly message: string;
      readonly retryable: boolean;
    }
  | {
      readonly type: 'turn_end';
      readonly threadId: string;
      readonly finalPersonaId: string;
      readonly totalTokens: number;
      readonly totalCost: number;
      readonly timeMs: number;
      readonly advisorConsulted: boolean;
    };

export interface StreamTurnRequest extends TurnRequest {
  /**
   * AbortSignal — if the caller disconnects (e.g. SSE client closed) the
   * generator stops emitting events. We cannot cancel a Promise already in
   * flight with `handleTurn` but we stop feeding bytes to the wire, which is
   * what SSE clients care about.
   */
  readonly signal?: AbortSignal;
  /** Characters per emitted delta. Default 24. */
  readonly chunkSize?: number;
  /** Delay between deltas in ms. Default 12. */
  readonly chunkDelayMs?: number;
}

/**
 * Stream a single turn as an async iterable of events.
 *
 * Event ordering contract with chat-ui `useChatStream`:
 *   1. turn_start (always first — establishes threadId)
 *   2. tool_call / tool_result pairs (zero or more, in dispatch order)
 *   3. handoff events (zero or more)
 *   4. delta chunks (one or more) — the persona text, chunked
 *   5. proposed_action (optional — only when a PROPOSED_ACTION was parsed)
 *   6. turn_end (always last — carries totalTokens + totalCost)
 *
 * Error cases emit a single `error` event followed by `turn_end`.
 */
export async function* streamTurn(
  orchestrator: Orchestrator,
  req: StreamTurnRequest
): AsyncGenerator<StreamTurnEvent> {
  const { signal } = req;
  const chunkSize = req.chunkSize ?? 24;
  const chunkDelayMs = req.chunkDelayMs ?? 12;

  yield {
    type: 'turn_start',
    threadId: req.threadId,
    personaId: req.forcePersonaId,
    createdAt: new Date().toISOString(),
  };

  if (signal?.aborted) {
    yield {
      type: 'turn_end',
      threadId: req.threadId,
      finalPersonaId: req.forcePersonaId ?? 'unknown',
      totalTokens: 0,
      totalCost: 0,
      timeMs: 0,
      advisorConsulted: false,
    };
    return;
  }

  const start = Date.now();
  const result = await orchestrator.handleTurn(req);

  if (signal?.aborted) {
    yield {
      type: 'turn_end',
      threadId: req.threadId,
      finalPersonaId: req.forcePersonaId ?? 'unknown',
      totalTokens: 0,
      totalCost: 0,
      timeMs: Date.now() - start,
      advisorConsulted: false,
    };
    return;
  }

  if (!result.success) {
    const err = (result as { success: false; error: { code: string; message: string; retryable: boolean } }).error;
    yield { type: 'error', code: err.code, message: err.message, retryable: err.retryable };
    yield {
      type: 'turn_end',
      threadId: req.threadId,
      finalPersonaId: req.forcePersonaId ?? 'unknown',
      totalTokens: 0,
      totalCost: 0,
      timeMs: Date.now() - start,
      advisorConsulted: false,
    };
    return;
  }

  const turn = result.data;

  for (const tc of turn.toolCalls) {
    if (signal?.aborted) break;
    yield { type: 'tool_call', name: tc.tool };
    yield { type: 'tool_result', name: tc.tool, ok: tc.ok };
  }

  for (const h of turn.handoffs) {
    if (signal?.aborted) break;
    yield { type: 'handoff', from: h.from, to: h.to, objective: h.objective };
  }

  const text = turn.responseText;
  const size = Math.max(1, chunkSize);
  for (let i = 0; i < text.length; i += size) {
    if (signal?.aborted) break;
    yield { type: 'delta', content: text.slice(i, i + size) };
    if (chunkDelayMs > 0 && i + size < text.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, chunkDelayMs));
    }
  }

  if (turn.proposedAction) {
    yield {
      type: 'proposed_action',
      risk: turn.proposedAction.riskLevel,
      description: `${turn.proposedAction.verb} ${turn.proposedAction.object}`,
      reviewRequired: turn.proposedAction.reviewRequired,
      executionHeld: turn.proposedAction.executionHeld ?? turn.proposedAction.reviewRequired,
    };
  }

  // Coarse cost estimate — finer-grained breakdowns live in the cost ledger.
  const costPer1k = 0.015;
  const estimatedCost = Number(((turn.tokensUsed / 1000) * costPer1k).toFixed(6));

  yield {
    type: 'turn_end',
    threadId: turn.threadId,
    finalPersonaId: turn.finalPersonaId,
    totalTokens: turn.tokensUsed,
    totalCost: estimatedCost,
    timeMs: turn.timeMs,
    advisorConsulted: turn.advisorConsulted,
  };
}
