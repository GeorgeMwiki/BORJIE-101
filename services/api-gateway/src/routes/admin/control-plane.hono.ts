/**
 * /api/v1/admin/control-plane — the Borjie-internal CONTROL PLANE over the
 * brain (admin-web port 3020). Four admin-set knobs, all PLATFORM-config (NOT
 * tenant business data):
 *
 *   1. POWERS         — capability / kill-switch flags, global + per-tenant
 *                       (the FLAG_ACTIVATION_PLAN flags). Backed by
 *                       platform_feature_flags.
 *   2. LLM ROUTING    — core model + ordered failover chain + ensemble
 *                       {members, combineStrategy, judgeModel?} + perUseCase.
 *                       Backed by platform_llm_routing_config (migration 0320).
 *   3. MODEL CATALOG  — the catalog with cost / capability / latency metadata
 *                       the admin chooses from (read-only).
 *   4. AI-SUGGEST     — a suggest-only recommender (HITL): proposes the optimal
 *                       model per use-case from the catalog. NEVER writes config.
 *
 * Routes (all under /api/v1/admin/control-plane):
 *   GET  /powers                 read power flags (global + per-tenant)
 *   PUT  /powers                 set a power flag (global or tenant scope)   [AUDITED]
 *   GET  /llm-routing            read routing config (global or ?scope=tenant:<id>)
 *   PUT  /llm-routing            set routing config (core + fallbacks +
 *                                ensemble + perUseCase)                       [AUDITED]
 *   GET  /model-catalog          read the model catalog (cost/capability/latency)
 *   POST /ai-suggest             run the recommender (returns suggestions only)
 *
 * AUTH: Supabase JWT + requireRole(SUPER_ADMIN | ADMIN). This is the Borjie
 * internal admin console — NOT a tenant JWT path. SUPPORT is excluded (these
 * levers steer which model answers platform-wide; read+write is admin-grade).
 *
 * HARD RULES honoured (by construction):
 *   - NO TENANT BUSINESS DATA. Every store here is platform-metadata; the
 *     `tenant:<id>` scope is a STRING KEY naming which tenant an override
 *     applies to, never a row read through a tenant JWT path.
 *   - The LLM-routing config changes WHICH model answers, never WHETHER a
 *     sovereign action (money / licence / deletion) executes — those rails
 *     live in the policy-gate + kill-switch and are untouched here. A power
 *     flag write that targets a sovereign `killswitch_*` rail is REJECTED.
 *   - Locked / sovereign use-cases (offtake_drafting, licence_suspension_notice,
 *     financial_advice, legal_review, voice_transcribe, image_generation) cannot
 *     be reassigned via perUseCase — the route drops them before persisting and
 *     the recommender disqualifies below-floor candidates by construction.
 *   - Every MUTATION emits a hash-chained SecurityEvent (withSecurityEvents)
 *     AND records an undo_journal row capturing before/after (the break-glass /
 *     egress audit pattern).
 *   - ENSEMBLE is COST-AWARE: N members == N x cost. The route attaches an
 *     estimated multiplier + per-member blended price so the admin sees the
 *     cost before applying; the live consumption seam (run-ensemble.ts) is the
 *     one that fails safe to a single model when the budget governor constrains.
 *   - Router consumption is FAIL-SAFE: a bad/empty config never breaks a turn
 *     (the resolver falls back to TASK_LADDER) — this route only persists valid
 *     config (zod + validateRoutingConfig) so a malformed row never lands.
 *   - No console.* (Pino logger only). Immutability. Zod on every input.
 */

import { Hono } from 'hono';
import { z } from 'zod';

import {
  createPlatformFeatureFlagsService,
  createPlatformLlmRoutingConfigService,
  undoJournal,
} from '@borjie/database';

// Derive the service + document shapes from the factory signatures. The named
// type exports (`PlatformFeatureFlagsService` etc.) resolve to a namespace in
// the consuming compiler under this project's module setup, so we structurally
// recover the same types from the factories instead of importing the names.
type PlatformFeatureFlagsService = ReturnType<typeof createPlatformFeatureFlagsService>;
type PlatformLlmRoutingConfigService = ReturnType<
  typeof createPlatformLlmRoutingConfigService
