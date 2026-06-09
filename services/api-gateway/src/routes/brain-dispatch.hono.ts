/**
 * /api/v1/brain/dispatch — VP department-head dispatch (Gap 6).
 *
 * Owner/admin chat-only command surface. The mining operator tells Mr.
 * Mwikila "VP Operations, chase the open maintenance tickets on the north
 * bench" or "VP Finance, where are my outstanding royalties" and this route:
 *   1. Resolves the VP via `createVpByName` (the five orphan VPs are now
 *      wired behind the kernel registry).
 *   2. Asks the VP to `orchestrate()` the instruction into a plan of
 *      line-worker spawns + capability gaps.
 *   3. Runs each spawn's sub-MD through its full four-stage pipeline
 *      (observe -> map -> redesign -> automate) with an Anthropic-backed LLM
 *      port (honest-degrade to the deterministic fallback when no key).
 *   4. Returns the plan + per-sub-MD results + the gaps the VP recorded.
 *
 * Request body (Zod-validated):
 *   {
 *     vp: "vp.operations" | "vp.finance" | "vp.growth" | "vp.people"
 *         | "vp.risk-compliance",
 *     instruction: string,           // 1..4000 chars
 *     threadId?: string,             // optional chat-thread continuity id
 *     kind?: "status-check" | "investigate" | "remediate"
 *            | "weekly-report-request" | "wake-from-monitor",
 *     language?: "en" | "sw"         // EN default; toggle is ABSOLUTE
 *   }
 *
 * Guards (mirrors md-agentic.hono.ts / org-admin.hono.ts):
 *   - `authMiddleware` verifies the JWT and binds tenant/actor on the ctx.
 *   - Owner/admin tier gate on the dispatch surface (403 otherwise) — a
 *     tenant or staff role cannot fan out the VP cluster.
 *
 * Honest-degrade everywhere (CLAUDE.md hard rule): a line-worker with no
 * sub-MD is reported `skipped` with `unknown_sub_md`; a sub-MD that throws is
 * reported `failed` with its error; nothing is fabricated. Pino logger only.
 *
 * Bilingual (CLAUDE.md hard rule): every user-facing string renders in EXACTLY
 * one language per the `language` toggle — no EN/SW mixing.
 *
 * Mounted ADDITIVELY in services/api-gateway/src/index.ts under /brain; does
 * NOT touch the base brain router.
 *
 * Ported from the BN /brain/dispatch route and retargeted real-estate ->
 * mining (the VP roster + sub-MD line-workers already carry mining names).
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import pino from 'pino';
import { withSecurityEvents } from '@borjie/observability';
import {
  createVpByName,
  isVpName,
  createRegistryLineWorkerCatalogue,
  getSubMdFactory,
  VP_REGISTRY_NAMES,
  DEFAULT_SUB_MD_BUDGET,
} from '@borjie/central-intelligence';
import type {
  VpName,
  OwnerIntent,
  OwnerIntentKind,
  VpOrchestrationPlan,
  ScopeContext,
  ScopeFilter,
  SubMdContext,
  SubMdLlmPort,
  ObservedEvent,
} from '@borjie/central-intelligence';

import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';
import {
  createBrainLlmClient,
  BRAIN_LLM_MODELS,
} from '../services/brain/llm-call';
// SEC-4 / INV-H — IP-egress output firewall. The sub-MD chain returns
// Anthropic-generated free text (proposal.summary / steps[].description /
// steps[].expectedImpact / artifact.skillName) in the `c.json` body. Internal
// cognition / secrets / cross-tenant leakage in a sub-MD chain output must NOT
// reach the client raw, so every LLM-derived string in the response is passed
// through the FAIL-CLOSED guard before the body is built. DEFAULT-ON;
// kill-switch `BORJIE_EGRESS_FILTER`. See `composition/egress-filter-wiring.ts`.
import { getEgressFilter } from '../composition/egress-filter-wiring.js';
// INPUT CONTAINMENT (CLOSE-G) — ingress prompt-injection / jailbreak guard on
// the free-text `instruction` BEFORE the VP orchestrate, mirroring brain.hono
// /turn. CRITICAL → refuse with single-language copy (the VP never sees it);
// lower severities → orchestrate on the detector-redacted text. DEFAULT-ON;
// fail-OPEN-but-logged.
import {
  applyIngressGuard,
  pickIngressGuardLang,
} from '../composition/ingress-guard-apply.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'brain-dispatch',
});

/** Fail-closed placeholder when the deep guard wrapper itself throws. */
const DISPATCH_EGRESS_FAIL_CLOSED = '[redacted]';

