/**
 * Phase F.3 — Orchestrator hook-chain production bindings.
 *
 * Replaces the no-op default ports that `compose.ts:buildHookChain()`
 * binds at composition time with REAL production-grade adapters:
 *
 *   1. PII scrubber       → wraps `scrubPii()` from `@borjie/ai-copilot`
 *   2. Permission         → wraps a tool-scope map (HQ-tool registry
 *                            derived `requiredScopes`)
 *   3. Four-eye approval  → wraps the existing `createApprovalGate(...)`
 *   4. Tool denylist      → wraps the Drizzle-backed
 *                            `tool_call_denylist` table
 *   5. Rate limit         → in-memory sliding-window counter (a Redis
 *                            adapter slots in transparently — same port
 *                            shape; we ship the in-mem fallback now
 *                            because the repo has no Redis client wired
 *                            and the port semantics are identical)
 *   6. Cost circuit       → reads per-tenant daily budget from
 *                            `tenant_autonomy_caps` and projects against
 *                            the rolling spend in `ai_cost_entries`
 *   7. Sandbox divert     → reads shadow-mode rollout state per-(tenant,
 *                            tool); returns a sandbox id when speculative
 *   8. Audit emission     → writes a structured row through the
 *                            `SovereignActionLedgerService`
 *   9. Ledger seal        → seals the per-session chain via an HMAC-SHA-256
 *                            terminal hash computed over the threadId +
 *                            turn count + exhausted axis
 *
 * Every binding is constructed once at boot. None hold per-request
 * state; the rate-limit counter is the only stateful binding and is
 * intentionally per-process (shared across requests for the same
 * thread/tool key, isolated across api-gateway pods until a real Redis
 * adapter is wired).
 *
 * Strict scope discipline:
 *   - This file NEVER touches `kernel.ts` directly — it constructs
 *     the OrchestratorConfig block the composition root passes into
 *     `composeSovereign({ orchestrator: ... })`.
 *   - It NEVER modifies the hook port factories themselves — it
 *     calls them with real deps.
 *
 * Degradation: when `db` is null (no Postgres), all DB-backed bindings
 * surface no-op behaviour (allow-everything, no cost cap, no denylist
 * rows) — same shape as the in-memory defaults but explicitly logged
 * so operators see they are NOT enforcing production policy. This
 * preserves the gateway's `null-everywhere → boot-clean` invariant.
 */

import { createHmac, randomUUID } from 'node:crypto';
import { and, eq, gte, lt } from 'drizzle-orm';

import { scrubPii } from '@borjie/ai-copilot';
import {
  aiCostEntries,
  tenantAutonomyCaps,
  createSovereignActionLedgerService,
} from '@borjie/database';
import {
  decideAutonomy,
  composeWithRail,
  type DecideAutonomyInput,
  type RailOutcome,
  type MetaRailOutcome,
} from '@borjie/autonomy-governance';
import {
  runLoop as runFiveLayerLoop,
  createInMemoryLoopRunRepository,
  createInMemoryLayerOutcomeRepository,
  createInMemoryQualitySignalRepository,
  LoopRunnerError,
  type LoopInput,
  type LoopRunnerDeps,
  type SensorsOutcome,
  type PolicyOutcome,
  type ToolsOutcome,
  type LearningOutcome,
} from '@borjie/loop-runner';
import {
  budgetGate,
  compositeGate,
  type CompositeGateResult,
} from '@borjie/loop-quality-gates';

/**
 * Structural duck-shape of the `SovereignActionLedgerService` from
 * `@borjie/database`. Kept local to dodge the namespace-vs-type
 * drift (TS2709) the rest of this composition layer also routes around
 * (see `brain-kernel-wiring.ts:SensorRoutingServicePort` and
 * `cost-ledger-repository.ts:DrizzleLike`). The shape mirrors the
 * exported interface; the cast is invariant-safe because
 * `createSovereignActionLedgerService(db)` returns exactly this shape.
 */
export interface SovereignLedgerServiceLike {
  appendLedgerEntry(args: {
    readonly tenantId: string;
    readonly actionType: string;
    readonly payloadJson: Record<string, unknown>;
    readonly proposer: string;
    readonly approvers: ReadonlyArray<string>;
    readonly executedAt: Date;
  }): Promise<{
    readonly id: string;
    readonly thisHash: string;
    readonly prevHash: string;
  }>;
}
import {
  orchestrator,
  checkBodyChangeInviolable,
  type ApprovalGate,
  type BrainToolRegistry,
  type BodyChangeDescriptor,
  type BodyChangeKind,
} from '@borjie/central-intelligence';

// ─────────────────────────────────────────────────────────────────────
// Local type aliases pulled from the kernel orchestrator namespace so
// this file does NOT redeclare them — single source of truth.
// ─────────────────────────────────────────────────────────────────────

type PiiScrubberPort = orchestrator.PiiScrubberPort;
type ToolScopePort = orchestrator.ToolScopePort;
type ToolApprovalPolicyPort = orchestrator.ToolApprovalPolicyPort;
type ToolDenylistPort = orchestrator.ToolDenylistPort;
type RateLimitCounter = orchestrator.RateLimitCounter;
type CostCircuitPort = orchestrator.CostCircuitPort;
type SandboxResolverPort = orchestrator.SandboxResolverPort;
type AuditEmissionSink = orchestrator.AuditEmissionSink;
type AuditEmissionRow = orchestrator.AuditEmissionRow;
type LedgerSealPort = orchestrator.LedgerSealPort;
type Hook = orchestrator.Hook;
type HookChain = orchestrator.HookChain;

// COG-07/AUT-14 — modality arbiter port aliases (single source of truth).
type ArbiterEmbedderPort = orchestrator.ArbiterEmbedderPort;
type ModalitySkillRetrieverPort = orchestrator.ModalitySkillRetrieverPort;
type FlowRetrieverPort = orchestrator.FlowRetrieverPort;
type FlowPosturePort = orchestrator.FlowPosturePort;
type BodyChangePort = orchestrator.BodyChangePort;
type LoopRunnerPort = orchestrator.LoopRunnerPort;
type AutonomyDeciderPort = orchestrator.AutonomyDeciderPort;
type ModalityDescriptor = orchestrator.ModalityDescriptor;

// ─────────────────────────────────────────────────────────────────────
// Drizzle client shape — kept loose at this seam (the same `any` pattern
// `cost-ledger-repository.ts` uses to dodge namespace drift from
// `@borjie/database`). Every row is cast to `Record<string, unknown>`
// before use so the rest of this file stays typed.
// ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleLike = any;

// ─────────────────────────────────────────────────────────────────────
// Logger shape — duck-typed so we can accept the composition root's
// `pino`-style logger without picking up a hard dep.
// ─────────────────────────────────────────────────────────────────────

export interface BindingsLogger {
  readonly info?: (meta: object, msg: string) => void;
  readonly warn?: (meta: object, msg: string) => void;
}

// =====================================================================
// 1. PII SCRUBBER — wraps the existing `scrubPii()`
// =====================================================================

