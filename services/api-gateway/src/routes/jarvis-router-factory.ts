/**
 * Jarvis router factory — every Borjie user (tenant resident,
 * property owner, estate manager, agency admin, internal HQ employee)
 * gets their own personalised first-person AI counterpart, sitting on
 * the same central-intelligence brain kernel. This factory takes a
 * surface + default tier and returns a Hono app that exposes:
 *
 *   POST /think                — single-turn thought
 *   POST /stream               — SSE-streamed turn (turn_start / delta / confidence / done)
 *   POST /briefing             — daily briefing
 *   POST /actions              — propose a sovereign-tier write action
 *   POST /actions/:id/sign     — first or second eye signature
 *   GET  /actions/:id          — fetch approval status
 *   GET  /actions              — list approvals (filter by status)
 *
 * Each surface gets a different default persona; per-user
 * personalisation rewrites the persona's opening with the operator's
 * name + role + affiliation so the AI greets THEM by name.
 */

// Architecture overview — see `.planning/jarvis-architecture.md` for
// the full Nyumba Mind reference: portal/persona/tier matrix, scope
// lattice, grounding pyramid, env switches, and migration roster.
// Critical: `admin-portal` is the AGENCY (our customers); HQ is the
// `admin-web`. Do not confuse the two surfaces.

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  personalisePersona,
  selectPersona,
  type UserProfile,
} from '@borjie/central-intelligence';
import type {
  ScopeContext,
  ThoughtRequest,
} from '@borjie/central-intelligence';
import { createFeedbackService } from '@borjie/database';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { getSharedPerTenantRateBudget } from '../middleware/per-tenant-rate-budget';
import { UserRole } from '../types/user-role';

// Local mirror of `GroundingViewRole` from `@borjie/database`. The
// barrel re-export is currently misread by the workspace resolver as a
// namespace (TS 2709); duplicating the literal-union shape here keeps
// the router type-safe without taking on a brittle cross-package cast.
type GroundingViewRole =
  | 'tenant'
  | 'manager'
  | 'owner'
  | 'org-admin'
  | 'sovereign';
import { getSovereignBrain } from '../composition/sovereign';
import { getDb } from '../composition/db-client';
import { withKernelSpan, type KernelTraceScope } from '../observability/kernel-tracing';
// INPUT CONTAINMENT (CLOSE-G) — the blessed ingress prompt-injection /
// jailbreak guard. Wired ONCE here so every Jarvis surface (customer /
// owner / manager / admin / platform) is covered on /think AND /stream
// BEFORE `sov.kernel.think` / `thinkStream` reaches the model. Mirrors
// brain.hono /turn: CRITICAL → single-language refusal (the model never
// sees it); lower severities → run on the detector-redacted text. The guard
// fails OPEN-but-logged, so a guard fault never drops a legitimate turn.
import {
  applyIngressGuard,
  pickIngressGuardLang,
} from '../composition/ingress-guard-apply.js';
// IP-EGRESS (CLOSE-G) — the single STREAMING kernel-event chokepoint. Wrapping
// `kernel.thinkStream(...)` DROPS model chain-of-thought (thought_delta) and
// runs every model-prose `text_delta` through the FAIL-CLOSED egress filter
// BEFORE the SSE wire. The kernel yields raw deltas before its own policy
// redaction ("the streaming consumer has already seen raw deltas"), so the IP
// strip MUST happen at this gateway seam — not one layer down.
import {
  guardKernelStream,
  buildSelfModelEgressPayload,
} from '../composition/kernel-event-projector.js';
// IP-EGRESS (CLOSE-G) — the NON-streaming /think JSON path must pass model prose
// through the SAME fail-closed egress firewall the /stream chokepoint already
// applies. Without it, decision.text/decision.hedge egress on /think with only
// the policy gate's PII+citation redaction — never the IP-strip classes
// (persona / prompt-leak / canary / secret / cross-tenant) that getEgressFilter
// enforces. We also project the kernel ProvenanceRecord to a render-safe subset
// so internal mechanic ids (sensorId / modelId / toolName / cohortFingerprints /
// hashes) never reach the wire — mirroring the projectKernelEvent done-frame
// stripping rules.
import { getEgressFilter } from '../composition/egress-filter-wiring.js';
// ENFORCED GROUNDING (anti-hallucination hard rule) — every Jarvis answer
// must cite >=1 real evidence_id (CLAUDE.md → Evidence-required AI output).
// The helpers reuse the SAME `auditChatResponse` / `decideStrictResponse`
// contract mining/chat + brain.hono use (no parallel mechanism). /think =
// HARD withhold (422); /stream = warn-only auditor frame. The asymmetry is
// deliberate: the corpus verifier inside the gate fails CLOSED (never blesses
// a fake citation), while these gate helpers fail OPEN (a broken auditor must
// never break chat). Extracted to `jarvis-grounding.ts` to keep this factory
// under the file-size budget.
import {
  auditAndEnforceThinkResponse,
  emitAuditorFrameStream,
  pickAuditLang,
} from './jarvis-grounding.js';
import pino from 'pino';

import { withSecurityEvents } from '@borjie/observability';
export type JarvisSurface = ThoughtRequest['surface'];

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'jarvis-router-factory',
});

/**
 * IP-EGRESS (CLOSE-G) — the generic, provider-agnostic SSE error message the
 * client may see. A raw `err.message` from the sovereign composition root or the
 * kernel iterator can leak provider / model / internal-id detail, so we NEVER
 * forward it to the wire. The real cause is logged server-side (pino) only.
 */