/**
 * Guard one text span (final guard, persists block rows). FAIL-CLOSED: the
 * filter returns a redacted placeholder on any internal fault, and this
 * wrapper try/catches so a construction fault also fails closed to
 * `[redacted]` rather than leaking the raw model text.
 */
function guardDispatchText(text: string, tenantId: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    return getEgressFilter().guardFinal(text, tenantId).text;
  } catch (err) {
    logger.error(
      {
        wiring: 'egress-filter',
        tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'brain-dispatch: egress guard threw — failing closed (redacting span)',
    );
    return DISPATCH_EGRESS_FAIL_CLOSED;
  }
}

/**
 * Recursively guard EVERY string value in an arbitrary JSON-shaped value,
 * preserving structure (objects/arrays rebuilt immutably with guarded leaves).
 * Used over the sub-MD result + plan payload so any LLM-derived free text
 * (proposal.summary / step.description / step.expectedImpact / artifact text /
 * rationale / summary) is filtered without risking a JSON-shape break — values
 * are guarded in place, keys are left untouched. Pure (immutability): returns a
 * NEW value, never mutates the input.
 */
function deepGuard<T>(value: T, tenantId: string): T {
  if (typeof value === 'string') {
    return guardDispatchText(value, tenantId) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepGuard(v, tenantId)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepGuard(v, tenantId);
    }
    return out as unknown as T;
  }
  // number / boolean / null / undefined — not a leak vector, pass through.
  return value;
}

// ── role gate ──────────────────────────────────────────────────────────────
// Tier-gate (task spec): owner / admin only. Mirrors org-admin.hono.ts and
// md-agentic.hono.ts — central-command dispatch is reserved for the owner and
// admin tiers; a tenant or staff role cannot fan out the VP cluster.
const DISPATCH_ROLES = new Set([
  'OWNER',
  'TENANT_ADMIN',
  'ADMIN',
  'SUPER_ADMIN',
]);

type Lang = 'en' | 'sw';

type AuthShape = { readonly tenantId: string; readonly userId: string; readonly role: string };

// ── request schema ─────────────────────────────────────────────────────────

const DispatchBodySchema = z.object({
  vp: z.enum(VP_REGISTRY_NAMES),
  instruction: z.string().min(1).max(4000),
  threadId: z.string().min(1).max(128).optional(),
  kind: z
    .enum([
      'status-check',
      'investigate',
      'remediate',
      'weekly-report-request',
      'wake-from-monitor',
    ])
    .default('remediate'),
  language: z.enum(['en', 'sw']).default('en'),
});

// ── bilingual copy (single-language per active locale; no mixing) ────────────

const COPY = {
  forbidden: {
    en: 'Central-command dispatch requires the owner or admin role.',
    sw: 'Uongozi mkuu unahitaji jukumu la mmiliki au msimamizi.',
  },
  unknownVp: {
    en: 'Unknown VP. Pick one of the registered department heads.',
    sw: 'Mkurugenzi huyu hajulikani. Chagua mmoja wa wakuu wa idara waliosajiliwa.',
  },
  orchestrateFailed: {
    en: 'The VP could not turn that instruction into a plan. Please rephrase and try again.',
    sw: 'Mkurugenzi ameshindwa kugeuza maelekezo hayo kuwa mpango. Tafadhali yaandike upya ujaribu tena.',
  },
  degraded: {
    en: 'Running in degraded mode: no AI key is configured, so each line-worker used its deterministic fallback. Nothing was fabricated.',
    sw: 'Inafanya kazi katika hali iliyopungua: hakuna ufunguo wa AI uliowekwa, hivyo kila mfanyakazi alitumia njia mbadala ya uhakika. Hakuna lililobuniwa.',
  },
} as const;

function pick(copy: { readonly en: string; readonly sw: string }, lang: Lang): string {
  return lang === 'sw' ? copy.sw : copy.en;
}

// ── error responders (c: any to sidestep Hono's status-literal widening, the
// same convention org-admin.hono.ts / md-agentic.hono.ts use) ────────────────