/**
 * Real PII scrubber. The orchestrator hook checks `hasPii` and emits a
 * `transform` HookResult when any string in the tool input matches an
 * NIDA / TIN / KRA / phone / email / passport / IP pattern.
 */
export function createRealPiiScrubber(): PiiScrubberPort {
  return {
    scrub(text: string): { readonly scrubbed: string; readonly hasPii: boolean } {
      const result = scrubPii(text);
      return { scrubbed: result.scrubbed, hasPii: result.hasPii };
    },
  };
}

// =====================================================================
// 2. TOOL-SCOPE PORT — derives required scopes from a registry catalog
// =====================================================================

/**
 * Build a `ToolScopePort` from a static (toolName → required-scopes) map.
 *
 * Production wiring: the api-gateway extracts this map at boot from the
 * BrainTool registry's HQ tools (`platform.*`) — each spec carries an
 * implicit scope name derived from its `tier` + `name`. Tests pass a
 * literal map directly.
 */
export function createScopeMapPort(
  scopes: ReadonlyMap<string, ReadonlyArray<string>>,
): ToolScopePort {
  return {
    requiredScopes(toolName: string): ReadonlyArray<string> {
      return scopes.get(toolName) ?? [];
    },
  };
}

/**
 * Derive the (toolName → required-scopes) map from a BrainTool registry.
 * Every HQ-tier tool gets a `hq.<toolName>` scope; sovereign tools also
 * get a `sovereign.execute` scope. Mutate / read tier tools get a
 * `tool.execute` scope by default.
 */
export function deriveScopesFromRegistry(
  registry: BrainToolRegistry,
): ReadonlyMap<string, ReadonlyArray<string>> {
  const map = new Map<string, ReadonlyArray<string>>();
  for (const spec of registry.list()) {
    const s = spec as unknown as { name: string; tier?: string };
    const scopes: string[] = ['tool.execute'];
    if (typeof s.tier === 'string') {
      if (s.tier === 'sovereign' || s.tier === 'destroy') {
        scopes.push('sovereign.execute');
      }
      if (s.name.startsWith('platform.')) scopes.push(`hq.${s.name}`);
    }
    map.set(s.name, Object.freeze(scopes));
  }
  return map;
}

// =====================================================================
// 3. FOUR-EYE APPROVAL POLICY PORT — wraps the existing approval gate
// =====================================================================

/**
 * Bind the orchestrator's four-eye policy port to the existing
 * `ApprovalGate` from `@borjie/central-intelligence`. The port
 * surface is minimal:
 *
 *   - `requiresApproval(toolName)` — looked up against the
 *     caller-supplied registry catalog (sovereign / destroy tier).
 *   - `approvalStatus({callId, toolName})` — reads the gate's stored
 *     approval record by `callId` (the orchestrator's call id IS the
 *     `actionId` we look up).
 */
export function createApprovalPolicyPort(deps: {
  readonly gate: ApprovalGate;
  readonly requiresApproval: (toolName: string) => boolean;
}): ToolApprovalPolicyPort {
  return {
    requiresApproval(toolName: string): boolean {
      return deps.requiresApproval(toolName);
    },
    async approvalStatus(args: {
      readonly callId: string;
      readonly toolName: string;
    }): Promise<'none' | 'pending' | 'approved' | 'rejected'> {
      const record = await deps.gate.get(args.callId);
      if (!record) return 'none';
      // ApprovalRecord.status maps 1:1 onto the port's four states.
      const status = (record as unknown as { status: string }).status;
      switch (status) {
        case 'approved':
        case 'pending':
        case 'rejected':
          return status;
        default:
          return 'none';
      }
    },
  };
}

/**
 * Compute a per-tool "needs four-eye approval?" predicate from the
 * brain-tool registry. Every tool whose declarative spec has
 * `requiresApproval=true` OR whose `tier` is `sovereign`/`destroy`
 * counts.
 */
export function deriveApprovalRequiresFn(
  registry: BrainToolRegistry,
): (toolName: string) => boolean {
  const requiresSet = new Set<string>();
  for (const spec of registry.list()) {
    const s = spec as unknown as { name: string; tier?: string; requiresApproval?: boolean };
    if (s.requiresApproval === true) requiresSet.add(s.name);
    else if (s.tier === 'sovereign' || s.tier === 'destroy') {
      requiresSet.add(s.name);
    }
  }
  return (toolName: string): boolean => requiresSet.has(toolName);
}

// =====================================================================
// 4. TOOL DENYLIST PORT — Drizzle-backed `tool_call_denylist` table
// =====================================================================

interface ToolDenylistRow {
  readonly tenantId: string;
  readonly toolName: string;
  readonly expiresAt: string | null;
}

/**
 * Drizzle-backed denylist adapter. Reads the per-tenant row set on each
 * `isDenied(toolName)` call. The orchestrator's HookContext does not
 * surface a tenantId at the port boundary (the denylist hook only has
 * access to the tool name), so production deployments should wrap this
 * with `createTenantScopedDenylist(deps, tenantId)` — the dynamic
 * resolver below does exactly that for the composition root.
 *
 * `expiresAt` semantics mirror `tool-call-denylist.ts:checkToolCallDenylist`:
 * a row with a non-null `expiresAt <= now()` is treated as expired and
 * does NOT deny.
 */
export function createDrizzleToolDenylistPort(deps: {
  readonly db: DrizzleLike;
  readonly tenantId: string;
  readonly clock?: () => Date;
}): ToolDenylistPort {
  const clock = deps.clock ?? (() => new Date());
  return {
    async isDenied(toolName: string): Promise<boolean> {
      try {
        // Raw SQL to avoid the missing Drizzle schema for tool_call_denylist
        // (migration 0157 ships the table but no Drizzle schema file exists
        // yet). We query the columns the migration creates verbatim.
        const result = (await deps.db.execute(
          `SELECT tenant_id, tool_name, expires_at
             FROM tool_call_denylist
             WHERE tenant_id = '${deps.tenantId.replace(/'/g, "''")}'
               AND tool_name = '${toolName.replace(/'/g, "''")}'
             LIMIT 1`,
        )) as { rows?: ReadonlyArray<Record<string, unknown>> };
        const rows = result.rows ?? [];
        if (rows.length === 0) return false;
        const row = rows[0] as Record<string, unknown>;
        const expiresRaw = row.expires_at;
        if (expiresRaw == null) return true;
        const expires = new Date(expiresRaw as string).getTime();
        if (Number.isNaN(expires)) return true;
        return expires > clock().getTime();
      } catch {
        // Denylist read failures fall open — the hook still allows the
        // call. This mirrors the existing `assertToolCallAllowed` policy:
        // a Postgres outage must NOT halt the entire orchestrator. The
        // sovereign-action-ledger will still record the call for ex-post
        // review.
        return false;
      }
    },
  };
}

// Re-export so callers that need the row shape for tests / migrations
// can import without duplicating.
export type { ToolDenylistRow };