const GENERIC_STREAM_ERROR =
  'The assistant is temporarily unavailable. Please try again.';

/** Test seam — the generic SSE error banner, exported for assertion. */
export const GENERIC_STREAM_ERROR_FOR_TEST = GENERIC_STREAM_ERROR;

/** Fail-closed placeholder substituted when the egress guard wrapper throws. */
const EGRESS_FAIL_CLOSED = '[redacted]';

/**
 * IP-EGRESS (CLOSE-G) — run one model-generated text span through the
 * fail-closed egress filter before it leaves the /think JSON path. The
 * underlying filter already redacts on any internal fault; this wrapper also
 * try/catches so a construction fault fails closed to `[redacted]` rather than
 * leaking the raw model text. Empty / non-string spans pass through unchanged.
 */
function guardThinkText(text: string, tenantId: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    return getEgressFilter().guardFinal(text, tenantId).text;
  } catch (err) {
    logger.error(
      {
        wiring: 'jarvis-router-factory',
        tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'jarvis /think: egress guard threw — failing closed (redacting span)',
    );
    return EGRESS_FAIL_CLOSED;
  }
}

/**
 * IP-EGRESS (CLOSE-G) — project the kernel ProvenanceRecord to the render-safe
 * subset the client legitimately needs (thoughtId / threadId / timing /
 * confidence-adjacent scalars + a coarse tool count), dropping the internal
 * mechanic fields the projectKernelEvent done-frame also strips: sensorId,
 * modelId, per-tool toolName, cohortFingerprints, and the input/output hashes.
 * Returns a plain object (never mutates the source provenance).
 */
function projectProvenanceForEgress(
  provenance: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!provenance || typeof provenance !== 'object') return undefined;
  const toolCalls = Array.isArray(provenance.toolCallSummaries)
    ? provenance.toolCallSummaries
    : [];
  return {
    thoughtId: provenance.thoughtId,
    threadId: provenance.threadId,
    scopeKind: provenance.scopeKind,
    tier: provenance.tier,
    stakes: provenance.stakes,
    cacheHit: provenance.cacheHit,
    producedAt: provenance.producedAt,
    latencyMs: provenance.latencyMs,
    toolCallCount: toolCalls.length,
    ...(provenance.debateRoundsCompleted !== undefined
      ? { debateRoundsCompleted: provenance.debateRoundsCompleted }
      : {}),
    ...(provenance.debateConverged !== undefined
      ? { debateConverged: provenance.debateConverged }
      : {}),
  };
}

/**
 * IP-EGRESS (CLOSE-G) — return a client-safe projection of a kernel
 * BrainDecision for the /think JSON path: model prose (text / hedge / refusal
 * reason) routed through the fail-closed egress filter, and provenance reduced
 * to the render-safe subset. Never mutates the source decision (immutability).
 */
function projectDecisionForEgress(
  decision: unknown,
  tenantId: string,
): unknown {
  if (!decision || typeof decision !== 'object') return decision;
  const d = decision as Record<string, unknown>;
  const provenance = projectProvenanceForEgress(
    d.provenance as Record<string, unknown> | undefined,
  );
  if (d.kind === 'answer') {
    return {
      ...d,
      text: guardThinkText(d.text as string, tenantId),
      ...(provenance ? { provenance } : {}),
    };
  }
  if (d.kind === 'softened') {
    return {
      ...d,
      text: guardThinkText(d.text as string, tenantId),
      hedge: guardThinkText(d.hedge as string, tenantId),
      ...(provenance ? { provenance } : {}),
    };
  }
  if (d.kind === 'refusal') {
    return {
      ...d,
      reason: guardThinkText(d.reason as string, tenantId),
      ...(provenance ? { provenance } : {}),
    };
  }
  return provenance ? { ...d, provenance } : d;
}

export interface JarvisRouterConfig {
  /** Surface drives default persona selection. */
  readonly surface: JarvisSurface;
  /** Default tier for /think; can be overridden per request. */
  readonly defaultTier: ThoughtRequest['tier'];
  /** Default greeting style for personalisation. */
  readonly greetingStyle?: UserProfile['greetingStyle'];
  /**
   * If true, the surface is consumer-facing (tenant / owner) — we
   * tighten the per-request `tier` enum to safer values so the
   * consumer can't escalate themselves to org/industry tier.
   */
  readonly consumerSurface?: boolean;
  /**
   * Wave-3-int2 — post-kernel.think() capture hook (Piece L brain↔tab loop).
   *
   * When provided, the router fires-and-forgets a capture call after every
   * /think + /stream turn that emits an `answer` or `softened` decision.
   * The hook runs the brain output through entity extraction + matrix
   * dispatch → module_update_proposals. Errors do NOT bubble up to the
   * user reply.
   */
  readonly captureHook?: (input: {
    readonly tenant_id: string;
    readonly persona: {
      readonly persona_id: string;
      readonly tier: 1 | 2 | 3 | 4 | 5;
      readonly jurisdiction?: string;
    };
    readonly user_text: string;
    readonly assistant_text: string;
    readonly decision_kind: 'answer' | 'softened';
    readonly thread_id?: string | null;
    readonly user_id?: string | null;
  }) => Promise<unknown>;
}

const ALL_TIERS = [
  'tenant', 'offtake', 'pit', 'zone', 'site',
  'portfolio', 'org', 'industry',
] as const;
const CONSUMER_TIERS = ['tenant', 'offtake', 'pit', 'site'] as const;

const ProposeActionSchema = z.object({
  thoughtId: z.string().min(1).max(120),
  summary: z.string().min(1).max(400),
  toolName: z.string().min(1).max(120),
  payload: z.record(z.unknown()).default({}),
  stakes: z.enum(['medium', 'high', 'critical']).default('high'),
});