>;

/**
 * The routing-config document persisted to `platform_llm_routing_config`. The
 * DB adapter stores it as an opaque JSON document (the brain-llm-router's
 * `validateRoutingConfig` is the authoritative gate); this mirrors that loose
 * shape so the route never blocks a new field.
 */
type EnsembleDocument = {
  readonly enabled: boolean;
  readonly members: readonly string[];
  readonly combineStrategy:
    | 'first-wins'
    | 'majority-vote'
    | 'judge-synthesis'
    | 'debate';
  readonly judgeModel?: string;
};
type PlatformRoutingConfigDocument = {
  readonly coreModel?: string;
  readonly orderedFallbacks?: readonly string[];
  readonly ensemble?: EnsembleDocument;
  readonly perUseCase?: Readonly<Record<string, string>>;
};
import {
  validateRoutingConfig,
  validateEnsemble,
  ALL_COMBINE_STRATEGIES,
  MODEL_PRICING,
  getPricing,
  LOCKED_CATEGORIES,
  suggestModelRouting,
  type SuggestArgs,
} from '@borjie/brain-llm-router';
import { withSecurityEvents } from '@borjie/observability';

import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { UserRole } from '../../types/user-role';
// LANE B5 — invalidate the live routing-config cache after a successful write
// so an admin change converges on the NEXT brain turn (not just after the TTL).
// No-op-safe when the boot warmer was not wired in this deployment.
import { invalidateIfInitialised } from '../../composition/llm-routing-config-wiring';

const moduleLogger = createLogger('admin-control-plane');

// ─── Model catalog (cost / capability / latency metadata) ───────────────────

/**
 * The admin-facing model catalog. `family` mirrors the brain-llm-router
 * ModelFamily taxonomy (used by the recommender's capability floor); `model`
 * is the canonical id keyed into MODEL_PRICING. This is the SET of models the
 * admin may assign — it is intentionally route-local (a curated catalog), and
 * each entry's cost is read live from MODEL_PRICING so prices stay single-
 * sourced.
 *
 * Heuristic p50 latency is a starting metadata value; the recommender prefers
 * observed metrics (injected on /ai-suggest) when present.
 */
interface CatalogEntry {
  readonly model: string;
  readonly family: SuggestArgs['catalog'][number]['family'];
  readonly label: string;
  readonly provider: 'anthropic' | 'openai' | 'google' | 'self-hosted';
  /** Heuristic p50 latency in ms (fallback when no observed metric exists). */
  readonly heuristicLatencyMs: number;
}

const MODEL_CATALOG: ReadonlyArray<CatalogEntry> = Object.freeze([
  { model: 'claude-opus-4-8', family: 'opus', label: 'Claude Opus 4.8', provider: 'anthropic', heuristicLatencyMs: 3200 },
  { model: 'claude-sonnet-4-6', family: 'sonnet', label: 'Claude Sonnet 4.6', provider: 'anthropic', heuristicLatencyMs: 1500 },
  { model: 'claude-haiku-4-5', family: 'haiku', label: 'Claude Haiku 4.5', provider: 'anthropic', heuristicLatencyMs: 700 },
  { model: 'gpt-5', family: 'gpt-5', label: 'GPT-5', provider: 'openai', heuristicLatencyMs: 1500 },
  { model: 'gpt-5-mini', family: 'gpt-5-mini', label: 'GPT-5 mini', provider: 'openai', heuristicLatencyMs: 700 },
  { model: 'gemini-3-1-pro', family: 'gemini-pro', label: 'Gemini 3.1 Pro', provider: 'google', heuristicLatencyMs: 1500 },
]);

const CATALOG_MODEL_IDS: ReadonlySet<string> = new Set(MODEL_CATALOG.map((c) => c.model));

/** Blended cost (USD per 1M tokens, input+output averaged) for a catalog model. */
function blendedCostPerMillion(model: string): number {
  const p = getPricing(model);
  return Number(((p.inputPerMillion + p.outputPerMillion) / 2).toFixed(4));
}

