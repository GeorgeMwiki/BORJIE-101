/**
 * /api/v1/mining/internal/slo — per-junior, per-tenant SLO snapshot.
 *
 * SUPER_ADMIN-only. Aggregates the last 24h of:
 *   - latency p50 / p95 / p99 (from `audit_events.metadata.durationMs`)
 *   - error rate (FAILURE outcomes / total)
 *   - request volume
 *   - model spend (from `ai_cost_entries.costUsdMicro`)
 *
 * One row per (tenant, junior=actor_id) pair within the window.
 *
 * See gh-issue #24: when the dedicated `model_call_logs` table
 * lands (with per-call latency + token spend in a single store) replace
 * the audit_events join + ai_cost_entries aggregate with a single
 * percentile_cont() over that table. Until then the percentile column
 * is computed in JS over the matched audit rows.
 *
 * Migrated to `@hono/zod-openapi` (issue #60).
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { and, eq, gte, sql } from 'drizzle-orm';
import { auditEvents, aiCostEntries } from '@borjie/database';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { databaseMiddleware } from '../../../middleware/database';
import { UserRole } from '../../../types/user-role';
import { internalSloListRoute } from '../_openapi/route-defs';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

interface JuniorBucket {
  readonly tenantId: string | null;
  readonly junior: string;
  latencies: number[];
  total: number;
  failures: number;
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((pct / 100) * sorted.length),
  );
  return sorted[idx] ?? 0;
}

app.openapi(internalSloListRoute, async (c) => {
  const db = c.get('db');
  const { tenantId, junior, windowHours } = c.req.valid('query');
  const since = new Date(Date.now() - windowHours * 3_600_000);
  const conds: unknown[] = [gte(auditEvents.timestamp, since)];
  if (tenantId) conds.push(eq(auditEvents.tenantId, tenantId));
  if (junior) conds.push(eq(auditEvents.actorId, junior));
  const raw = await db
    .select({
      tenantId: auditEvents.tenantId,
      actorId: auditEvents.actorId,
      outcome: auditEvents.outcome,
      metadata: auditEvents.metadata,
    })
    .from(auditEvents)
    .where(and(...conds));
  const buckets = new Map<string, JuniorBucket>();
  for (const row of raw) {
    const key = `${row.tenantId ?? 'platform'}::${row.actorId}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        tenantId: row.tenantId,
        junior: row.actorId,
        latencies: [],
        total: 0,
        failures: 0,
      };
      buckets.set(key, bucket);
    }
    bucket.total += 1;
    if (row.outcome === 'FAILURE' || row.outcome === 'ERROR') bucket.failures += 1;
    const ms = (row.metadata as { durationMs?: number } | null)?.durationMs;
    if (typeof ms === 'number' && Number.isFinite(ms)) bucket.latencies.push(ms);
  }
  const spendConds: unknown[] = [gte(aiCostEntries.occurredAt, since)];
  if (tenantId) spendConds.push(eq(aiCostEntries.tenantId, tenantId));
  const spendRows = await db
    .select({
      tenantId: aiCostEntries.tenantId,
      operation: aiCostEntries.operation,
      costUsdMicro: sql<number>`COALESCE(SUM(${aiCostEntries.costUsdMicro}), 0)`,
    })
    .from(aiCostEntries)
    .where(and(...spendConds))
    .groupBy(aiCostEntries.tenantId, aiCostEntries.operation);
  const spendMap = new Map<string, number>();
  for (const r of spendRows) {
    spendMap.set(
      `${r.tenantId}::${r.operation ?? 'unknown'}`,
      Number(r.costUsdMicro ?? 0),
    );
  }
  const data = Array.from(buckets.values()).map((b) => {
    const sorted = [...b.latencies].sort((a, c) => a - c);
    const spendMicro =
      spendMap.get(`${b.tenantId}::${b.junior}`) ??
      spendMap.get(`${b.tenantId}::unknown`) ??
      0;
    return {
      tenantId: b.tenantId,
      junior: b.junior,
      juniorId: b.junior,
      p50ms: percentile(sorted, 50),
      p95ms: percentile(sorted, 95),
      p99ms: percentile(sorted, 99),
      errorRatePct: b.total === 0 ? 0 : Number(((b.failures / b.total) * 100).toFixed(2)),
      spendUsd: Number((spendMicro / 1_000_000).toFixed(4)),
      requestVolume24h: b.total,
    };
  });
  return c.json({ success: true as const, data }, 200);
});

export const miningInternalSloRouter = app;