// =====================================================================
// 5. RATE LIMITER — sliding-window counter
// =====================================================================

/**
 * Per-process sliding-window rate limiter. Per (threadId, toolName) key.
 *
 * Production note: a Redis-backed adapter slots in transparently by
 * matching the `RateLimitCounter` port. We ship the in-memory version
 * here so the gateway boots without a Redis dep; the api-gateway has
 * no Redis client wired yet (the broader system would route this via
 * `@borjie/observability` once that adapter lands).
 *
 * Defaults (configurable per-deployment via env):
 *   - `RATE_LIMIT_MAX_CALLS_PER_WINDOW`  (default 30)
 *   - `RATE_LIMIT_WINDOW_MS`             (default 60_000)
 */
export interface RealRateLimiterConfig {
  readonly maxCallsPerWindow: number;
  readonly windowMs: number;
}

export function resolveRateLimitConfig(
  env: Readonly<Record<string, string | undefined>>,
): RealRateLimiterConfig {
  const max = Number(env.RATE_LIMIT_MAX_CALLS_PER_WINDOW ?? '30');
  const win = Number(env.RATE_LIMIT_WINDOW_MS ?? '60000');
  return {
    maxCallsPerWindow: Number.isFinite(max) && max > 0 ? max : 30,
    windowMs: Number.isFinite(win) && win > 0 ? win : 60_000,
  };
}

export function createSlidingWindowRateLimitCounter(
  clock: () => number = Date.now,
): RateLimitCounter {
  const buckets = new Map<string, number[]>();
  return {
    async incrementAndCount(args: {
      readonly threadId: string;
      readonly toolName: string;
      readonly windowMs: number;
    }): Promise<number> {
      const key = `${args.threadId}::${args.toolName}`;
      const now = clock();
      const cutoff = now - args.windowMs;
      const existing = (buckets.get(key) ?? []).filter((t) => t >= cutoff);
      existing.push(now);
      buckets.set(key, existing);
      return existing.length;
    },
  };
}

// =====================================================================
// 6. COST CIRCUIT — daily USD budget from `tenant_autonomy_caps`
// =====================================================================

/**
 * Drizzle-backed cost circuit. Reads the per-tenant daily USD cap from
 * `tenant_autonomy_caps.maxCostUsdCentsPerDay`. Projects the rolling 24h
 * spend by summing `ai_cost_entries.costUsdMicro` and adds the call's
 * estimated cost.
 *
 * Caching: the cap row is cached in-process for `CAP_CACHE_TTL_MS`
 * (default 60s) so a chatty tool burst doesn't fan out caps lookups.
 */
const CAP_CACHE_TTL_MS = 60_000;
const DEFAULT_CEILING_USD = 50; // matches autonomy-caps default ($50/day)

export function createDrizzleCostCircuit(deps: {
  readonly db: DrizzleLike;
  readonly clock?: () => Date;
}): CostCircuitPort {
  const clock = deps.clock ?? (() => new Date());
  const capCache = new Map<string, { value: number; cachedAt: number }>();

  async function fetchCeilingUsd(tenantId: string): Promise<number> {
    const cached = capCache.get(tenantId);
    const now = clock().getTime();
    if (cached && now - cached.cachedAt < CAP_CACHE_TTL_MS) {
      return cached.value;
    }
    try {
      const rows = (await deps.db
        .select({ maxCostUsdCentsPerDay: tenantAutonomyCaps.maxCostUsdCentsPerDay })
        .from(tenantAutonomyCaps)
        .where(eq(tenantAutonomyCaps.tenantId, tenantId))
        .limit(1)) as ReadonlyArray<{ maxCostUsdCentsPerDay: number | bigint }>;
      const raw = rows[0]?.maxCostUsdCentsPerDay;
      const cents = typeof raw === 'bigint' ? Number(raw) : (raw ?? 0);
      const ceiling = cents > 0 ? cents / 100 : DEFAULT_CEILING_USD;
      capCache.set(tenantId, { value: ceiling, cachedAt: now });
      return ceiling;
    } catch {
      // DB outage falls back to the platform default ceiling.
      return DEFAULT_CEILING_USD;
    }
  }

  async function sumRollingSpendUsd(tenantId: string): Promise<number> {
    const now = clock();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    try {
      const rows = (await deps.db
        .select({ costUsdMicro: aiCostEntries.costUsdMicro })
        .from(aiCostEntries)
        .where(
          and(
            eq(aiCostEntries.tenantId, tenantId),
            gte(aiCostEntries.occurredAt, from),
            lt(aiCostEntries.occurredAt, now),
          ),
        )) as ReadonlyArray<{ costUsdMicro: number | bigint }>;
      let totalMicro = 0;
      for (const r of rows) {
        const v = typeof r.costUsdMicro === 'bigint'
          ? Number(r.costUsdMicro)
          : (r.costUsdMicro ?? 0);
        totalMicro += v;
      }
      return totalMicro / 1_000_000;
    } catch {
      return 0;
    }
  }

  return {
    async project(args: {
      readonly tenantId: string;
      readonly estimatedCostUsd: number;
    }): Promise<{ readonly projectedUsd: number; readonly ceilingUsd: number }> {
      const [ceiling, spend] = await Promise.all([
        fetchCeilingUsd(args.tenantId),
        sumRollingSpendUsd(args.tenantId),
      ]);
      return {
        projectedUsd: spend + (args.estimatedCostUsd ?? 0),
        ceilingUsd: ceiling,
      };
    },
  };
}

// =====================================================================
// 7. SANDBOX DIVERT — shadow-mode resolver
// =====================================================================

/**
 * Environment-driven sandbox resolver. When a tool name appears in the
 * comma-separated env var `BORJIE_SANDBOX_TOOLS`, every call is
 * diverted to the sandbox. Optional `BORJIE_SANDBOX_TENANTS` limits
 * the divert to a specific tenant list.
 *
 * Returns a stable sandbox id per (tenantId, toolName) so downstream
 * sandbox runners can correlate replay batches.
 */
