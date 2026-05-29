/**
 * Audit-verification cron supervisor — Phase D D2.
 *
 * The platform's tamper-evident audit chain (ai_audit_chain — migration
 * 0127) is hash-linked but, until this supervisor lands, was only ever
 * verified on the admin HTTP surface. A silent post-hoc tamper would
 * slip past until an operator decided to look. This cron closes that
 * gap with two cadences:
 *
 *   - Every `sampleIntervalMs` (default 15 min) call
 *     `verifyRandomSample(tenantId, p=0.05)` for every active tenant.
 *     Cheap; recomputes ~5% of rows per cycle. Tamper detection latency
 *     is bounded by P/(p * cycles) — at p=0.05 + 96 cycles/day the
 *     expected detection lag is ~5h for a single tampered row.
 *
 *   - Every `chainIntervalMs` (default 24h) call `verifyLedgerChain
 *     (tenantId)` — full walk. OOM-safe (streamed in 500-row batches by
 *     the chain implementation). Catches anything the sample missed
 *     within a day-of-tamper SLO.
 *
 * On any failed verdict the supervisor:
 *
 *   1. Logs a structured ERROR at `logger.error` (Sentry/Slack hook is
 *      OPEN — log + emit only; integration teams wire alerting
 *      downstream).
 *   2. Emits a `ai-audit.tampered` event on the shared bus carrying
 *      the broken-row metadata so the operator dashboard can highlight
 *      affected tenants without re-running the verify themselves.
 *
 * SIGTERM-safe: `.stop()` clears both timers; idempotent. In-flight
 * tick is guarded — a slow verify won't overlap with the next tick.
 *
 * Degraded mode:
 *   When `verifier` is null (no audit chain wired) the supervisor logs
 *   once on `.start()` and returns immediately. Same contract as
 *   wake-loop-cron + sovereign-ledger-verify-cron.
 *
 * Tests inject `verifier`, `listActiveTenantIds`, `logger`, `eventBus`
 * — no external surface couples this file to a specific Drizzle binding.
 */

import { sql } from 'drizzle-orm';

const DEFAULT_SAMPLE_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_CHAIN_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const DEFAULT_SAMPLE_P = 0.05;

const MIN_INTERVAL_MS = 60 * 1000; // 1 minute floor
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7-day ceiling

// ─────────────────────────────────────────────────────────────────────
// Port shapes — duck-typed against the audit-hash-chain primitive.
// ─────────────────────────────────────────────────────────────────────

export interface AuditVerifyResult {
  readonly valid: boolean;
  readonly entriesChecked: number;
  readonly brokenAt?: number | string;
  readonly error?: string;
}

export interface AuditChainVerifierPort {
  /**
   * Spot-check each row with sampling probability `p` ∈ (0, 1]. Used by
   * the 15-minute cadence.
   */
  verifyRandomSample(
    tenantId: string,
    p: number,
  ): Promise<AuditVerifyResult>;
  /**
   * Walk the full chain. Used by the nightly cadence. OOM-safe in the
   * upstream implementation.
   */
  verifyLedgerChain(tenantId: string): Promise<AuditVerifyResult>;
}

interface EventBusLike {
  publish?: (env: unknown) => Promise<void> | void;
}

export interface AuditVerifyCronLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error?(obj: Record<string, unknown>, msg?: string): void;
}

export interface AuditVerifyCronDeps {
  /**
   * Verifier port. Null in degraded mode (no audit chain wired) — the
   * supervisor logs once on start and returns.
   */
  readonly verifier: AuditChainVerifierPort | null;
  /** Drizzle client used by the default tenant discovery. Optional —
   *  callers can supply `listActiveTenantIds` directly. */
  readonly db?: unknown | null;
  /** Test hook: override active-tenant discovery. */
  readonly listActiveTenantIds?: () => Promise<ReadonlyArray<string>>;
  /** Shared event bus. Optional — supervisor still verifies but cannot
   *  emit observability events. */
  readonly eventBus?: EventBusLike | null;
  readonly logger: AuditVerifyCronLogger;
  /** Sample cadence in ms. Bounded to [60s, 7d]. */
  readonly sampleIntervalMs?: number;
  /** Full-chain cadence in ms. Bounded to [60s, 7d]. */
  readonly chainIntervalMs?: number;
  /** Sample probability p ∈ (0, 1]. Default 0.05. */
  readonly sampleP?: number;
}

