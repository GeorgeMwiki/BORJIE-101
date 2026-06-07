/**
 * Stage 2 — orchestrator-routed generation for the MAIN brain chat
 * surface (`/api/v1/brain/turn`).
 *
 * When the central-intelligence orchestrator main-loop is the live
 * generator (DEFAULT-ON; see `resolveBrainOrchestratorRoutingEnabled`),
 * the disciplined kernel pipeline runs the safety rails AND the answer
 * generation in ONE `kernel.think()` call — so the route does NOT also
 * run the separate `kernelPreflight` (that would double the LLM spend).
 *
 * This module is a FOCUSED helper kept OUT of `brain.hono.ts` (which is
 * already large). It owns three things:
 *
 *   1. `resolveBrainOrchestratorRoutingEnabled()` — the env-lever flag
 *      helper. Mirrors the kernel's `resolveOrchestratorRoutingEnabled`
 *      precedence EXACTLY so the route and the kernel agree on whether
 *      the main-loop is live: `KERNEL_USE_ORCHESTRATOR=false` hard-kills,
 *      `BORJIE_ORCHESTRATOR_MAINLOOP` in {0,false,off} soft-disables, any
 *      other value (incl. UNSET) leaves it ON.
 *
 *   2. `generateBrainTurnViaOrchestrator()` — minimal thread bookkeeping
 *      (create/load thread + append the user message + append the
 *      assistant reply) wrapped around a single `kernel.think()` call so
 *      `/threads` continuity is preserved while generation flows through
 *      the orchestrator. Returns a normalized payload shaped to the EXACT
 *      JSON/SSE contract `brain.hono.ts` already emits.
 *
 *   3. `mapDecisionToTurnPayload()` — pure projection of the kernel's
 *      `BrainDecision` ADT onto that payload.
 *
 * HONEST DELTA vs the persona path (documented, never silently dropped):
 *   - `handoffs` / `toolCalls` are always `[]` on the orchestrator path:
 *     the main-loop executes tools internally via its own dispatcher +
 *     9-hook chain (audited there), and does NOT emit the persona-style
 *     cross-persona `handoff` / per-tool `tool_call` envelopes the
 *     ai-copilot orchestrator surfaces. The SSE `tool_call` frame is thus
 *     not emitted under flag-ON.
 *   - `advisorConsulted` is always `false` (no Advisor-pattern fan-out).
 *   - `finalPersonaId` is the THREAD's bound persona id (no per-turn
 *     persona handoff re-resolution); the kernel renders the persona
 *     SYSTEM PROMPT internally via `selectPersona`, so voice fidelity is
 *     preserved, but the route cannot read back a turn-level persona id
 *     from the `BrainDecision`, so it reports the thread's persona.
 *   - `tokensUsed` is `0` (the kernel's `BrainDecision` provenance does
 *     not expose a token count; the AI cost-ledger still sees the
 *     downstream Anthropic SDK calls via the sensor-wrapped client).
 *   - a kernel `refusal` maps to a structured refusal turn (the route
 *     surfaces it as the persona-path 403 / SSE error+done, identical to
 *     the existing `kernelPreflight` refusal shape).
 */

import { randomUUID } from 'node:crypto';
import type { Brain } from '@borjie/ai-copilot';
import type {
  BrainDecision,
  SovereignBrain,
} from '@borjie/central-intelligence';

// ---------------------------------------------------------------------------
// Flag helper — mirrors kernel `resolveOrchestratorRoutingEnabled`.
// ---------------------------------------------------------------------------

/**
 * Resolve whether the orchestrator main-loop is the live generator for the
 * main brain chat surface, reading the SAME env levers the kernel reads:
 *
 *   1. `KERNEL_USE_ORCHESTRATOR === 'false'` — HARD kill (instant revert).
 *   2. `BORJIE_ORCHESTRATOR_MAINLOOP` in {0,false,off} — SOFT disable.
 *   3. Default: TRUE (DEFAULT-ON).
 *
 * The route only knows the env signal; the kernel additionally guards on
 * whether the orchestrator dep is actually wired (`anthropic && db`). When
 * env says ON but the kernel has no orchestrator dep (no key / no DB),
 * `kernel.think()` transparently runs the legacy 13-step pipeline and
 * still returns a valid `BrainDecision`, so routing through it is safe.
 */
export function resolveBrainOrchestratorRoutingEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  // 1. Hard kill.
  if (env.KERNEL_USE_ORCHESTRATOR === 'false') return false;
  // 2. Soft disable.
  const flag =
    typeof env.BORJIE_ORCHESTRATOR_MAINLOOP === 'string'
      ? env.BORJIE_ORCHESTRATOR_MAINLOOP.trim().toLowerCase()
      : '';
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  // 3. DEFAULT-ON.
  return true;
}

// ---------------------------------------------------------------------------
// Normalized turn payload — shaped to the brain.hono.ts JSON/SSE contract.
// ---------------------------------------------------------------------------

export interface OrchestratorTurnPayload {
  readonly threadId: string;
  readonly finalPersonaId: string;
  readonly responseText: string;
  /** Always [] on the orchestrator path (see module HONEST DELTA). */
  readonly handoffs: ReadonlyArray<{ from: string; to: string; objective: string }>;
  /** Always [] on the orchestrator path (see module HONEST DELTA). */
  readonly toolCalls: ReadonlyArray<{ tool: string; ok: boolean }>;
  /** Always false on the orchestrator path. */
  readonly advisorConsulted: boolean;
  /** Present only when the kernel asked for approval / refused. */
  readonly proposedAction?: {
    verb: string;
    object: string;
    riskLevel: string;
    reviewRequired: boolean;
    executionHeld?: boolean;
  };
  /** 0 on the orchestrator path (provenance carries no token count). */
  readonly tokensUsed: number;
  readonly timeMs: number;
  /** True when the kernel issued a hard refusal (inviolable/policy/drift). */
  readonly refused: boolean;
  /** Gate that refused (for structured logging), when refused. */
  readonly refusalGate?: 'inviolable' | 'policy' | 'drift';
}

/** Canonical Mr. Mwikila head-persona id — the brain chat's default. */
const DEFAULT_BRAIN_PERSONA_ID = 'mr-mwikila-head';

/**
 * Pure projection of a kernel `BrainDecision` onto the turn payload. The
 * `personaId` is supplied by the caller (the thread's bound persona) since
 * the `BrainDecision` does not carry one. `timeMs` is read from provenance.
 */
export function mapDecisionToTurnPayload(args: {
  readonly decision: BrainDecision;
  readonly threadId: string;
  readonly personaId: string;
}): OrchestratorTurnPayload {
  const { decision, threadId, personaId } = args;
  const base = {
    threadId,
    finalPersonaId: personaId,
    handoffs: [] as const,
    toolCalls: [] as const,
    advisorConsulted: false,
    tokensUsed: 0,
  };
  if (decision.kind === 'refusal') {
    return {
      ...base,
      responseText: decision.reason,
      timeMs: decision.provenance.latencyMs,
      refused: true,
      refusalGate: decision.gateThatRefused,
      // Surface the refusal as a held proposed-action so the existing
      // client UI (which renders proposedAction.reviewRequired) can show
      // the approval/refusal prompt — matching the persona path's
      // four-eye escalation surface.
      proposedAction: {
        verb: 'review',
        object: 'request',
        riskLevel: decision.gateThatRefused === 'inviolable' ? 'critical' : 'high',
        reviewRequired: true,
        executionHeld: true,
      },
    };
  }
  // answer | softened — both carry text + provenance.
  return {
    ...base,
    responseText: decision.text,
    timeMs: decision.provenance.latencyMs,
    refused: false,
  };
}

// ---------------------------------------------------------------------------
// Thread bookkeeping + generation.
// ---------------------------------------------------------------------------

export interface OrchestratorTurnContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly roles: ReadonlyArray<string>;
  readonly teamId?: string;
}

export interface GenerateBrainTurnArgs {
  readonly brain: Brain;
  readonly sov: SovereignBrain;
  readonly ctx: OrchestratorTurnContext;
  /** The (already memory-enriched + privacy-processed) user text. */
  readonly userText: string;
  /** Existing thread id; when absent a new thread is created. */
  readonly threadId?: string;
  /** Forced persona id for a NEW thread (else the default head persona). */
  readonly forcePersonaId?: string;
  /** Surface tier passed to the kernel — owner-portal / admin-portal / tenant-app. */
  readonly surface: 'owner-portal' | 'admin-portal' | 'tenant-app';
  /** Single-language locale directive (CLAUDE.md bilingual single-language). */
  readonly language: 'en' | 'sw';
  readonly logger: {
    readonly info: (meta: Record<string, unknown>, msg: string) => void;
    readonly warn: (meta: Record<string, unknown>, msg: string) => void;
  };
}

/** Personal-team sentinel — kept in lock-step with brain.hono.ts. */
const PERSONAL_TEAM_SENTINEL = '00000000-0000-0000-0000-000000000000';