const SignSchema = z.object({
  verdict: z.enum(['approve', 'reject']),
  comment: z.string().max(800).optional(),
});

const BriefingSchema = z.object({
  day: z.string().min(1).max(40),
  threadId: z.string().min(1).max(120),
  dataPoints: z
    .array(
      z.object({
        topic: z.string().min(1).max(200),
        summary: z.string().min(1).max(800),
        severity: z.enum(['info', 'warn', 'urgent']),
        citationLabel: z.string().max(120).optional(),
      }),
    )
    .min(1)
    .max(20),
});

// Feedback signal schema — one row per user per kernel turn. The
// `correction` signal MAY be paired with a verbatim explanation; the
// other signals are usually a single click in the UI.
const FeedbackSchema = z.object({
  thoughtId: z.string().min(1).max(120),
  threadId: z.string().min(1).max(120),
  signal: z.enum(['thumbs-up', 'thumbs-down', 'correction', 'flagged']),
  rating: z.number().int().min(1).max(5).optional(),
  correctionText: z.string().max(4_000).optional(),
  category: z.string().max(64).optional(),
});

function actorProfileFromContext(
  c: any,
  greetingStyle: UserProfile['greetingStyle'] = 'warm',
): UserProfile {
  const auth = c.get('auth') ?? {};
  return {
    userId: auth.userId ?? auth.sub ?? 'unknown-user',
    displayName: auth.displayName ?? auth.email ?? 'Operator',
    role: (auth.roles && auth.roles[0]) || 'user',
    affiliation: auth.tenantName ?? auth.orgName ?? 'Borjie',
    greetingStyle,
  };
}

function scopeFromContext(c: any, surface: JarvisSurface): ScopeContext {
  const auth = c.get('auth') ?? {};
  const tenantId = auth.tenantId ?? null;
  const userId = auth.userId ?? auth.sub ?? 'unknown-user';
  const roles = Array.isArray(auth.roles) ? auth.roles : [];
  // The central-intelligence ScopeContext is a binary discriminator
  // (tenant | platform). The surface drives PERSONA, not scope.
  if (surface === 'platform-hq' || !tenantId) {
    return {
      kind: 'platform',
      actorUserId: userId,
      roles,
      personaId: surfacePersonaId(surface),
    };
  }
  return {
    kind: 'tenant',
    tenantId,
    actorUserId: userId,
    roles,
    personaId: surfacePersonaId(surface),
  };
}

/**
 * Chunk a string into ~`pieces` near-equal segments for SSE delta
 * streaming. Tries to break on whitespace so partial words don't flash
 * to the user; falls back to a hard slice for very short / single-word
 * input. Always returns at least one chunk (even for empty strings, an
 * empty chunk is omitted).
 */
function chunkText(text: string, pieces: number): ReadonlyArray<string> {
  if (text.length === 0) return [];
  const target = Math.max(1, Math.min(pieces, text.length));
  if (text.length <= target) return [text];

  const ideal = Math.ceil(text.length / target);
  const out: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + ideal, text.length);
    // Snap to nearest whitespace inside [end - 20, end] so we don't
    // split mid-word. If no whitespace is found in the window, take
    // the hard cut.
    if (end < text.length) {
      const window = text.slice(Math.max(cursor, end - 20), end);
      const lastSpace = window.lastIndexOf(' ');
      if (lastSpace >= 0) {
        end = Math.max(cursor, end - 20) + lastSpace + 1;
      }
    }
    out.push(text.slice(cursor, end));
    cursor = end;
  }
  return out;
}

/**
 * Map a kernel tier string to the 1..5 PersonaContext tier the
 * dispatch-router expects. Default to 4 (T-tier line staff) so any
 * unknown / loose tiers don't accidentally get owner-level trust.
 */
function tierToNumber(tier: ThoughtRequest['tier']): 1 | 2 | 3 | 4 | 5 {
  switch (tier) {
    case 'industry':
    case 'org':
      return 1;
    case 'portfolio':
      return 2;
    case 'site':
    case 'zone':
      return 3;
    case 'pit':
    case 'offtake':
      return 4;
    case 'tenant':
      return 5;
    default:
      return 4;
  }
}

function surfacePersonaId(surface: JarvisSurface): string {
  // Surface → default persona's id, used as the ScopeContext personaId
  // hint. Real persona selection is done server-side via selectPersona().
  switch (surface) {
    case 'tenant-app':         return 'counterparty-resident';
    case 'owner-portal':       return 'owner-advisor';
    case 'estate-manager-app': return 'estate-manager';
    case 'admin-portal':       return 'org-admin';
    case 'platform-hq':        return 'sovereign-admin';
    case 'classroom':          return 'classroom-tutor';
    case 'marketing':          return 'marketing-guide';
  }
}

/**
 * Surface → grounding visibility role. Drives WHICH slice of tenant
 * data the user's personal Nyumba Mind sees:
 *   tenant-app / classroom / marketing → resident-tier (own lease)
 *   estate-manager-app                 → assigned-properties only
 *   owner-portal                       → owned-properties only
 *   admin-portal                       → full tenant view
 *   platform-hq                        → no grounding (DP cohort path)
 */
function roleForSurface(surface: JarvisSurface): GroundingViewRole {
  switch (surface) {
    case 'tenant-app':         return 'tenant';
    case 'classroom':          return 'tenant';
    case 'marketing':          return 'tenant';
    case 'estate-manager-app': return 'manager';
    case 'owner-portal':       return 'owner';
    case 'admin-portal':       return 'org-admin';
    case 'platform-hq':        return 'sovereign';
  }
}