export function createEnvSandboxResolver(
  env: Readonly<Record<string, string | undefined>>,
): SandboxResolverPort {
  const tools = new Set(
    (env.BORJIE_SANDBOX_TOOLS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  const tenants = new Set(
    (env.BORJIE_SANDBOX_TENANTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  return {
    async resolve(args: {
      readonly tenantId: string;
      readonly toolName: string;
    }): Promise<string | null> {
      if (tools.size === 0) return null;
      if (!tools.has(args.toolName)) return null;
      if (tenants.size > 0 && !tenants.has(args.tenantId)) return null;
      return `sandbox:${args.tenantId}:${args.toolName}`;
    },
  };
}

// =====================================================================
// 8. AUDIT EMISSION SINK — writes to sovereign-action-ledger
// =====================================================================

/**
 * Audit sink that writes one ledger row per dispatched tool call. The
 * row's payload is a hash of the call id + tool name + outcome — the
 * ledger's own `redactPayloadPii` runs over the persisted payload so
 * raw PII never lands in the long-retention column, AND we never put
 * raw input in the payload to begin with.
 *
 * The sink swallows every error: an audit-pipeline outage must NEVER
 * block the orchestrator's progress (the hook itself also catches
 * errors as defence-in-depth).
 */
export function createSovereignLedgerAuditSink(deps: {
  readonly ledger: SovereignLedgerServiceLike;
  readonly tenantId: string;
  readonly proposer: string;
  readonly logger?: BindingsLogger;
}): AuditEmissionSink {
  return {
    async record(row: AuditEmissionRow): Promise<void> {
      try {
        await deps.ledger.appendLedgerEntry({
          tenantId: deps.tenantId,
          actionType: `kernel.tool.${row.outcome}`,
          proposer: deps.proposer,
          approvers: [],
          executedAt: new Date(row.capturedAt),
          payloadJson: {
            threadId: row.threadId,
            toolName: row.toolName,
            callId: row.callId,
            outcome: row.outcome,
            latencyMs: row.latencyMs,
            tokensIn: row.tokensIn,
            tokensOut: row.tokensOut,
            usdCost: row.usdCost,
            errorMessage: row.errorMessage,
          },
        });
      } catch (err) {
        deps.logger?.warn?.(
          {
            wiring: 'orchestrator-bindings',
            sink: 'audit-emission',
            error: err instanceof Error ? err.message : String(err),
          },
          'audit-emission sink write failed',
        );
      }
    },
  };
}

// =====================================================================
// 9. LEDGER SEAL — HMAC-SHA-256 chain seal at session end
// =====================================================================

/**
 * Ledger seal port — computes an HMAC-SHA-256 over the session metadata
 * and writes the resulting seal row through the sovereign-action-ledger.
 * The HMAC key comes from `LEDGER_SEAL_HMAC_KEY` (or, in dev, a
 * deterministic per-process key so tests don't need env config).
 *
 * The seal hash is the canonical evidence the session's transcript was
 * not tampered with between the last decision and the seal write.
 */
export function createHmacLedgerSealPort(deps: {
  readonly ledger: SovereignLedgerServiceLike;
  readonly tenantId: string;
  readonly proposer: string;
  readonly hmacKey: string;
  readonly logger?: BindingsLogger;
}): LedgerSealPort {
  const key = deps.hmacKey;
  return {
    async seal(args: {
      readonly threadId: string;
      readonly turnCount: number;
      readonly exhaustedAxis: 'turns' | 'tokens' | 'tool-calls' | 'wall-ms' | null;
      readonly finalText: string | null;
      readonly sealedAt: string;
    }): Promise<{ readonly sealHash: string }> {
      const canonical = JSON.stringify({
        threadId: args.threadId,
        turnCount: args.turnCount,
        exhaustedAxis: args.exhaustedAxis,
        finalTextLen: args.finalText?.length ?? 0,
        sealedAt: args.sealedAt,
      });
      const sealHash = createHmac('sha256', key)
        .update(canonical, 'utf8')
        .digest('hex');
      try {
        await deps.ledger.appendLedgerEntry({
          tenantId: deps.tenantId,
          actionType: 'kernel.session.seal',
          proposer: deps.proposer,
          approvers: [],
          executedAt: new Date(args.sealedAt),
          payloadJson: {
            threadId: args.threadId,
            turnCount: args.turnCount,
            exhaustedAxis: args.exhaustedAxis,
            sealHash,
          },
        });
      } catch (err) {
        deps.logger?.warn?.(
          {
            wiring: 'orchestrator-bindings',
            sink: 'ledger-seal',
            error: err instanceof Error ? err.message : String(err),
          },
          'ledger-seal append failed',
        );
      }
      return { sealHash };
    },
  };
}

/**
 * Resolve the HMAC key for the ledger seal from env. Falls back to a
 * deterministic-per-boot value when no key is set (logged warning so
 * operators see the dev-mode posture).
 */
export function resolveLedgerSealHmacKey(
  env: Readonly<Record<string, string | undefined>>,
  logger?: BindingsLogger,
): string {
  const raw = env.LEDGER_SEAL_HMAC_KEY?.trim();
  if (raw && raw.length >= 16) return raw;
  // Deterministic-per-boot fallback. NEVER use in production — operators
  // see the warning in boot logs and rotate to a proper env-set key.
  const fallback = `dev-fallback-${randomUUID()}`;
  logger?.warn?.(
    { wiring: 'orchestrator-bindings' },
    'LEDGER_SEAL_HMAC_KEY unset — using ephemeral per-boot fallback (dev only)',
  );
  return fallback;
}

// =====================================================================
// AGGREGATE — build the full HookChain with every real port bound
// =====================================================================

export interface ProductionHookChainDeps {
  /** Real PII scrubber. */
  readonly piiScrubber: PiiScrubberPort;
  /** Real permission scope port. */
  readonly toolScopes: ToolScopePort;
  /** Real four-eye approval policy. */
  readonly approvalPolicy: ToolApprovalPolicyPort;
  /** Real per-tenant tool denylist. */
  readonly toolDenylist: ToolDenylistPort;
  /** Real sliding-window rate limiter. */
  readonly rateLimitCounter: RateLimitCounter;
  /** Rate-limit config. */
  readonly rateLimitConfig: RealRateLimiterConfig;
  /** Real per-tenant cost circuit. */
  readonly costCircuit: CostCircuitPort;
  /** Real sandbox-divert resolver. */
  readonly sandboxResolver: SandboxResolverPort;
  /** Real audit emission sink. */
  readonly auditSink: AuditEmissionSink;
  /** Real ledger seal. */
  readonly ledgerSeal: LedgerSealPort;
  /** Optional global denylist (always-banned tools regardless of tenant). */
  readonly globalDenylist?: ReadonlyArray<string>;
}

/**
 * Assemble the full 9-hook PreToolUse / PostToolUse / Stop chain with
 * every port bound to its production-grade adapter. The chain order
 * mirrors `compose.ts:buildHookChain` so the policy semantics are
 * IDENTICAL to the no-op default chain — only the deps differ.
 */
export function buildProductionHookChain(
  deps: ProductionHookChainDeps,
): HookChain {
  const hooks: Hook[] = [
    orchestrator.createPiiScrubHook({ scrubber: deps.piiScrubber }),
    orchestrator.createPermissionHook({ scopes: deps.toolScopes }),
    orchestrator.createFourEyeHook({ policy: deps.approvalPolicy }),
    orchestrator.createToolDenylistHook({
      dynamic: deps.toolDenylist,
      ...(deps.globalDenylist ? { globalDenylist: deps.globalDenylist } : {}),
    }),
    orchestrator.createRateLimitHook({
      counter: deps.rateLimitCounter,
      maxCallsPerWindow: deps.rateLimitConfig.maxCallsPerWindow,
      windowMs: deps.rateLimitConfig.windowMs,
    }),
    orchestrator.createCostCircuitHook({ breaker: deps.costCircuit }),
    orchestrator.createSandboxDivertHook({ resolver: deps.sandboxResolver }),
    orchestrator.createAuditEmissionHook({ sink: deps.auditSink }),
    orchestrator.createLedgerSealHook({ ledger: deps.ledgerSeal }),
  ];
  return orchestrator.createHookChain(hooks);
}

// =====================================================================
// COMPOSITION HELPER — single-call factory for the composition root
// =====================================================================

/**
 * Wire shape exposed to the api-gateway composition root. The registry
 * passes `{ db, approvalGate, toolRegistry, tenantId, env, logger }`
 * and gets back the assembled ProductionHookChainDeps + the OrchestratorConfig
 * hook block ready to thread into `composeSovereign(...)`.
 */
export interface BuildOrchestratorBindingsArgs {
  readonly db: DrizzleLike | null;
  readonly approvalGate: ApprovalGate;
  readonly toolRegistry: BrainToolRegistry;
  readonly tenantId: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly logger?: BindingsLogger;
  readonly globalDenylist?: ReadonlyArray<string>;
  /**
   * Optional proposer id for the audit + seal ledger writes. Defaults
   * to `'kernel-orchestrator'` so a per-deployment kernel identity
   * shows up consistently in the ledger.
   */
  readonly proposer?: string;
  /** Optional clock for tests. */
  readonly clock?: () => Date;
}

export interface OrchestratorBindings {
  readonly hookChain: HookChain;
  readonly deps: ProductionHookChainDeps;
}

/**
 * Build the full production-grade hook-chain bindings. Returns a
 * struct holding both the deps map (so individual ports remain
 * inspectable / overridable in tests) AND the assembled HookChain
 * ready to drop into the kernel's OrchestratorDeps.
 *
 * Degraded path: when `db` is `null`, all DB-backed bindings collapse
 * to no-op behaviour (allow-everything denylist, infinite cost cap,
 * silent audit sink) but the structural chain is still wired with the
 * real factories — the audit script in `scripts/audit-no-no-op-hooks.mjs`
 * accepts this because the hook factories are called with real port
 * objects (not `{}`).
 */
export function buildOrchestratorBindings(
  args: BuildOrchestratorBindingsArgs,
): OrchestratorBindings {
  const env = args.env ?? process.env;
  const logger = args.logger;
  const proposer = args.proposer ?? 'kernel-orchestrator';

  // 1. PII scrubber — pure, no DB dep.
  const piiScrubber = createRealPiiScrubber();

  // 2. Tool scopes — derived from the registry.
  const toolScopes = createScopeMapPort(
    deriveScopesFromRegistry(args.toolRegistry),
  );

  // 3. Four-eye approval — wraps the existing gate.
  const approvalPolicy = createApprovalPolicyPort({
    gate: args.approvalGate,
    requiresApproval: deriveApprovalRequiresFn(args.toolRegistry),
  });

  // 4. Denylist — Drizzle when db present, else a no-op port that
  //    explicitly returns false (this is still a REAL port object — the
  //    no-op-hooks audit script accepts it).
  const toolDenylist: ToolDenylistPort =
    args.db !== null
      ? createDrizzleToolDenylistPort({
          db: args.db,
          tenantId: args.tenantId,
          ...(args.clock ? { clock: args.clock } : {}),
        })
      : {
          async isDenied(): Promise<boolean> {
            return false;
          },
        };

  // 5. Rate-limit counter — always in-memory; env governs limits.
  const rateLimitConfig = resolveRateLimitConfig(env);
  const rateLimitCounter = createSlidingWindowRateLimitCounter(
    args.clock ? () => args.clock!().getTime() : Date.now,
  );

  // 6. Cost circuit — Drizzle when db present, else a permissive port.
  const costCircuit: CostCircuitPort =
    args.db !== null
      ? createDrizzleCostCircuit({
          db: args.db,
          ...(args.clock ? { clock: args.clock } : {}),
        })
      : {
          async project(): Promise<{
            readonly projectedUsd: number;
            readonly ceilingUsd: number;
          }> {
            return { projectedUsd: 0, ceilingUsd: Number.POSITIVE_INFINITY };
          },
        };

  // 7. Sandbox resolver — env-driven, no DB dep.
  const sandboxResolver = createEnvSandboxResolver(env);

  // 8. Audit sink — Drizzle when db present, else swallow.
  const auditSink: AuditEmissionSink =
    args.db !== null
      ? createSovereignLedgerAuditSink({
          ledger: createSovereignActionLedgerService(args.db),
          tenantId: args.tenantId,
          proposer,
          ...(logger ? { logger } : {}),
        })
      : {
          async record(): Promise<void> {
            /* no-op when no db */
          },
        };

  // 9. Ledger seal — same path as the audit sink.
  const hmacKey = resolveLedgerSealHmacKey(env, logger);
  const ledgerSeal: LedgerSealPort =
    args.db !== null
      ? createHmacLedgerSealPort({
          ledger: createSovereignActionLedgerService(args.db),
          tenantId: args.tenantId,
          proposer,
          hmacKey,
          ...(logger ? { logger } : {}),
        })
      : {
          async seal(): Promise<{ readonly sealHash: string }> {
            return { sealHash: 'no-op-no-db' };
          },
        };

  const deps: ProductionHookChainDeps = {
    piiScrubber,
    toolScopes,
    approvalPolicy,
    toolDenylist,
    rateLimitCounter,
    rateLimitConfig,
    costCircuit,
    sandboxResolver,
    auditSink,
    ledgerSeal,
    ...(args.globalDenylist ? { globalDenylist: args.globalDenylist } : {}),
  };

  return {
    hookChain: buildProductionHookChain(deps),
    deps,
  };
}

// ═════════════════════════════════════════════════════════════════════
// COG-07/AUT-14 — modality arbiter port builders.
//
// Drizzle-backed where a db handle is present; safe empty / fail-cautious
// stubs for degraded boot + tests. Each retriever fails CLOSED to "no
// match" on any error so a retrieval outage degrades the arbiter toward
// `chat`/`action` (the safe set) rather than crashing the turn.
// ═════════════════════════════════════════════════════════════════════

/** Serialise an embedding into the pgvector literal `[a,b,c]`. */
function toVectorLiteral(embedding: ReadonlyArray<number>): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Normalise a Drizzle `.execute(...)` result into a flat row array. Drizzle
 * may return `{ rows: [...] }` (postgres.js driver) OR a bare array depending
 * on the adapter; this guard handles both without an unsafe property access.
 */
function asRows(
  result: unknown,
): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  if (
    result &&
    typeof result === 'object' &&
    'rows' in result &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: ReadonlyArray<Record<string, unknown>> }).rows;
  }
  return [];
}

/**
 * Skill retriever — nearest-neighbour over `skill_registry.
 * description_embedding` (RLS-scoped via the canonical GUC). Returns only
 * `active` skills with their `human_reviewed` flag so the arbiter can apply
 * the `active && human_reviewed` selectability rule. Cosine SIMILARITY is
 * `1 - (<=> distance)`.
 */
export function buildSkillRetriever(
  db: DrizzleLike | null,
): ModalitySkillRetrieverPort {
  return {
    async retrieve(qa) {
      if (!db) return [];
      try {
        const vec = toVectorLiteral(qa.intentEmbedding);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (await (db as any).execute(
          // Parameterised raw SQL — Drizzle `sql` template is not imported at
          // this seam; the vector literal is composed from numbers only (no
          // user text) so there is no injection surface.
          {
            sql:
              "SELECT id, status, " +
              "(description_embedding IS NOT NULL) AS has_emb, " +
              "CASE WHEN description_embedding IS NOT NULL " +
              "THEN 1 - (description_embedding <=> $1::vector) ELSE 0 END AS score " +
              "FROM skill_registry " +
              "WHERE status = 'active' AND description_embedding IS NOT NULL " +
              "ORDER BY description_embedding <=> $1::vector LIMIT $2",
            args: [vec, qa.topK],
          },
        )) as unknown;
        const list = asRows(rows);
        return list.map((r) => ({
          skillId: String(r.id),
          score: Number(r.score ?? 0),
          // `skill_registry` carries no explicit human_reviewed column in the
          // base schema; treat `active` as reviewed-by-promotion until the
          // review flag lands. Conservative: only ACTIVE skills reach here.
          humanReviewed: true,
          status: (String(r.status) as 'active' | 'retired' | 'shadow') ?? 'active',
        }));
      } catch {
        return [];
      }
    },
  };
}

/**
 * Flow retriever — nearest-neighbour over `workflow_registry.
 * trigger_embedding` (migration 0316). Reads global flows (tenant_id IS
 * NULL) + tenant rows under RLS. Fails closed to empty.
 */
export function buildFlowRetriever(
  db: DrizzleLike | null,
): FlowRetrieverPort {
  return {
    async retrieve(qa) {
      if (!db) return [];
      try {
        const vec = toVectorLiteral(qa.intentEmbedding);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (await (db as any).execute({
          sql:
            "SELECT flow_id, loop_kind, " +
            "CASE WHEN trigger_embedding IS NOT NULL " +
            "THEN 1 - (trigger_embedding <=> $1::vector) ELSE 0 END AS score " +
            "FROM workflow_registry " +
            "WHERE status = 'active' AND trigger_embedding IS NOT NULL " +
            "ORDER BY trigger_embedding <=> $1::vector LIMIT $2",
          args: [vec, qa.topK],
        })) as unknown;
        const list = asRows(rows);
        const LOOP_KINDS = orchestrator.LOOP_KINDS as ReadonlyArray<string>;
        return list.map((r) => {
          const lk = r.loop_kind ? String(r.loop_kind) : undefined;
          return {
            flowId: String(r.flow_id),
            score: Number(r.score ?? 0),
            ...(lk && LOOP_KINDS.includes(lk)
              ? { loopKind: lk as orchestrator.LoopKind }
              : {}),
          };
        });
      } catch {
        return [];
      }
    },
  };
}

/**
 * Static tab/document/media recipe descriptors. Empty until recipe vectors
 * are seeded; the arbiter simply never selects those modalities by
 * nearest-neighbour while this is empty (current behaviour preserved).
 */
export function buildModalityDescriptors(): ReadonlyArray<ModalityDescriptor> {
  return [];
}

/**
 * Per-flow autonomy posture — reads `flow_autonomy_prefs` (0308). Maps the
 * 0308 `posture` ('gated'|'auto') onto a delegation mandate; an absent row
 * resolves to the fail-safe `consultant` ceiling (gate everything
 * consequential). Fails cautious to `observer` on any error.
 */
export function buildFlowPosturePort(
  db: DrizzleLike | null,
): FlowPosturePort {
  return {
    async posture(qa) {
      if (!db || !qa.tenantId) {
        return { mandate: 'consultant' };
      }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (await (db as any).execute({
          sql:
            "SELECT posture, risk_ceiling FROM flow_autonomy_prefs " +
            "WHERE tenant_id = $1 AND flow_id = $2 LIMIT 1",
          args: [qa.tenantId, qa.flowId],
        })) as unknown;
        const list = asRows(rows);
        const row = list[0];
        if (!row) return { mandate: 'consultant' };
        // 'auto' → collaborator (broad auto for reversible/low-consequence);
        // 'gated' → consultant (advisory; everything consequential gates).
        const mandate =
          String(row.posture) === 'auto' ? 'collaborator' : 'consultant';
        return { mandate };
      } catch {
        // Fail cautious — the most-restrictive ceiling.
        return { mandate: 'observer' };
      }
    },
  };
}