/** Capability rank by family — mirrors the recommender's FAMILY_RANK ordering. */
const FAMILY_CAPABILITY_RANK: Readonly<Record<string, number>> = Object.freeze({
  haiku: 1,
  'gpt-5-mini': 1,
  'gemini-flash': 1,
  'deepseek-chat': 1,
  sonnet: 3,
  'gpt-5': 3,
  'gemini-pro': 3,
  'deepseek-coder': 3,
  opus: 5,
});

function catalogView(): ReadonlyArray<Record<string, unknown>> {
  return MODEL_CATALOG.map((c) => ({
    model: c.model,
    family: c.family,
    label: c.label,
    provider: c.provider,
    capabilityRank: FAMILY_CAPABILITY_RANK[c.family] ?? 0,
    costPerMillionUsd: blendedCostPerMillion(c.model),
    p50LatencyMs: c.heuristicLatencyMs,
  }));
}

// ─── Use-case catalog (assignable surfaces / intents) ───────────────────────

/**
 * The use-cases the admin may route per-use-case. Locked / sovereign use-cases
 * are EXCLUDED from the assignable set and dropped from any perUseCase write —
 * they stay pinned to their policy floor. The recommender still scores them
 * (for transparency) but disqualifies below-floor candidates by construction.
 */
const ASSIGNABLE_USE_CASES: ReadonlyArray<string> = Object.freeze([
  'tenant_screening',
  'royalty_calculation',
  'compliance_check',
  'contract_extraction',
  'inspection_report',
  'maintenance_triage',
  'document_summary',
  'casual_chat',
  'translation',
]);

// ─── Zod schemas (every input validated) ────────────────────────────────────

const scopeSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => s === 'global' || /^tenant:[A-Za-z0-9_-]{1,128}$/.test(s), {
    message: "scope must be 'global' or 'tenant:<id>'",
  });

const flagNameSchema = z
  .string()
  .min(2)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*$/, 'flag must be snake_case');

const setPowerFlagSchema = z.object({
  flag: flagNameSchema,
  enabled: z.boolean(),
  scope: scopeSchema.default('global'),
  reason: z.string().min(8).max(2000),
});

const modelIdSchema = z.string().min(1).max(200);

const ensembleSchema = z.object({
  enabled: z.boolean(),
  members: z.array(modelIdSchema).min(1).max(8),
  combineStrategy: z.enum(
    ALL_COMBINE_STRATEGIES as unknown as [string, ...string[]],
  ),
  judgeModel: modelIdSchema.optional(),
});

const setRoutingSchema = z.object({
  scope: scopeSchema.default('global'),
  reason: z.string().min(8).max(2000),
  coreModel: modelIdSchema,
  orderedFallbacks: z.array(modelIdSchema).max(8).default([]),
  ensemble: ensembleSchema.optional(),
  perUseCase: z.record(z.string().min(1).max(120), modelIdSchema).optional(),
});

const aiSuggestSchema = z.object({
  useCases: z.array(z.string().min(1).max(120)).min(1).max(50).optional(),
  weights: z
    .object({
      cost: z.number().min(0).max(1).optional(),
      capability: z.number().min(0).max(1).optional(),
      latency: z.number().min(0).max(1).optional(),
    })
    .optional(),
  /** Optional observed p50 latency per model id (from ai_cost_entries rollup). */
  metrics: z
    .record(z.string().min(1).max(200), z.object({ p50LatencyMs: z.number().min(0).max(600_000) }))
    .optional(),
});

// ─── Sovereign-rail guard for power flags ────────────────────────────────────

/**
 * Flag-name prefixes that NAME a sovereign / HITL rail. The control plane can
 * never flip these — they guard money / licence / deletion / kill-switch and
 * stay operator-only (the kill-switch route + policy-gate own them). A write
 * targeting any of these is rejected with 403.
 */
const SOVEREIGN_FLAG_PREFIXES: ReadonlyArray<string> = Object.freeze([
  'killswitch_',
  'kill_switch',
  'sovereign',
  'four_eye',
  'policy_rollout',
  'pilot_kill_switch',
]);

function isSovereignFlag(flag: string): boolean {
  const f = flag.toLowerCase();
  return SOVEREIGN_FLAG_PREFIXES.some((p) => f.startsWith(p));
}

// ─── Service resolution (duck-typed; prefers c.get('services')) ──────────────