/**
 * Pull the SovereignScope (tenantId + userId + role) from a Hono
 * context. Centralised so every route handler in this factory uses
 * the same key shape — otherwise the per-user cache would partition
 * unevenly.
 */
function sovereignScopeFromContext(
  c: any,
  surface: JarvisSurface,
): { tenantId: string | null; userId: string | null; role: GroundingViewRole } {
  const auth = c.get('auth') ?? {};
  return {
    tenantId: auth.tenantId ?? null,
    userId: auth.userId ?? auth.sub ?? null,
    role: roleForSurface(surface),
  };
}

// Multimodal attachment caps. The gateway enforces a per-turn count cap
// and a per-attachment size cap so a misbehaving client cannot send a
// 100 MB image and stall the kernel for everyone else. Sizes are
// expressed in base64-decoded BYTES; the zod schema validates against a
// pre-decoded base64 length budget (see MAX_BASE64_LEN).
const MAX_ATTACHMENTS_PER_TURN = 10;
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024; // 4 MiB decoded
// Base64 inflates by 4/3; round up + add a tiny safety margin so we
// reject only when the decoded payload truly exceeds the cap.
const MAX_BASE64_LEN = Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4;

const AttachmentSchema = z.object({
  kind: z.literal('image'),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  data: z
    .string()
    .min(1)
    .max(MAX_BASE64_LEN, {
      message: `IMAGE_TOO_LARGE: each image must be <= ${MAX_ATTACHMENT_BYTES} bytes decoded`,
    }),
  caption: z.string().max(240).optional(),
});