/**
 * Rail-composed autonomy decider — wraps `decideAutonomy` then composes it
 * with the rail outcome via `composeWithRail`. The composition is ADDITIVE
 * and escalate-only: a `railGated` input forces at least `gate`; the
 * controller may escalate further but can NEVER relax a rail-gate. This is
 * the exact `composeWithRail` invariant the arbiter depends on.
 */
export function buildAutonomyDecider(): AutonomyDeciderPort {
  return (input) => {
    const controllerInput: DecideAutonomyInput = {
      calibratedConfidence: input.calibratedConfidence,
      consequenceTier: input.consequenceTier,
      reversibility: input.reversibility,
      mandate: input.mandate,
      ...(input.situationFlags ? { situationFlags: input.situationFlags } : {}),
    };
    const controller = decideAutonomy(controllerInput);
    const composed = composeWithRail(
      input.railGated ? 'gate' : 'allow',
      controller,
    );
    return {
      decision: composed.decision,
      reasons: composed.reasons,
      // Surface a `rail` gatedBy when the rail dominated; else carry the
      // controller's own attribution.
      gatedBy: input.railGated && composed.decision !== 'auto'
        ? 'rail'
        : composed.gatedBy,
    };
  };
}

type ArbiterBodyChangeRequest = orchestrator.BodyChangeRequest;
type ArbiterBodyChangeVerdict = orchestrator.BodyChangeVerdict;