function forbidden(c: any) {
  // The gate runs before the body is validated, so fall back to EN here; the
  // per-request language toggle governs the post-validation copy.
  return c.json(
    { success: false, error: { code: 'FORBIDDEN', message: COPY.forbidden.en } },
    403,
  );
}

function badRequest(c: any, message: string) {
  return c.json(
    { success: false, error: { code: 'BAD_REQUEST', message } },
    400,
  );
}

// ── Anthropic-backed sub-MD LLM port ─────────────────────────────────────────
// Honest-degrade: when no key is set (or the call throws) the port returns
// empty text, so the redesign stage's deterministic fallback proposal takes
// over rather than fabricating output.

function buildSubMdLlmPort(): { readonly port: SubMdLlmPort; readonly degraded: boolean } {
  const client = createBrainLlmClient({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: BRAIN_LLM_MODELS.SONNET,
    logger,
  });
  const port: SubMdLlmPort = Object.freeze({
    async generate(args: {
      readonly system: string;
      readonly user: string;
      readonly maxTokens?: number;
    }): Promise<{ readonly text: string }> {
      if (!client) return { text: '' };
      try {
        const response = await client.sdk.messages.create({
          model: client.model,
          max_tokens: args.maxTokens ?? 800,
          temperature: 0.3,
          system: args.system,
          messages: [{ role: 'user', content: args.user }],
        });
        const text = Array.isArray(response.content)
          ? response.content
              .filter((b) => b.type === 'text' && typeof b.text === 'string')
              .map((b) => b.text as string)
              .join('')
          : '';
        return { text };
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'brain-dispatch: sub-MD LLM call failed — using deterministic fallback',
        );
        return { text: '' };
      }
    },
  });
  return { port, degraded: client === null };
}

// ── ScopeContext (brain auth) -> ScopeFilter (sub-MD bubble) ─────────────────

function toScopeFilter(scope: ScopeContext): ScopeFilter {
  // Only tenant-scoped dispatch reaches here (the gate enforces a tenant
  // principal); platform scope has no tenantId so it cannot run line-workers.
  if (scope.kind !== 'tenant') {
    throw new Error('dispatch_requires_tenant_scope');
  }
  return Object.freeze({ tenantId: scope.tenantId });
}

// ── sub-MD chain executor ────────────────────────────────────────────────────
// Runs each spawn's four-stage pipeline. Fail-soft per step: an unknown
// line-worker is `skipped`, a throwing sub-MD is `failed`, and the remaining
// spawns still run.

interface SubMdStepResult {
  readonly subMdId: string;
  readonly status: 'completed' | 'failed' | 'skipped' | 'insufficient_context';
  readonly description?: string;
  /**
   * Stable machine code accompanying a non-`completed` status. For
   * `insufficient_context` it is always `INSUFFICIENT_CONTEXT` — the
   * observe() stage yielded ZERO in-scope events, so the redesign LLM is
   * NOT called and no proposal is fabricated from an empty graph.
   */
  readonly code?: string;
  readonly proposal?: {
    readonly summary: string;
    readonly steps: ReadonlyArray<{
      readonly id: string;
      readonly description: string;
      readonly expectedImpact: string;
    }>;
    readonly predicted: {
      readonly metric: string;
      readonly value: number;
      readonly unit: string;
    };
  };
  readonly artifact?: {
    readonly skillName: string;
    readonly cronExpression?: string;
    readonly draftStatus: 'draft' | 'review-requested';
  };
  readonly error?: string;
}