export interface AuditVerifyCronTickResult {
  readonly mode: 'sample' | 'chain';
  readonly tenantsProcessed: number;
  readonly okCount: number;
  readonly tamperedCount: number;
  readonly skippedReason: 'no-verifier' | 'no-tenants' | 'inflight' | null;
  readonly verdicts: ReadonlyArray<{
    readonly tenantId: string;
    readonly ok: boolean;
    readonly entriesChecked: number;
    readonly brokenAt?: number | string;
    readonly error?: string;
  }>;
}

export interface AuditVerifyCronSupervisor {
  start(): void;
  stop(): void;
  /** Run one SAMPLE tick synchronously. Returns null on supervisor error. */
  tickSample(): Promise<AuditVerifyCronTickResult | null>;
  /** Run one FULL-CHAIN tick synchronously. Returns null on supervisor error. */
  tickChain(): Promise<AuditVerifyCronTickResult | null>;
  readonly sampleIntervalMs: number;
  readonly chainIntervalMs: number;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function clampInterval(
  candidate: number | undefined,
  fallback: number,
): number {
  const value =
    typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
      ? candidate
      : fallback;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(value)));
}

function clampSampleP(candidate: number | undefined): number {
  if (
    typeof candidate !== 'number' ||
    !Number.isFinite(candidate) ||
    candidate <= 0 ||
    candidate > 1
  ) {
    return DEFAULT_SAMPLE_P;
  }
  return candidate;
}

interface DrizzleLikeClient {
  execute(q: unknown): Promise<unknown>;
}