/**
 * Generate one brain turn through the orchestrator main-loop while keeping
 * the thread store consistent so `/threads` continuity holds:
 *
 *   1. Resolve / create the thread (persona = forced or head default).
 *   2. Append the user message.
 *   3. Generate via `sov.kernel.think()` (orchestrator main-loop runs the
 *      rails + generation in ONE call — no separate preflight).
 *   4. Append the assistant `persona_message` (citations + confidence) —
 *      unless the kernel refused (then we append nothing, matching the
 *      persona path which never persists a refused answer).
 *   5. Return the normalized payload.
 *
 * Tenant isolation: the kernel scope carries the tenant on `req.scope`
 * (kind: 'tenant') so memory recall / provenance writes stay isolated; the
 * thread-store backend binds the tenant GUC per operation.
 *
 * Throws only on a genuine thread-store / kernel infra fault — the caller
 * maps that to the existing 500 / SSE error path.
 */
export async function generateBrainTurnViaOrchestrator(
  args: GenerateBrainTurnArgs,
): Promise<OrchestratorTurnPayload> {
  const { brain, sov, ctx, userText, surface, language, logger } = args;

  // 1. Resolve / create the thread.
  const personaIdForNew = args.forcePersonaId ?? DEFAULT_BRAIN_PERSONA_ID;
  let threadId = args.threadId;
  let personaId: string;
  if (!threadId) {
    const newId = randomUUID();
    const teamId = ctx.teamId?.trim() || PERSONAL_TEAM_SENTINEL;
    const created = await brain.threads.createThread({
      id: newId,
      tenantId: ctx.tenantId,
      initiatingUserId: ctx.userId,
      primaryPersonaId: personaIdForNew,
      teamId,
      title: userText.slice(0, 80),
      status: 'open',
    });
    threadId = created.id;
    personaId = created.primaryPersonaId;
  } else {
    const existing = await brain.threads.getThread(threadId);
    if (!existing) {
      throw new Error(`Thread ${threadId} not found`);
    }
    if (existing.tenantId !== ctx.tenantId) {
      // Defence-in-depth — never let a cross-tenant thread id leak.
      throw new Error(`Thread ${threadId} not found`);
    }
    personaId = args.forcePersonaId ?? existing.primaryPersonaId;
  }

  // 2. Append the user message.
  await brain.threads.append({
    id: randomUUID(),
    threadId,
    kind: 'user_message',
    createdAt: new Date().toISOString(),
    visibility: {
      scope: 'private',
      authorActorId: ctx.userId,
      initiatingUserId: ctx.userId,
      rationale: 'orchestrator_turn',
    },
    actorId: ctx.userId,
    text: userText,
  });

  // 3. Generate via the orchestrator main-loop (one call: rails + answer).
  const decision = await sov.kernel.think({
    threadId,
    userMessage: userText,
    scope: {
      kind: 'tenant',
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      roles: [...ctx.roles],
      personaId,
    },
    tier: 'tenant',
    stakes: 'medium',
    surface,
    // CLAUDE.md bilingual single-language: thread the active locale so the
    // orchestrator's terminal single-language directive renders correctly
    // (zero EN/SW mixing).
    language,
  });

  const payload = mapDecisionToTurnPayload({ decision, threadId, personaId });

  // 4. Persist the assistant message — only for a real answer. A refused
  // turn persists nothing (the persona path never stores a refused reply).
  if (!payload.refused && payload.responseText.length > 0) {
    await brain.threads.append({
      id: randomUUID(),
      threadId,
      kind: 'persona_message',
      personaId,
      createdAt: new Date().toISOString(),
      visibility: {
        scope: 'private',
        authorActorId: personaId,
        initiatingUserId: ctx.userId,
        rationale: 'orchestrator_answer',
      },
      actorId: personaId,
      text: payload.responseText,
      advisorConsulted: false,
      ...(decision.kind !== 'refusal'
        ? {
            confidence: decision.confidence.overall,
            citations: decision.citations.map((cit) => ({
              kind: cit.target.kind,
              id: cit.id,
              label: cit.label,
            })),
          }
        : {}),
    });
  }

  logger.info(
    {
      wiring: 'brain-orchestrator-turn',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      threadId,
      decision: decision.kind,
      refused: payload.refused,
      ...(payload.refusalGate ? { gate: payload.refusalGate } : {}),
    },
    'brain /turn: generated via orchestrator main-loop',
  );

  return payload;
}