async function runSubMdChain(args: {
  readonly plan: VpOrchestrationPlan;
  readonly scope: ScopeContext;
  readonly llm: SubMdLlmPort;
  readonly correlationId: string;
}): Promise<ReadonlyArray<SubMdStepResult>> {
  const { plan, scope, llm, correlationId } = args;
  const scopeFilter = toScopeFilter(scope);
  const results: SubMdStepResult[] = [];

  for (const spawn of plan.spawns) {
    const factory = getSubMdFactory(spawn.subMdId);
    if (!factory) {
      results.push(
        Object.freeze({
          subMdId: spawn.subMdId,
          status: 'skipped',
          ...(spawn.description ? { description: spawn.description } : {}),
          error: `unknown_sub_md:${spawn.subMdId}`,
        }),
      );
      continue;
    }
    try {
      const subMd = factory({ scope: scopeFilter });
      const initialCorrelation = spawn.initialInput?.['correlationId'];
      const ctx: SubMdContext = Object.freeze({
        scope: scopeFilter,
        nowMs: Date.now(),
        correlationId:
          typeof initialCorrelation === 'string'
            ? initialCorrelation
            : correlationId,
        budget: DEFAULT_SUB_MD_BUDGET,
        llm,
      });

      // Four-stage pipeline: observe → map → redesign → automate.
      const events: ObservedEvent[] = [];
      for await (const evt of subMd.observe(ctx)) events.push(evt);

      // Hard guard against fabrication from nothing. If observe() yielded ZERO
      // in-scope events (e.g. no event-bus port wired for this sub-MD bubble),
      // the graph is empty and any proposal the redesign LLM emits would be a
      // hallucination with no grounding. Surface a structured
      // `insufficient_context` result and SKIP the redesign/automate LLM call
      // for this sub-MD — never invent proposals from an empty graph.
      if (events.length === 0) {
        logger.info(
          { subMdId: spawn.subMdId, correlationId: ctx.correlationId },
          'brain-dispatch: sub-MD observe() yielded zero events — skipping fabrication',
        );
        results.push(
          Object.freeze({
            subMdId: spawn.subMdId,
            status: 'insufficient_context',
            code: 'INSUFFICIENT_CONTEXT',
            ...(spawn.description ? { description: spawn.description } : {}),
          }),
        );
        continue;
      }

      const graph = await subMd.map(Object.freeze(events), ctx);
      const proposal = await subMd.redesign(graph, ctx);
      const artifact = await subMd.automate(proposal, ctx);

      results.push(
        Object.freeze({
          subMdId: spawn.subMdId,
          status: 'completed',
          ...(spawn.description ? { description: spawn.description } : {}),
          proposal: Object.freeze({
            summary: proposal.summary,
            steps: proposal.steps,
            predicted: proposal.predicted,
          }),
          artifact: Object.freeze({
            skillName: artifact.skillName,
            ...(artifact.cronExpression
              ? { cronExpression: artifact.cronExpression }
              : {}),
            draftStatus: artifact.draftStatus,
          }),
        }),
      );
    } catch (err) {
      // Log the raw cause server-side (pino) only. The per-step `error` field is
      // returned to the client (deep-guarded, but the egress filter strips
      // IP-classes, not generic operational error text), so we surface a STABLE
      // machine code instead of the raw `err.message` — no DB/driver/internal
      // detail leaks while the client still gets a renderable failed signal.
      logger.error(
        {
          subMdId: spawn.subMdId,
          err: err instanceof Error ? err.message : String(err),
        },
        'brain-dispatch: sub-MD pipeline failed (fail-soft)',
      );
      results.push(
        Object.freeze({
          subMdId: spawn.subMdId,
          status: 'failed',
          ...(spawn.description ? { description: spawn.description } : {}),
          error: 'sub_md_pipeline_failed',
        }),
      );
    }
  }

  return Object.freeze(results);
}

// ── route ────────────────────────────────────────────────────────────────────

const app = new Hono();
app.use('*', authMiddleware);

// Owner/admin role gate on every endpoint in this router (defense in depth on
// top of authMiddleware). Mirrors md-agentic.hono.ts / org-admin.hono.ts.
app.use('*', async (c, next) => {
  const auth = c.get('auth') as { role?: string } | undefined;
  if (!auth || !DISPATCH_ROLES.has(String(auth.role))) return forbidden(c);
  await next();
});

