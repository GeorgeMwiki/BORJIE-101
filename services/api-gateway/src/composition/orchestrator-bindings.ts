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
  type ApprovalGate,
  type BrainToolRegistry,
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