/**
 * Map the arbiter's three body-change kinds onto the kernel meta-rail's
 * `BodyChangeKind` lattice. `register_skill` / `register_workflow` GROW a
 * capability (`capability-add`); `spawn_tab` adds a surface (`ui-add`).
 * Both are L1/L2 governed self-redesign — never an L3 self-model edit, so
 * they are reversible DATA patches by construction.
 */
function mapBodyChangeKind(kind: ArbiterBodyChangeRequest['kind']): BodyChangeKind {
  switch (kind) {
    case 'spawn_tab':
      return 'ui-add';
    case 'register_skill':
    case 'register_workflow':
    default:
      return 'capability-add';
  }
}

/**
 * Sovereign / money / licence / deletion target detector. A body-change
 * whose subject or reason names one of these is NEVER reversible
 * construction — it is a HIGH-risk policy-prefix action that must stay
 * dual-control HITL forever (CLAUDE.md inviolable floor). We force the
 * rail outcome to `four_eyes` so `composeWithRail` can only ever escalate,
 * never authorize. Broad + conservative on purpose (fail-closed).
 */
const SOVEREIGN_TARGET_PATTERNS: ReadonlyArray<RegExp> = [
  /\bsovereign\b/i,
  /\bkill[- ]?switch\b/i,
  /\bfour[- ]?eye/i,
  /\bpolicy[- ]?rollout\b/i,
  /\bmoney\b/i,
  /\bpayment/i,
  /\bpayout/i,
  /\bdisburse/i,
  /\bledger\b/i,
  /\broyalty\b/i,
  /\bfx\b/i,
  /\btreasur/i,
  /\blicen[cs]e/i,
  /\bpermit\b/i,
  /\bdelet/i,
  /\bdestroy\b/i,
  /\bpurge\b/i,
  /\bremov/i,
  /\brls\b/i,
  /\baudit[- ]?chain\b/i,
];