export function createJarvisRouter(config: JarvisRouterConfig): Hono {
  const tierEnum = config.consumerSurface
    ? z.enum(CONSUMER_TIERS)
    : z.enum(ALL_TIERS);

  const ThinkSchema = z.object({
    threadId: z.string().min(1).max(120),
    userMessage: z.string().min(1).max(4_000),
    tier: tierEnum.default(config.defaultTier as any),
    stakes: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    requireJudge: z.boolean().optional(),
    attachments: z
      .array(AttachmentSchema)
      .max(MAX_ATTACHMENTS_PER_TURN, {
        message: `IMAGE_TOO_LARGE: at most ${MAX_ATTACHMENTS_PER_TURN} attachments per turn`,
      })
      .optional(),
  });

  const app = new Hono();
  app.use('*', authMiddleware);

  // PLATFORM-ADMIN GATE — the `platform-hq` surface serves the sovereign
  // PLATFORM_ADMIN persona (cross-tenant, no tenant scope). It MUST be
  // restricted to Borjie HQ staff (SUPER_ADMIN / ADMIN) so an ordinary
  // authenticated tenant user cannot reach the sovereign brain. The gate
  // lives HERE — per-surface, NOT globally — because createJarvisRouter is
  // shared across every consumer/owner/manager/admin surface; only
  // platform-hq carries the sovereign persona. Mirrors the
  // requireRole(SUPER_ADMIN, ADMIN) gate on
  // routes/mining/internal/audit-pack.hono.ts (the other HQ-only surface).
  if (config.surface === 'platform-hq') {
    app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
  }

  // Per-tenant AI token-budget — mounted HERE, INSIDE the jarvis sub-app and
  // AFTER `authMiddleware`, so `c.get('auth')` (hence the tenantId the budget
  // keys on) is resolved when the handler runs. Previously the budget was
  // mounted as PARENT-app middleware (`api.use('/owner/jarvis/*', …)`), which
  // in Hono runs BEFORE a mounted sub-app's own middleware — so auth was
  // undefined, the tenantId extractor returned null, and the budget took its
  // `!tenantId` bypass on EVERY request: it never enforced, and a runaway
  // tenant could starve the shared Anthropic token budget. The shared singleton
  // is resolved lazily (at request time) so the composition root can construct
  // it with a real Redis client first.
  app.use('*', (c, next) => getSharedPerTenantRateBudget().handler(c, next));

  app.post('/think', zValidator('json', ThinkSchema), withSecurityEvents({ action: 'jarvis.create', resource: 'jarvis', severity: 'info' }, async (c) => {
    const body = c.req.valid('json');
    const profile = actorProfileFromContext(c, config.greetingStyle);
    const scope = scopeFromContext(c, config.surface);

    // INPUT CONTAINMENT (CLOSE-G) — guard `userMessage` BEFORE `kernel.think`.
    // CRITICAL → single-language JSON refusal (the model never sees it);
    // lower severities → run on the detector-redacted text. Fail-OPEN.
    const ingress = await applyIngressGuard({
      userText: body.userMessage,
      tenantId: scope.kind === 'tenant' ? scope.tenantId : '',
      userId: scope.actorUserId ?? null,
      lang: pickIngressGuardLang(c.req.header('accept-language') ?? null),
    });
    if (ingress.refused) {
      return c.json(
        {
          success: false,
          surface: config.surface,
          error: {
            code: 'INPUT_GUARD_REFUSED',
            message: ingress.refusalMessage,
          },
        },
        403,
      );
    }
    const guardedUserMessage = ingress.text;

    const sov = await getSovereignBrain(sovereignScopeFromContext(c, config.surface));

    const req: ThoughtRequest = {
      threadId: body.threadId,
      userMessage: guardedUserMessage,
      scope,
      tier: body.tier,
      stakes: body.stakes,
      surface: config.surface,
      requireJudge: body.requireJudge,
      ...(body.attachments && body.attachments.length > 0
        ? { attachments: body.attachments }
        : {}),
    };

    const basePersona = selectPersona(req);
    const personalised = personalisePersona(basePersona, profile);
    const traceScope: KernelTraceScope = {
      tenantId: scope.kind === 'tenant' ? scope.tenantId ?? null : null,
      userId: scope.actorUserId ?? null,
      surface: config.surface,
      tier: req.tier,
      stakes: req.stakes,
      scopeKind: scope.kind,
    };
    const decision = await withKernelSpan(
      `tho_pending_${body.threadId}`,
      traceScope,
      () => sov.kernel.think(req),
    );

    // Wave-3-int2 — fire-and-forget brain↔tab capture hook. Refusals are
    // dropped at the hook level; only `answer` / `softened` emit captures.
    if (config.captureHook && scope.kind === 'tenant' && scope.tenantId) {
      const kind = (decision as { kind?: string }).kind;
      const text = (decision as { text?: string }).text ?? '';
      if (kind === 'answer' || kind === 'softened') {
        const tenantId = scope.tenantId;
        Promise.resolve(
          config.captureHook({
            tenant_id: tenantId,
            persona: {
              persona_id: personalised.id,
              tier: tierToNumber(req.tier),
              jurisdiction: 'TZ',
            },
            user_text: guardedUserMessage,
            assistant_text: text,
            decision_kind: kind,
            thread_id: body.threadId,
            user_id: scope.actorUserId ?? null,
          }),
        ).catch(() => {
          // Capture is non-essential — swallow errors so the user reply
          // is never blocked. The hook's own logger records the failure.
        });
      }
    }

    // ENFORCED GROUNDING (HARD mode) — audit the model prose against the
    // evidence-chain hard rule BEFORE egress. A tenant-scoped, ungrounded (or
    // corpus-unverified) answer is WITHHELD: we substitute a safe
    // single-language message + 422 and NEVER serialise the original decision
    // (so no ungrounded provider prose / reasoning leaks). Platform scope and
    // non-answer decisions skip the gate. Fail-OPEN on a gate fault.
    const auditLang = pickAuditLang(c.req.header('accept-language') ?? null);
    const grounding = await auditAndEnforceThinkResponse({
      decision,
      tenantId: scope.kind === 'tenant' ? scope.tenantId ?? null : null,
      userId: scope.actorUserId ?? null,
      threadId: body.threadId,
      personaId: personalised.id,
      lang: auditLang,
      surface: config.surface,
    });
    if (grounding.withheld) {
      return c.json(
        {
          success: true,
          surface: config.surface,
          persona: {
            id: personalised.id,
            displayName: personalised.displayName,
            firstPersonNoun: personalised.firstPersonNoun,
          },
          // The ungrounded decision is dropped; only the safe message ships.
          decision: { kind: 'withheld', text: grounding.safeText },
          audit: grounding.audit,
        },
        422,
      );
    }

    // IP-EGRESS (CLOSE-G) — the /think JSON path is the lone brain-output route
    // that historically returned `decision` verbatim. Route model prose through
    // the fail-closed egress firewall and project provenance to a render-safe
    // subset BEFORE serialising, mirroring the /stream chokepoint. The egress
    // tenant scopes the filter exactly like /stream (platform scope → '' makes
    // the cross-tenant strip inert; the prose / persona / canary / secret strips
    // still apply).
    const egressTenantId = scope.kind === 'tenant' ? scope.tenantId : '';
    const safeDecision = projectDecisionForEgress(decision, egressTenantId);

    return c.json({
      success: true,
      surface: config.surface,
      persona: {
        id: personalised.id,
        displayName: personalised.displayName,
        firstPersonNoun: personalised.firstPersonNoun,
      },
      decision: safeDecision,
      ...(grounding.audit ? { audit: grounding.audit } : {}),
    });
  }));

  // ───────────────────────────────────────────────────────────────────
  // POST /stream — SSE variant of /think.
  //
  // Wire-level token streaming. Forwards each event from the EGRESS-GUARDED
  // `guardKernelStream(kernel.thinkStream(req))` onto the SSE wire:
  //
  //   event: turn_start  → { persona }
  //   event: delta       → { delta: '<egress-filtered token-chunk>' }
  //   event: gate        → { gate, verdict }              (drift / policy / inviolable)
  //   event: confidence  → ConfidenceVector               (answers / softened)
  //   event: done        → { thoughtId, kind }
  //
  // IP-EGRESS (CLOSE-G): model chain-of-thought (`thought_delta`) is DROPPED at
  // the `guardKernelStream` chokepoint and NEVER reaches the wire; every prose
  // `text_delta` is run through the fail-closed egress filter first. There is no
  // `thinking` event — extended-thinking CoT is the model's private scratch-pad.
  //
  // For sensors that don't expose `callStream`, the kernel falls back
  // internally to a single-shot `call()` and emits ONE text_delta with
  // the whole text — the wire framing is identical so clients don't
  // need to care which path the kernel took.
  //
  // Pre-sensor refusal path: turn_start, gate event (inviolable), done.
  // ───────────────────────────────────────────────────────────────────
  app.post('/stream', zValidator('json', ThinkSchema), withSecurityEvents({ action: 'jarvis.create', resource: 'jarvis', severity: 'info' }, async (c) => {
    const body = c.req.valid('json');
    const profile = actorProfileFromContext(c, config.greetingStyle);
    const scope = scopeFromContext(c, config.surface);

    // INPUT CONTAINMENT (CLOSE-G) — guard `userMessage` BEFORE
    // `kernel.thinkStream`. CRITICAL → single-language SSE refusal frame (the
    // model never sees it); lower severities → run on the detector-redacted
    // text. Fail-OPEN-but-logged.
    const ingress = await applyIngressGuard({
      userText: body.userMessage,
      tenantId: scope.kind === 'tenant' ? scope.tenantId : '',
      userId: scope.actorUserId ?? null,
      lang: pickIngressGuardLang(c.req.header('accept-language') ?? null),
    });
    if (ingress.refused) {
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            message: ingress.refusalMessage,
            code: 'INPUT_GUARD_REFUSED',
            retryable: false,
          }),
        });
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ thoughtId: '', kind: 'refusal' }),
        });
      });
    }
    const guardedUserMessage = ingress.text;

    const sov = await getSovereignBrain(sovereignScopeFromContext(c, config.surface));

    const req: ThoughtRequest = {
      threadId: body.threadId,
      userMessage: guardedUserMessage,
      scope,
      tier: body.tier,
      stakes: body.stakes,
      surface: config.surface,
      requireJudge: body.requireJudge,
      ...(body.attachments && body.attachments.length > 0
        ? { attachments: body.attachments }
        : {}),
    };

    // Per-user persona personalisation is applied by the gateway on
    // the kernel's surface-default persona so the AI greets THIS user
    // by name on the turn_start event.
    const basePersona = selectPersona(req);
    const personalised = personalisePersona(basePersona, profile);

    // Stream-turn span — the iterator is consumed inside a
    // `withKernelSpan` wrapper so the streamed turn shows up in OTel
    // alongside non-streaming /think calls. We collect the final
    // decision (emitted via the `done` event) and return it as the
    // span result; if the stream errors, the wrapper records the
    // exception and re-throws.
    const streamTraceScope: KernelTraceScope = {
      tenantId: scope.kind === 'tenant' ? scope.tenantId ?? null : null,
      userId: scope.actorUserId ?? null,
      surface: config.surface,
      tier: req.tier,
      stakes: req.stakes,
      scopeKind: scope.kind,
    };

    return streamSSE(c, async (stream) => {
      // SSE RESILIENCE (mfr-1) — register a disconnect hook so a client that
      // drops mid-turn stops the kernel iterator promptly. Hono's streamSSE
      // swallows write errors, so without this the for-await loop over
      // guardKernelStream keeps pulling kernel events (and extra model work)
      // after the reader is gone. We flip the signal on abort and break the
      // loop at its top — matching brain-teach's established pattern. (Threading
      // the signal all the way into the provider HTTP call to cancel upstream
      // token generation is a separate, larger enhancement — see needsAttention.)
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());
      // mfr-1 — thread the disconnect signal into the kernel so upstream
      // provider token generation can cancel, not just stop being drained
      // here. The `abort.signal.aborted` break below remains the guaranteed
      // gateway-side floor; this is the upstream-cancellation enhancement.
      // See needsAttention for the kernel signature that must accept +
      // forward it to the provider stream call.
      const kernelOpts = { signal: abort.signal };
      try {
        await withKernelSpan(
          `tho_stream_${body.threadId}`,
          streamTraceScope,
          // The wrapper expects a thennable returning a KernelDecisionForSpan
          // shape; we synthesise one from the final `done` event so the
          // span's decision-attribute set lines up with the non-streaming
          // /think handler.
          async () => {
            let finalDecision: any = {
              kind: 'unknown',
              provenance: {
                thoughtId: `tho_stream_${body.threadId}`,
                sensorId: '__streaming__',
                modelId: '__streaming__',
                latencyMs: 0,
              },
            };
            // IP-EGRESS (CLOSE-G) — consume the kernel stream through the single
            // chokepoint: `thought_delta` (CoT) is dropped and never yielded,
            // and every `text_delta` arrives already egress-filtered. The egress
            // tenant scopes the filter (platform scope has none — the
            // cross-tenant strip is then inert; the prose / CoT / secret strips
            // still apply).
            const egressTenantId =
              scope.kind === 'tenant' ? scope.tenantId : '';
            for await (const ev of guardKernelStream(
              sov.kernel.thinkStream(req, kernelOpts),
              egressTenantId,
            )) {
          // SSE RESILIENCE (mfr-1) — client disconnected: stop consuming the
          // kernel stream so its async-generator cleanup runs and no further
          // events are processed for a connection no one reads.
          if (abort.signal.aborted) break;
          if (ev.kind === 'turn_start') {
            await stream.writeSSE({
              event: 'turn_start',
              data: JSON.stringify({
                persona: {
                  id: personalised.id,
                  displayName: personalised.displayName,
                  firstPersonNoun: personalised.firstPersonNoun,
                },
              }),
            });
            continue;
          }
          if (ev.kind === 'text_delta') {
            // Already egress-filtered by guardKernelStream (fail-closed).
            await stream.writeSSE({
              event: 'delta',
              data: JSON.stringify({ delta: ev.text }),
            });
            continue;
          }
          if (ev.kind === 'gate_verdict') {
            await stream.writeSSE({
              event: 'gate',
              data: JSON.stringify({ gate: ev.gate, verdict: ev.verdict }),
            });
            continue;
          }
          if (ev.kind === 'confidence') {
            await stream.writeSSE({
              event: 'confidence',
              data: JSON.stringify(ev.vector),
            });
            continue;
          }
          if (ev.kind === 'self_model') {
            // Honest epistemic-state surface (Win #2 / INV-H). ADDITIVE frame
            // emitted by the kernel after `confidence`, before `done`. It is
            // egress-SAFE by construction (fixed posture enum + constant axis
            // labels — NEVER the audit math or model prose), so we forward it
            // as a typed `self_model` SSE frame. `buildSelfModelEgressPayload`
            // copies ONLY the four known fields and shape-clamps each axis.
            await stream.writeSSE({
              event: 'self_model',
              data: JSON.stringify(
                buildSelfModelEgressPayload(
                  ev as unknown as Record<string, unknown>,
                ),
              ),
            });
            continue;
          }
          // HONEST MID-STREAM DEGRADE (D19) — the kernel emits a TERMINAL
          // `error` frame (instead of `done`) when the sensor faults mid-turn
          // so a truncated turn is NEVER presented as complete. Without this
          // branch the frame falls through and the loop simply ends, leaving
          // the client with a SILENTLY truncated stream (no done, no error).
          // Surface a client-visible error frame + honest terminal done, then
          // stop. IP-EGRESS: emit the GENERIC banner only — the raw `ev.reason`
          // (provider / model / internal detail) is logged server-side, never
          // forwarded to the wire.
          //
          if (ev.kind === 'error') {
            logger.error(
              {
                wiring: 'jarvis-router-factory',
                surface: config.surface,
                threadId: body.threadId,
                reason: ev.reason,
                partial: ev.partial,
              },
              'jarvis /stream: kernel emitted terminal error frame (mid-stream degrade)',
            );
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({
                message: GENERIC_STREAM_ERROR,
                code: 'INTERNAL',
                retryable: false,
              }),
            });
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({ thoughtId: '', kind: 'error' }),
            });
            return finalDecision;
          }
          if (ev.kind === 'done') {
            finalDecision = ev.decision;
            // ENFORCED GROUNDING (SOFT mode) — emit a warn-only `auditor`
            // frame BEFORE `done` so the client can render an "unverified"
            // badge. Tokens were already streamed (a stream cannot un-send),
            // so HARD withhold lives on /think only. Fail-OPEN — never aborts
            // the turn. Platform scope / non-answer decisions are skipped.
            await emitAuditorFrameStream(stream, {
              decision: ev.decision,
              tenantId:
                scope.kind === 'tenant' ? scope.tenantId ?? null : null,
              userId: scope.actorUserId ?? null,
              threadId: body.threadId,
              personaId: personalised.id,
              surface: config.surface,
            });
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({
                thoughtId: ev.decision.provenance.thoughtId,
                kind: ev.decision.kind,
              }),
            });
                return finalDecision;
              }
            }
            return finalDecision;
          },
        );
      } catch (err) {
        // IP-EGRESS (CLOSE-G) — log the raw cause server-side (pino) only; the
        // client error carries the GENERIC banner so a provider / model /
        // internal-id detail in `err.message` never reaches the SSE wire.
        logger.error(
          {
            wiring: 'jarvis-router-factory',
            surface: config.surface,
            threadId: body.threadId,
            err: err instanceof Error ? err.message : String(err),
          },
          'jarvis-router-factory: thinkStream failed',
        );
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: GENERIC_STREAM_ERROR }),
        });
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ thoughtId: '', kind: 'refusal' }),
        });
      }
    });
  }));

  app.post('/briefing', zValidator('json', BriefingSchema), withSecurityEvents({ action: 'jarvis.create', resource: 'jarvis', severity: 'info' }, async (c) => {
    const body = c.req.valid('json');
    const profile = actorProfileFromContext(c, config.greetingStyle);
    const scope = scopeFromContext(c, config.surface);
    const sov = await getSovereignBrain(sovereignScopeFromContext(c, config.surface));

    const briefingTraceScope: KernelTraceScope = {
      tenantId: scope.kind === 'tenant' ? scope.tenantId ?? null : null,
      userId: scope.actorUserId ?? null,
      surface: config.surface,
      tier: 'briefing',
      stakes: 'low',
      scopeKind: scope.kind,
    };
    const briefing = await withKernelSpan(
      `tho_briefing_${body.threadId}`,
      briefingTraceScope,
      async () => {
        const composed = await sov.briefing.compose({
          day: body.day,
          user: profile,
          scope,
          threadId: body.threadId,
          dataPoints: body.dataPoints,
          topPriority:
            body.dataPoints.find((d) => d.severity === 'urgent') ??
            body.dataPoints.find((d) => d.severity === 'warn') ??
            body.dataPoints[0] ??
            null,
        });
        // Briefings don't have a kernel-grade decision shape; synthesise a
        // minimal one so the trace span gets populated cleanly.
        return {
          kind: 'answer',
          provenance: {
            thoughtId: `tho_briefing_${body.threadId}`,
            sensorId: '__briefing__',
            modelId: '__briefing__',
            latencyMs: 0,
          },
          briefing: composed,
        } as any;
      },
    );
    return c.json({ success: true, surface: config.surface, briefing: (briefing as any).briefing });
  }));

  app.post('/actions', zValidator('json', ProposeActionSchema), withSecurityEvents({ action: 'jarvis.create', resource: 'jarvis', severity: 'info' }, async (c) => {
    const body = c.req.valid('json');
    const auth = c.get('auth') ?? {};
    const proposerUserId = auth.userId ?? auth.sub ?? 'unknown-user';
    const sov = await getSovereignBrain(sovereignScopeFromContext(c, config.surface));

    const record = await sov.approvals.propose({
      proposerUserId,
      thoughtId: body.thoughtId,
      summary: body.summary,
      toolName: body.toolName,
      payload: body.payload,
      stakes: body.stakes,
    });
    return c.json({ success: true, approval: record });
  }));

  app.post('/actions/:id/sign', zValidator('json', SignSchema), withSecurityEvents({ action: 'jarvis.create', resource: 'jarvis', severity: 'info' }, async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const auth = c.get('auth') ?? {};
    const approverUserId = auth.userId ?? auth.sub ?? 'unknown-user';
    const sov = await getSovereignBrain(sovereignScopeFromContext(c, config.surface));

    try {
      const record = await sov.approvals.sign({
        actionId: id,
        approverUserId,
        verdict: body.verdict,
        comment: body.comment,
      });
      return c.json({ success: true, approval: record });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'sign failed';
      return c.json(
        { success: false, error: { code: 'SIGN_REJECTED', message } },
        400,
      );
    }
  }));

  app.get('/actions/:id', async (c) => {
    const id = c.req.param('id');
    const auth = c.get('auth') ?? {};
    const sov = await getSovereignBrain(sovereignScopeFromContext(c, config.surface));
    const record = await sov.approvals.get(id);
    if (!record) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'approval not found' } },
        404,
      );
    }
    return c.json({ success: true, approval: record });
  });

  app.get('/actions', async (c) => {
    const auth = c.get('auth') ?? {};
    const sov = await getSovereignBrain(sovereignScopeFromContext(c, config.surface));
    const status = c.req.query('status') as
      | 'pending' | 'one-eye' | 'approved' | 'rejected' | 'expired' | undefined;
    const records = await sov.approvals.list(status ? { status } : undefined);
    return c.json({ success: true, approvals: records });
  });

  // ───────────────────────────────────────────────────────────────────
  // POST /feedback — online-learning signal capture.
  //
  // Persists one row in `kernel_feedback` (migration 0122) keyed by
  // tenantId + userId + thoughtId. The kernel reads the rolling
  // window at step 4 (memory recall) on subsequent turns so the
  // brain learns from real interaction. Mirrors LITFIN's online-
  // learning loop and closes the "stock LLMs are STATIC" gap.
  //
  // Auth: tenantId + userId come from the auth middleware. The body
  // carries the signal; we never trust caller-supplied identity.
  // Without a configured DB the route reports a soft 503 — the
  // signal is dropped rather than queued in memory (which would lie
  // to the caller about persistence).
  // ───────────────────────────────────────────────────────────────────
  app.post('/feedback', zValidator('json', FeedbackSchema), withSecurityEvents({ action: 'jarvis.create', resource: 'jarvis', severity: 'info' }, async (c) => {
    const body = c.req.valid('json');
    const auth = c.get('auth') ?? {};
    const tenantId = auth.tenantId ?? null;
    const userId = auth.userId ?? auth.sub ?? null;
    if (!tenantId || !userId) {
      return c.json(
        {
          success: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: 'feedback requires an authenticated tenant + user',
          },
        },
        401,
      );
    }

    const db = getDb();
    if (!db) {
      return c.json(
        {
          success: false,
          error: {
            code: 'FEEDBACK_PERSISTENCE_UNAVAILABLE',
            message: 'feedback store is not configured (DATABASE_URL unset)',
          },
        },
        503,
      );
    }

    const svc = createFeedbackService(db);
    const out = await svc.record({
      tenantId,
      userId,
      thoughtId: body.thoughtId,
      threadId: body.threadId,
      signal: body.signal,
      ...(typeof body.rating === 'number' ? { rating: body.rating } : {}),
      ...(body.correctionText ? { correctionText: body.correctionText } : {}),
      ...(body.category ? { category: body.category } : {}),
    });

    return c.json({ success: true, id: out.id });
  }));

  return app;
}