async function defaultListActiveTenantIds(
  db: DrizzleLikeClient,
): Promise<ReadonlyArray<string>> {
  try {
    const result = (await db.execute(
      sql`SELECT id FROM tenants WHERE status = 'active'`,
    )) as unknown;
    const rows = Array.isArray(result)
      ? (result as ReadonlyArray<{ id?: unknown }>)
      : (((result as { rows?: ReadonlyArray<{ id?: unknown }> })?.rows ??
          []) as ReadonlyArray<{ id?: unknown }>);
    return rows
      .map((r) => (typeof r.id === 'string' ? r.id : String(r.id ?? '')))
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

async function emitTampered(
  bus: EventBusLike | null | undefined,
  mode: 'sample' | 'chain',
  tenantId: string,
  result: AuditVerifyResult,
): Promise<void> {
  if (!bus || typeof bus.publish !== 'function') return;
  try {
    await bus.publish({
      event: {
        eventId: `audit_tampered_${mode}_${Date.now()}_${Math.random()
          .toString(36)
          .slice(2, 8)}`,
        eventType: 'ai-audit.tampered',
        timestamp: new Date().toISOString(),
        tenantId,
        correlationId: `audit_verify_cron_${Date.now()}`,
        causationId: null,
        metadata: { source: 'audit-verify-cron', mode },
        payload: {
          tenantId,
          mode,
          entriesChecked: result.entriesChecked,
          brokenAt: result.brokenAt ?? null,
          error: result.error ?? null,
        },
      } as unknown,
      version: 1,
      aggregateId: tenantId,
      aggregateType: 'AiAuditChain',
    } as never);
  } catch {
    // Bus failures are non-fatal; the next tick will retry and the
    // verdict itself is durable in the chain.
  }
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createAuditVerifyCronSupervisor(
  deps: AuditVerifyCronDeps,
): AuditVerifyCronSupervisor {
  const sampleIntervalMs = clampInterval(
    deps.sampleIntervalMs,
    DEFAULT_SAMPLE_INTERVAL_MS,
  );
  const chainIntervalMs = clampInterval(
    deps.chainIntervalMs,
    DEFAULT_CHAIN_INTERVAL_MS,
  );
  const sampleP = clampSampleP(deps.sampleP);

  let sampleHandle: ReturnType<typeof setInterval> | null = null;
  let chainHandle: ReturnType<typeof setInterval> | null = null;
  let sampleInflight = false;
  let chainInflight = false;

  async function listActive(): Promise<ReadonlyArray<string>> {
    if (deps.listActiveTenantIds) return deps.listActiveTenantIds();
    if (!deps.db) return [];
    return defaultListActiveTenantIds(deps.db as DrizzleLikeClient);
  }

  async function runTick(
    mode: 'sample' | 'chain',
  ): Promise<AuditVerifyCronTickResult | null> {
    const inflight = mode === 'sample' ? sampleInflight : chainInflight;
    if (inflight) {
      return {
        mode,
        tenantsProcessed: 0,
        okCount: 0,
        tamperedCount: 0,
        verdicts: [],
        skippedReason: 'inflight',
      };
    }
    if (mode === 'sample') sampleInflight = true;
    else chainInflight = true;
    try {
      if (!deps.verifier) {
        deps.logger.warn(
          { mode },
          'audit-verify-cron: no verifier — supervisor is no-op',
        );
        return {
          mode,
          tenantsProcessed: 0,
          okCount: 0,
          tamperedCount: 0,
          verdicts: [],
          skippedReason: 'no-verifier',
        };
      }
      const tenantIds = await listActive();
      if (tenantIds.length === 0) {
        deps.logger.info(
          { mode },
          'audit-verify-cron: no active tenants — skipping cycle',
        );
        return {
          mode,
          tenantsProcessed: 0,
          okCount: 0,
          tamperedCount: 0,
          verdicts: [],
          skippedReason: 'no-tenants',
        };
      }
      const verdicts: Array<{
        tenantId: string;
        ok: boolean;
        entriesChecked: number;
        brokenAt?: number | string;
        error?: string;
      }> = [];
      let okCount = 0;
      let tamperedCount = 0;
      for (const tenantId of tenantIds) {
        let result: AuditVerifyResult;
        try {
          if (mode === 'sample') {
            result = await deps.verifier.verifyRandomSample(tenantId, sampleP);
          } else {
            result = await deps.verifier.verifyLedgerChain(tenantId);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          deps.logger.warn(
            { tenantId, mode, err: msg },
            'audit-verify-cron: verify threw',
          );
          tamperedCount += 1;
          verdicts.push({
            tenantId,
            ok: false,
            entriesChecked: 0,
            error: `verify-threw:${msg}`,
          });
          continue;
        }
        if (result.valid) {
          okCount += 1;
          verdicts.push({
            tenantId,
            ok: true,
            entriesChecked: result.entriesChecked,
          });
        } else {
          tamperedCount += 1;
          const verdict: {
            tenantId: string;
            ok: boolean;
            entriesChecked: number;
            brokenAt?: number | string;
            error?: string;
          } = {
            tenantId,
            ok: false,
            entriesChecked: result.entriesChecked,
          };
          if (result.brokenAt !== undefined) verdict.brokenAt = result.brokenAt;
          if (result.error) verdict.error = result.error;
          verdicts.push(verdict);
          const errLog = deps.logger.error ?? deps.logger.warn;
          errLog(
            {
              tenantId,
              mode,
              brokenAt: result.brokenAt ?? null,
              entriesChecked: result.entriesChecked,
              error: result.error ?? null,
            },
            'audit-verify-cron: AI AUDIT CHAIN TAMPER DETECTED',
          );
          await emitTampered(deps.eventBus, mode, tenantId, result);
        }
      }
      deps.logger.info(
        {
          mode,
          tenants: tenantIds.length,
          okCount,
          tamperedCount,
        },
        'audit-verify-cron: cycle complete',
      );
      return {
        mode,
        tenantsProcessed: tenantIds.length,
        okCount,
        tamperedCount,
        verdicts,
        skippedReason: null,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const errLog = deps.logger.error ?? deps.logger.warn;
      errLog({ mode, err: msg }, 'audit-verify-cron: tick failed');
      return null;
    } finally {
      if (mode === 'sample') sampleInflight = false;
      else chainInflight = false;
    }
  }

  return {
    sampleIntervalMs,
    chainIntervalMs,
    async tickSample() {
      return runTick('sample');
    },
    async tickChain() {
      return runTick('chain');
    },
    start() {
      if (!sampleHandle) {
        sampleHandle = setInterval(() => void runTick('sample'), sampleIntervalMs);
        if (typeof sampleHandle.unref === 'function') sampleHandle.unref();
      }
      if (!chainHandle) {
        chainHandle = setInterval(() => void runTick('chain'), chainIntervalMs);
        if (typeof chainHandle.unref === 'function') chainHandle.unref();
      }
      deps.logger.info(
        { sampleIntervalMs, chainIntervalMs, sampleP },
        'audit-verify-cron: started',
      );
    },
    stop() {
      if (sampleHandle) {
        clearInterval(sampleHandle);
        sampleHandle = null;
      }
      if (chainHandle) {
        clearInterval(chainHandle);
        chainHandle = null;
      }
      deps.logger.info({}, 'audit-verify-cron: stopped');
    },
  };
}