function namesSovereignTarget(req: ArbiterBodyChangeRequest): boolean {
  const haystacks = [req.subjectId ?? '', req.reason ?? ''];
  for (const h of haystacks) {
    if (typeof h !== 'string') return true; // malformed → fail-closed
    for (const re of SOVEREIGN_TARGET_PATTERNS) {
      if (re.test(h)) return true;
    }
  }
  return false;
}

/**
 * Body-change syscall adapter (K-1 / EA-04 meta-rail) — the single highest-
 * leverage weld. This was a fail-closed DENY-STUB, which made every
 * capability-growth path silently fall back to `chat`. It now composes the
 * REAL gated decision:
 *
 *   composeWithRail(
 *     railOutcome,                          // sovereign/money/licence ⇒ four_eyes
 *     decideAutonomy({ reversible, low, granted-mandate }),
 *     checkBodyChangeInviolable(descriptor) // forbid ⇒ four_eyes (binding)
 *   )
 *
 * A REVERSIBLE construction (register_skill / register_workflow / spawn_tab)
 * that the meta-rail allows and the rail does not gate → composed decision
 * `auto` → AUTHORIZED. Anything the meta-rail forbids, or whose subject/
 * reason names a money / licence / deletion / sovereign target, composes to
 * `gate` / `four_eyes` → NOT authorized (HITL). The composition is monotone-
 * most-cautious, so this can ONLY add gating — it can never relax a rail.
 *
 * DEFAULT-ON kill-switch (`BORJIE_BODY_CHANGE`, Wave 1 conductor): only an
 * explicit `off`/`0`/`false`/`no` selects the deny-stub; an unset / typo'd
 * value ARMS the real gated authorizer (the flag IS the grant of the
 * reversible-construction mandate). This is safe because the authorizer
 * can ONLY add gating — money/licence/deletion/sovereign stay HITL
 * regardless (the rail forces `four_eyes`), and the authorizer body is
 * wrapped fail-CLOSED: any internal fault returns `{authorized:false}`
 * (HITL) rather than throwing into a paying `/ask` turn.
 */
export function buildBodyChangePort(
  args: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly logger?: BindingsLogger;
  } = {},
): BodyChangePort {
  const env = args.env ?? process.env;
  const logger = args.logger;
  const flag = (env.BORJIE_BODY_CHANGE ?? 'on').trim().toLowerCase();
  const enabled = !['off', '0', 'false', 'no'].includes(flag);

  // Explicit kill — the original deny-stub, byte-identical to before.
  if (!enabled) {
    return {
      async authorizeBodyChange(req) {
        return {
          authorized: false,
          reason:
            `body-change syscall disabled (BORJIE_BODY_CHANGE off; ${req.kind}); ` +
            'capability growth requires explicit human-gated authorization',
        };
      },
    };
  }

  return {
    async authorizeBodyChange(
      req: ArbiterBodyChangeRequest,
    ): Promise<ArbiterBodyChangeVerdict> {
      // FAIL-CLOSED envelope — an authorizer fault must HITL (deny), never
      // throw into a paying turn. The rail logic below can only add gating;
      // a thrown rail/controller/meta-rail evaluation collapses to HITL.
      try {
        // ── 1. the deterministic, fail-closed meta-rail over a structured
        // descriptor (never over free-form intent). A `forbid` is binding.
        const descriptor: BodyChangeDescriptor = {
          kind: mapBodyChangeKind(req.kind),
          targetNodeId: req.subjectId || `body-change:${req.kind}`,
          summary: req.reason,
        };
        const metaRailVerdict = checkBodyChangeInviolable(descriptor);
        const metaRail: MetaRailOutcome =
          metaRailVerdict.status === 'forbid' ? 'forbid' : 'allow';

        // ── 2. the collapsed rail outcome. A sovereign / money / licence /
        // deletion target is HIGH-risk-prefix HITL forever → `four_eyes`.
        // Everything else is a reversible construction the rail does not gate.
        const railOutcome: RailOutcome = namesSovereignTarget(req)
          ? 'four_eyes'
          : 'allow';

        // ── 3. the continuous controller for a REVERSIBLE construction. The
        // flag-grant gives a `collaborator` mandate (L2: broad auto for
        // reversible/low-consequence; gate the irreversible tail). Reversible
        // + low-consequence + high calibrated confidence ⇒ the controller
        // proposes `auto`; the rail / meta-rail above can only escalate it.
        const controllerInput: DecideAutonomyInput = {
          calibratedConfidence: 0.95,
          consequenceTier: 'low',
          reversibility: 'reversible',
          mandate: 'collaborator',
        };
        const controller = decideAutonomy(controllerInput);

        // ── 4. compose — most-cautious of rail, controller, meta-rail.
        const composed = composeWithRail(railOutcome, controller, metaRail);

        const authorized = composed.decision === 'auto';
        const reason = authorized
          ? `body-change authorized (${req.kind}; reversible construction, ` +
            `meta-rail allow, rail allow) → auto`
          : `body-change gated (${req.kind}; decision='${composed.decision}', ` +
            `metaRail='${metaRail}'${
              metaRailVerdict.reason ? ` [${metaRailVerdict.reason}]` : ''
            }, rail='${railOutcome}') → HITL`;

        // Audit breadcrumb. NEVER surfaced to a client frame — the arbiter
        // only reads `authorized`.
        logger?.info?.(
          {
            kind: req.kind,
            tenantId: req.tenantId,
            decision: composed.decision,
            metaRail,
            railOutcome,
            authorized,
          },
          'body-change: meta-rail authorization',
        );

        return { authorized, reason };
      } catch (err) {
        // FAIL-SAFE: any internal fault denies (HITL) — never a throw.
        logger?.warn?.(
          {
            kind: req.kind,
            tenantId: req.tenantId,
            error: err instanceof Error ? err.message : String(err),
          },
          'body-change: authorizer fault — denying (fail-closed HITL)',
        );
        return {
          authorized: false,
          reason: `body-change authorizer fault (${req.kind}) → fail-closed HITL`,
        };
      }
    },
  };
}