// ─────────────────────────────────────────────────────────────────────
// Pre-configured Jarvis surfaces — every Borjie user gets one.
//
// Wave-3-int2: the captureHook is wired LATE (after createDispatchRouterWiring
// runs at boot). Until then, the routers default to no hook so the existing
// tests continue to pass.
// ─────────────────────────────────────────────────────────────────────

let sharedCaptureHook: JarvisRouterConfig['captureHook'] | undefined;

/**
 * Wave-3-int2 — install a shared captureHook on every pre-configured
 * Jarvis router. Called once from the api-gateway composition root after
 * `createDispatchRouterWiring()` returns.
 *
 * Safe to call multiple times — last setter wins (test environments may
 * re-install with stubbed hooks).
 */
export function installJarvisCaptureHook(
  hook: JarvisRouterConfig['captureHook'],
): void {
  sharedCaptureHook = hook;
}

function withSharedHook(config: JarvisRouterConfig): JarvisRouterConfig {
  return new Proxy(config, {
    get(target, prop, receiver) {
      if (prop === 'captureHook') return target.captureHook ?? sharedCaptureHook;
      return Reflect.get(target, prop, receiver);
    },
  });
}

export const tenantJarvisRouter   = createJarvisRouter(withSharedHook({ surface: 'tenant-app',         defaultTier: 'offtake',  greetingStyle: 'warm',   consumerSurface: true }));
export const ownerJarvisRouter    = createJarvisRouter(withSharedHook({ surface: 'owner-portal',       defaultTier: 'portfolio',greetingStyle: 'warm' }));
export const managerJarvisRouter  = createJarvisRouter(withSharedHook({ surface: 'estate-manager-app', defaultTier: 'site',     greetingStyle: 'terse' }));
export const orgAdminJarvisRouter = createJarvisRouter(withSharedHook({ surface: 'admin-portal',       defaultTier: 'org',      greetingStyle: 'warm' }));
export const platformHqJarvisRouter = createJarvisRouter(withSharedHook({ surface: 'platform-hq',      defaultTier: 'industry', greetingStyle: 'warm' }));