function resolveFeatureFlags(c: any, actorId: string): PlatformFeatureFlagsService {
  const bag = (c.get('services') ?? {}) as Record<string, unknown>;
  return (
    (bag.platformFeatureFlags as PlatformFeatureFlagsService | undefined) ??
    (bag.platformFeatureFlagsWrite as PlatformFeatureFlagsService | undefined) ??
    createPlatformFeatureFlagsService(c.get('db'), { resolveActor: () => actorId })
  );
}

function resolveRoutingConfig(
  c: any,
  actorId: string,
): PlatformLlmRoutingConfigService {
  const bag = (c.get('services') ?? {}) as Record<string, unknown>;
  return (
    (bag.platformLlmRoutingConfig as PlatformLlmRoutingConfigService | undefined) ??
    createPlatformLlmRoutingConfigService(c.get('db'), { resolveActor: () => actorId })
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dbUnavailable(c: any) {
  return c.json(
    {
      success: false,
      error: { code: 'CONTROL_PLANE_DB_UNAVAILABLE', message: 'Database not configured' },
    },
    503,
  );
}

function validationError(c: any, message: string, issues: unknown) {
  return c.json(
    { success: false, error: { code: 'VALIDATION_ERROR', message, issues } },
    400,
  );
}

/**
 * Write an undo_journal audit row for a control-plane mutation. Captures the
 * before/after state so the change is reversible + forensically inspectable.
 * Never throws into the caller — an audit-write failure is logged but the
 * security-event sink (withSecurityEvents) is the authoritative chain.
 */
async function recordAudit(
  c: any,
  args: {
    readonly actorId: string;
    readonly tenantId: string;
    readonly role: string;
    readonly entityType: string;
    readonly entityId: string;
    readonly actionKind: string;
    readonly before: unknown;
    readonly after: unknown;
    readonly reason: string;
    readonly extra?: Record<string, unknown>;
  },
): Promise<string | null> {
  const db = c.get('db');
  try {
    const [row] = await db
      .insert(undoJournal)
      .values({
        tenantId: args.tenantId,
        actorId: args.actorId,
        entityType: args.entityType,
        entityId: args.entityId,
        actionKind: args.actionKind,
        toolId: 'admin.ui.control_plane',
        beforeState: args.before ?? null,
        afterState: args.after ?? null,
        windowSeconds: 300,
        provenance: {
          surface: 'admin-web:control-plane',
          adminRole: args.role,
          reason: args.reason,
          status: 'applied',
          ...(args.extra ?? {}),
        },
      })
      .returning();
    return (row?.id as string | undefined) ?? null;
  } catch (err) {
    moduleLogger.error('control-plane: audit-journal write failed', {
      actionKind: args.actionKind,
      entityId: args.entityId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Estimate the cost multiplier + per-member blended price of an ensemble. */
function ensembleCostProjection(members: readonly string[]): Record<string, unknown> {
  const perMember = members.map((m) => ({
    model: m,
    costPerMillionUsd: blendedCostPerMillion(m),
    inCatalog: CATALOG_MODEL_IDS.has(m),
  }));
  const totalPerMillion = Number(
    perMember.reduce((sum, x) => sum + x.costPerMillionUsd, 0).toFixed(4),
  );
  return {
    memberCount: members.length,
    costMultiplier: members.length,
    blendedCostPerMillionUsd: totalPerMillion,
    perMember,
    note:
      members.length > 1
        ? 'Ensemble runs N models in parallel: N x cost. The live run-ensemble seam fails safe to a single model when the budget governor is constrained.'
        : 'Single member: no ensemble cost multiplier.',
  };
}

// ─── App ─────────────────────────────────────────────────────────────────────

const app = new Hono();
app.use('*', authMiddleware);
// Borjie-internal admin only — NOT a tenant JWT path. SUPPORT excluded.
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

// ─── 1. POWERS ───────────────────────────────────────────────────────────────

// GET /powers?flags=a,b,c — read power flags (global value + per-tenant overrides).
app.get('/powers', async (c: any) => {
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const auth = c.get('auth') as { userId: string };

  const raw = c.req.query('flags');
  const flags = typeof raw === 'string' && raw.trim().length > 0
    ? raw.split(',').map((f: string) => f.trim()).filter(Boolean).slice(0, 100)
    : [];

  const service = resolveFeatureFlags(c, auth.userId);
  const powers = await Promise.all(
    flags.map(async (flag: string) => {
      try {
        const read = await service.read(flag);
        return {
          flag,
          globalValue: read.globalValue,
          tenantOverrides: read.tenantOverrides,
          sovereign: isSovereignFlag(flag),
        };
      } catch (err) {
        moduleLogger.warn('control-plane: power-flag read failed', {
          flag,
          error: err instanceof Error ? err.message : String(err),
        });
        return { flag, globalValue: null, tenantOverrides: [], sovereign: isSovereignFlag(flag), readError: true };
      }
    }),
  );

  return c.json({ success: true, data: { powers } });
});

// PUT /powers — set a power flag (global or tenant scope). AUDITED. Rejects
// sovereign rails.
app.put(
  '/powers',
  withSecurityEvents(
    {
      action: 'platform.control_plane.set_power_flag',
      resource: 'platform.control_plane.powers',
      severity: 'critical',
    },
    async (c: any) => {
      const db = c.get('db');
      if (!db) return dbUnavailable(c);
      const auth = c.get('auth') as { tenantId: string; userId: string; role: string };

      const body = await c.req.json().catch(() => null);
      const parsed = setPowerFlagSchema.safeParse(body);
      if (!parsed.success) {
        return validationError(c, 'Invalid power-flag payload', parsed.error.issues);
      }
      const input = parsed.data;

      // SOVEREIGN GUARD: the control plane never flips a sovereign / HITL rail.
      if (isSovereignFlag(input.flag)) {
        moduleLogger.warn('control-plane: rejected sovereign flag write', {
          flag: input.flag,
          adminId: auth.userId,
        });
        return c.json(
          {
            success: false,
            error: {
              code: 'SOVEREIGN_FLAG_FORBIDDEN',
              message:
                'This flag guards a sovereign / kill-switch rail and cannot be set from the control plane.',
              flag: input.flag,
            },
          },
          403,
        );
      }

      const service = resolveFeatureFlags(c, auth.userId);

      // Capture the before-value for the audit + rollback contract.
      let previousValue: unknown = null;
      try {
        const read = await service.read(input.flag);
        previousValue =
          input.scope === 'global'
            ? read.globalValue
            : read.tenantOverrides.find(
                (o) => `tenant:${o.tenantId}` === input.scope,
              )?.value ?? null;
      } catch {
        previousValue = null;
      }

      try {
        await service.setFlag({
          flagName: input.flag,
          value: input.enabled,
          scope: input.scope as 'global' | `tenant:${string}`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        moduleLogger.error('control-plane: power-flag write failed', {
          flag: input.flag,
          scope: input.scope,
          error: message,
        });
        return c.json(
          { success: false, error: { code: 'POWER_FLAG_WRITE_FAILED', message } },
          500,
        );
      }

      const journalId = await recordAudit(c, {
        actorId: auth.userId,
        tenantId: auth.tenantId,
        role: auth.role,
        entityType: 'platform_power_flag',
        entityId: `${input.scope}:${input.flag}`,
        actionKind: 'control_plane_set_power_flag',
        before: { value: previousValue },
        after: { value: input.enabled },
        reason: input.reason,
        extra: { flag: input.flag, scope: input.scope },
      });

      moduleLogger.info('control-plane: power flag set', {
        adminId: auth.userId,
        flag: input.flag,
        scope: input.scope,
        enabled: input.enabled,
        journalId,
      });

      return c.json({
        success: true,
        data: {
          flag: input.flag,
          scope: input.scope,
          enabled: input.enabled,
          previousValue,
          journalId,
        },
      });
    },
  ),
);

// ─── 2. LLM ROUTING ──────────────────────────────────────────────────────────

// GET /llm-routing?scope=global|tenant:<id> — read the routing config.
app.get('/llm-routing', async (c: any) => {
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const auth = c.get('auth') as { userId: string };

  const scopeRaw = c.req.query('scope') ?? 'global';
  const scopeParse = scopeSchema.safeParse(scopeRaw);
  if (!scopeParse.success) {
    return validationError(c, 'Invalid scope query', scopeParse.error.issues);
  }

  const service = resolveRoutingConfig(c, auth.userId);
  const result = await service.read(scopeParse.data as 'global' | `tenant:${string}`);

  return c.json({
    success: true,
    data: {
      scope: result.scope,
      config: result.config,
      lastSetAt: result.lastSetAt,
      combineStrategies: ALL_COMBINE_STRATEGIES,
    },
  });
});

// PUT /llm-routing — set the routing config (core + ordered fallbacks +
// ensemble + perUseCase). AUDITED. Validated by zod AND the router's
// validateRoutingConfig (fail-safe defence-in-depth). Locked use-cases dropped.
app.put(
  '/llm-routing',
  withSecurityEvents(
    {
      action: 'platform.control_plane.set_llm_routing',
      resource: 'platform.control_plane.llm_routing',
      severity: 'critical',
    },
    async (c: any) => {
      const db = c.get('db');
      if (!db) return dbUnavailable(c);
      const auth = c.get('auth') as { tenantId: string; userId: string; role: string };

      const body = await c.req.json().catch(() => null);
      const parsed = setRoutingSchema.safeParse(body);
      if (!parsed.success) {
        return validationError(c, 'Invalid llm-routing payload', parsed.error.issues);
      }
      const input = parsed.data;

      // Drop locked / sovereign use-cases — they stay pinned to their policy
      // floor and can never be reassigned from the control plane.
      const droppedUseCases: string[] = [];
      const perUseCase: Record<string, string> = {};
      if (input.perUseCase) {
        for (const [useCase, model] of Object.entries(input.perUseCase)) {
          if (LOCKED_CATEGORIES.has(useCase)) {
            droppedUseCases.push(useCase);
            continue;
          }
          perUseCase[useCase] = model;
        }
      }

      // Optional ensemble — validate via the router's authoritative validator.
      let ensembleDoc: PlatformRoutingConfigDocument['ensemble'];
      if (input.ensemble) {
        const ensRes = validateEnsemble(input.ensemble);
        if (!ensRes.success) {
          return validationError(c, 'Invalid ensemble config', ensRes.issues);
        }
        ensembleDoc = {
          enabled: input.ensemble.enabled,
          members: input.ensemble.members,
          combineStrategy: input.ensemble.combineStrategy as NonNullable<
            PlatformRoutingConfigDocument['ensemble']
          >['combineStrategy'],
          ...(input.ensemble.judgeModel ? { judgeModel: input.ensemble.judgeModel } : {}),
        };
      }

      const document: PlatformRoutingConfigDocument = {
        coreModel: input.coreModel,
        orderedFallbacks: input.orderedFallbacks,
        ...(ensembleDoc ? { ensemble: ensembleDoc } : {}),
        ...(Object.keys(perUseCase).length > 0 ? { perUseCase } : {}),
      };

      // AUTHORITATIVE GATE: the router's validateRoutingConfig is the same
      // duck-type the hot path applies. A config that fails here would be
      // treated as ABSENT by the resolver — so we refuse to persist it.
      const routingRes = validateRoutingConfig(document);
      if (!routingRes.success) {
        return validationError(c, 'Routing config failed router validation', routingRes.issues);
      }

      const service = resolveRoutingConfig(c, auth.userId);
      let setResult: Awaited<ReturnType<PlatformLlmRoutingConfigService['setRouting']>>;
      try {
        setResult = await service.setRouting({
          scope: input.scope as 'global' | `tenant:${string}`,
          config: document,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        moduleLogger.error('control-plane: llm-routing write failed', {
          scope: input.scope,
          error: message,
        });
        return c.json(
          { success: false, error: { code: 'LLM_ROUTING_WRITE_FAILED', message } },
          500,
        );
      }

      // LANE B5 — converge the live brain routing on the NEXT turn. Drop the
      // warmer cache so the new core/fallback/ensemble config is re-read from
      // the DB immediately instead of waiting out the TTL. No-op-safe when the
      // boot warmer was not wired (the resolver then stays on the static
      // ladder, which is the correct fail-safe).
      const routingCacheInvalidated = invalidateIfInitialised();

      const ensembleCost = ensembleDoc?.enabled
        ? ensembleCostProjection(ensembleDoc.members)
        : null;

      const journalId = await recordAudit(c, {
        actorId: auth.userId,
        tenantId: auth.tenantId,
        role: auth.role,
        entityType: 'platform_llm_routing_config',
        entityId: input.scope,
        actionKind: 'control_plane_set_llm_routing',
        before: setResult.previousConfig,
        after: setResult.config,
        reason: input.reason,
        extra: {
          scope: input.scope,
          ...(droppedUseCases.length > 0 ? { droppedLockedUseCases: droppedUseCases } : {}),
          ...(ensembleCost ? { ensembleCost } : {}),
        },
      });

      moduleLogger.info('control-plane: llm-routing set', {
        adminId: auth.userId,
        scope: input.scope,
        coreModel: input.coreModel,
        ensembleEnabled: Boolean(ensembleDoc?.enabled),
        routingCacheInvalidated,
        journalId,
      });

      return c.json({
        success: true,
        data: {
          scope: setResult.scope,
          config: setResult.config,
          updatedAt: setResult.updatedAt,
          journalId,
          ...(droppedUseCases.length > 0 ? { droppedLockedUseCases: droppedUseCases } : {}),
          ...(ensembleCost ? { ensembleCost } : {}),
        },
      });
    },
  ),
);

// ─── 3. MODEL CATALOG ────────────────────────────────────────────────────────

// GET /model-catalog — the catalog (cost / capability / latency) + the
// assignable + locked use-case sets so the admin UI hydrates real metadata.
app.get('/model-catalog', async (c: any) => {
  return c.json({
    success: true,
    data: {
      models: catalogView(),
      combineStrategies: ALL_COMBINE_STRATEGIES,
      assignableUseCases: ASSIGNABLE_USE_CASES,
      lockedUseCases: Array.from(LOCKED_CATEGORIES),
      pricingModels: Object.keys(MODEL_PRICING),
    },
  });
});

// ─── 4. AI-SUGGEST (HITL — suggest-only, never writes) ───────────────────────

// POST /ai-suggest — run the recommender. Returns ranked per-use-case
// suggestions for the admin to review + apply via PUT /llm-routing. NEVER
// writes config.
app.post('/ai-suggest', async (c: any) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = aiSuggestSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return validationError(c, 'Invalid ai-suggest payload', parsed.error.issues);
  }
  const input = parsed.data;

  const useCases =
    input.useCases && input.useCases.length > 0
      ? input.useCases
      : ASSIGNABLE_USE_CASES;

  const catalog: SuggestArgs['catalog'] = MODEL_CATALOG.map((entry) => ({
    model: entry.model,
    family: entry.family,
  }));

  // Build optional sub-objects without `undefined` members so the strict
  // `exactOptionalPropertyTypes` boundary on SuggestArgs is satisfied.
  const weights = input.weights
    ? {
        ...(input.weights.cost !== undefined ? { cost: input.weights.cost } : {}),
        ...(input.weights.capability !== undefined
          ? { capability: input.weights.capability }
          : {}),
        ...(input.weights.latency !== undefined
          ? { latency: input.weights.latency }
          : {}),
      }
    : undefined;

  const suggestArgs: SuggestArgs = {
    useCases,
    catalog,
    ...(weights && Object.keys(weights).length > 0 ? { weights } : {}),
    ...(input.metrics ? { metrics: input.metrics } : {}),
  };

  let result;
  try {
    result = suggestModelRouting(suggestArgs);
  } catch (err) {
    moduleLogger.error('control-plane: ai-suggest failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return c.json(
      { success: false, error: { code: 'AI_SUGGEST_FAILED', message: 'Recommender failed' } },
      500,
    );
  }

  moduleLogger.info('control-plane: ai-suggest produced suggestions', {
    useCaseCount: useCases.length,
  });

  return c.json({
    success: true,
    data: {
      // HITL: suggestions only — the admin applies via PUT /llm-routing.
      applied: false,
      perUseCase: result.perUseCase,
    },
  });
});

export const adminControlPlaneRouter = app;
export default adminControlPlaneRouter;