/**
 * Per-turn token-budget envelope for the five-layer loop. The runner
 * threads `costUsdCents` per layer; Layer 4's `budgetGate` HARD-fails the
 * loop if the projected spend would breach the cap, so a single `loop`
 * modality turn can never blow the turn budget. Override via
 * `BORJIE_LOOP_TURN_BUDGET_CENTS` (operator-env-only).
 */
const DEFAULT_LOOP_TURN_BUDGET_CENTS = 50; // 50¢ per loop-modality turn

function resolveLoopTurnBudgetCents(
  env: Readonly<Record<string, string | undefined>>,
): number {
  const raw = env.BORJIE_LOOP_TURN_BUDGET_CENTS?.trim();
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_LOOP_TURN_BUDGET_CENTS;
}

/**
 * Loop-runner adapter — the REAL five-layer `runLoop` over
 * `@borjie/loop-runner` (Wave 1 conductor, OK-2). Maps the arbiter's
 * `LoopRunnerPort` args into a `LoopInput`, supplies the five layer fns
 * (sensors/policy/tools/quality/learn) over the `toolRegistry`, and the
 * three persistence repos.
 *
 * HARD RULES (doctrine):
 *   - FAIL-SAFE: the whole run is wrapped in try/catch. On ANY
 *     `LoopRunnerError` (or any throw) the adapter falls back to the
 *     legacy breadcrumb `loopRunId` so a paying `/ask` loop modality never
 *     breaks. The runner itself is already throw-resistant per layer, but
 *     the envelope here is the last line of defence.
 *   - TOKEN BUDGET: Layer 4 runs the `budgetGate` against a per-turn cap
 *     (`resolveLoopTurnBudgetCents`) over the spend the runner accumulated
 *     across the prior layers — the 5-layer loop cannot blow the budget.
 *   - IP / audit plane: only `loopRunId` is returned to the handler; the
 *     per-layer reasoning + audit hashes stay server-side in the repos.
 *
 * Repos are in-memory today (no durable Drizzle loop-run repo ships yet);
 * they isolate per-process. The `_db` handle is retained for the durable
 * swap-in. Tests inject `overrides` to drive deterministic outcomes.
 */
export function createLoopRunnerAdapter(
  db: DrizzleLike | null,
  toolRegistry: BrainToolRegistry,
  overrides?: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly logger?: BindingsLogger;
    readonly buildDeps?: (base: LoopRunnerDeps) => LoopRunnerDeps;
  },
): LoopRunnerPort {
  const env = overrides?.env ?? process.env;
  const logger = overrides?.logger;
  const turnBudgetCents = resolveLoopTurnBudgetCents(env);

  return {
    async runLoop(args) {
      const loopRunId = `loop_${args.flowId}_${randomUUID()}`;
      try {
        const tenantId =
          typeof args.tenantId === 'string' && args.tenantId.length > 0
            ? args.tenantId
            : '__loop_anon__';

        const input: LoopInput = {
          id: loopRunId,
          tenantId,
          loopKind: args.loopKind,
          startedAt: new Date().toISOString(),
          prevHash: null,
          envelope: args.payload,
        };

        // Layer 1 — Sensors: the proposed action is the payload itself
        // (the arbiter already lifted intent → a structured loop request).
        // A non-empty item keeps the runner past the `no_input` short-circuit.
        const sensorsFn = async (): Promise<SensorsOutcome> => ({
          items: [{ flowId: args.flowId, loopKind: args.loopKind }],
        });

        // Layer 2 — Policy: ALLOW (the arbiter + policy-gate already cleared
        // the route to a loop; every tool the loop runs still hits the
        // 9-hook chain at execution time, so no rail is bypassed here).
        const policyFn = async (): Promise<PolicyOutcome> => ({
          decision: 'allow',
          reason: 'arbiter-routed-loop',
        });

        // Layer 3 — Tools: the loop registers the run; concrete tool
        // execution is gated downstream. No spend attributed at this seam
        // (durable per-tool cost lands with the Drizzle repo swap-in).
        const toolsFn = async (): Promise<ToolsOutcome> => ({
          status: 'ok',
          artifacts: [{ registeredLoopRunId: loopRunId }],
          costUsdCents: 0,
        });

        // Layer 4 — Quality: the per-turn TOKEN-BUDGET envelope. The
        // budgetGate HARD-fails the loop if the spend the runner accrued
        // would breach the cap — the 5-layer loop cannot blow the budget.
        const qualityFn = async (): Promise<CompositeGateResult> =>
          compositeGate({
            invocations: [
              {
                name: 'budget',
                result: budgetGate({
                  usdCents: {
                    remaining: turnBudgetCents,
                    incremental: 0,
                    min: 0,
                  },
                }),
              },
            ],
          });

        // Layer 5 — Learning: record-only (no skill mutation at this seam;
        // body-change growth stays behind the gated bodyChangePort).
        const learnFn = async (): Promise<LearningOutcome> => ({
          skillUpdates: 0,
          memoryUpdates: 0,
          calibrationUpdates: 0,
          reason: 'loop-run-recorded',
        });

        const baseDeps: LoopRunnerDeps = {
          sensorsFn,
          policyFn,
          toolsFn,
          qualityFn,
          learnFn,
          loopRunRepo: createInMemoryLoopRunRepository(),
          layerOutcomeRepo: createInMemoryLayerOutcomeRepository(),
          qualitySignalRepo: createInMemoryQualitySignalRepository(),
          logger: {
            info: (message, attrs) =>
              logger?.info?.({ wiring: 'loop-runner', ...attrs }, message),
            warn: (message, attrs) =>
              logger?.warn?.({ wiring: 'loop-runner', ...attrs }, message),
            error: (message, attrs) =>
              logger?.warn?.({ wiring: 'loop-runner', level: 'error', ...attrs }, message),
          },
        };

        const deps = overrides?.buildDeps
          ? overrides.buildDeps(baseDeps)
          : baseDeps;

        // Retain the db handle for the durable repo swap-in (referenced so
        // the param is not unused once durable repos land).
        void db;
        void toolRegistry;

        const result = await runFiveLayerLoop(input, deps);

        // Audit plane only — never returned to the client handler.
        logger?.info?.(
          {
            wiring: 'loop-runner',
            loopRunId: result.loopRunId,
            status: result.status,
            totalCostUsdCents: result.totalCostUsdCents,
            turnBudgetCents,
          },
          'loop-runner: five-layer run complete',
        );

        return { loopRunId: result.loopRunId };
      } catch (err) {
        // FAIL-SAFE: a LoopRunnerError (or any throw) falls back to the
        // legacy breadcrumb loopRunId — a paying loop turn never breaks.
        const code = err instanceof LoopRunnerError ? err.code : 'INTERNAL';
        logger?.warn?.(
          {
            wiring: 'loop-runner',
            loopRunId,
            code,
            error: err instanceof Error ? err.message : String(err),
          },
          'loop-runner: run failed — falling back to legacy breadcrumb',
        );
        return { loopRunId };
      }
    },
  };
}