app.post(
  '/dispatch',
  zValidator('json', DispatchBodySchema),
  withSecurityEvents(
    { action: 'brain.dispatch', resource: 'vp_dispatch', severity: 'info' },
    async (c: any) => {
      const auth = c.get('auth') as AuthShape;
      const body = c.req.valid('json');
      const { vp, instruction, threadId, kind, language } = body;
      const lang: Lang = language === 'sw' ? 'sw' : 'en';

      // Defensive: schema already constrains `vp`, but keep the registry as
      // the single source of truth.
      if (!isVpName(vp)) {
        return badRequest(c, pick(COPY.unknownVp, lang));
      }

      // INPUT CONTAINMENT (CLOSE-G) — run the blessed ingress guard on the
      // free-text instruction BEFORE the VP turns it into a plan. CRITICAL
      // prompt-injection / jailbreak → refuse with single-language copy (the VP
      // never sees it); lower severities → orchestrate on the detector-redacted
      // text. Fail-OPEN-but-logged inside the guard.
      const ingress = await applyIngressGuard({
        userText: instruction,
        tenantId: auth.tenantId,
        userId: auth.userId ?? null,
        lang: pickIngressGuardLang(c.req.header('accept-language') ?? lang),
      });
      if (ingress.refused) {
        return c.json(
          {
            success: false,
            error: { code: 'INPUT_GUARD_REFUSED', message: ingress.refusalMessage },
          },
          403,
        );
      }
      const guardedInstruction = ingress.text;

      const correlationId = threadId ?? `dispatch-${Date.now()}`;
      const scope: ScopeContext = Object.freeze({
        kind: 'tenant',
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        roles: [auth.role],
        personaId: 'manager-chat',
      });

      // 1) Build the VP + orchestrate the instruction into a plan.
      let plan: VpOrchestrationPlan;
      try {
        const head = createVpByName(vp as VpName, {
          lineWorkerCatalogue: createRegistryLineWorkerCatalogue(),
        });
        const intent: OwnerIntent = {
          kind: kind as OwnerIntentKind,
          // CLOSE-G — the VP orchestrates on the ingress-guarded instruction
          // (offending spans redacted on a lower-severity hit).
          text: guardedInstruction,
          scope,
          correlationId,
        };
        plan = await head.orchestrate(intent);
      } catch (err) {
        logger.error(
          { vp, err: err instanceof Error ? err.message : String(err) },
          'brain-dispatch: VP orchestrate failed',
        );
        return c.json(
          {
            success: false,
            error: { code: 'ORCHESTRATE_FAILED', message: pick(COPY.orchestrateFailed, lang) },
          },
          500,
        );
      }

      // 2) Run the sub-MD chain (fail-soft per step).
      const { port: llm, degraded } = buildSubMdLlmPort();
      let subMdResults: ReadonlyArray<SubMdStepResult> = Object.freeze([]);
      try {
        subMdResults = await runSubMdChain({
          plan,
          scope,
          llm,
          correlationId,
        });
      } catch (err) {
        return routeCatch(c, err, {
          code: 'DISPATCH_SUBMD_CHAIN_FAILED',
          status: 500,
          fallback: 'Failed to run the line-worker chain',
        });
      }

      const completed = subMdResults.filter((r) => r.status === 'completed').length;
      const skipped = subMdResults.filter((r) => r.status === 'skipped').length;
      const failed = subMdResults.filter((r) => r.status === 'failed').length;
      const insufficientContext = subMdResults.filter(
        (r) => r.status === 'insufficient_context',
      ).length;

      // SEC-4 — recursively guard the LLM-derived free text before it egresses.
      // The VP rationale/summary/gaps and the sub-MD chain results
      // (proposal.summary / step.description / step.expectedImpact / artifact)
      // are all model-generated, so they pass the FAIL-CLOSED filter. Static
      // copy (vp, ids, counts, registry constants, bilingual notices) is left
      // unguarded — it is deterministic and never carries cognition/secrets.
      const guardedSubMdResults = deepGuard(subMdResults, auth.tenantId);
      const guardedRationale = guardDispatchText(plan.rationale, auth.tenantId);
      const guardedGaps = deepGuard(plan.gaps, auth.tenantId);
      const guardedSummary =
        plan.summary !== undefined
          ? guardDispatchText(plan.summary, auth.tenantId)
          : undefined;

      return c.json(
        {
          success: true,
          data: {
            vp,
            correlationId,
            plan: {
              vpName: plan.vpName,
              intentKind: plan.intentKind,
              rationale: guardedRationale,
              spawnCount: plan.spawns.length,
              ...(guardedSummary !== undefined ? { summary: guardedSummary } : {}),
            },
            gaps: guardedGaps,
            subMdResults: guardedSubMdResults,
            summary: {
              spawns: plan.spawns.length,
              completed,
              skipped,
              failed,
              insufficientContext,
              gaps: plan.gaps.length,
            },
            knownVps: VP_REGISTRY_NAMES,
            ...(degraded ? { degradedNotice: pick(COPY.degraded, lang) } : {}),
          },
        },
        200,
      );
    },
  ),
);

export const brainDispatchRouter = app;
export default brainDispatchRouter;
