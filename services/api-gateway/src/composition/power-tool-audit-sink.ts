/**
 * Power-tool audit sink — bridge composed power-tool steps onto the
 * hash-chained, append-only AI audit trail.
 *
 * The Capability-Composition Engine executes its winning chain through the
 * power-tool registry. After EVERY step the registry calls `auditSink.record`
 * (see `kernel/power-tools/registry.ts::emitAudit`) — but ONLY when the
 * threaded `PowerToolContext.auditSink` is non-null. Until this adapter
 * existed the route threaded `auditSink: null`, so a composed power-tool step
 * wrote NOTHING to the audit chain — a hard-rule violation (the AI audit
 * chain is hash-chained + append-only; every executed action must land a
 * row).
 *
 * This factory maps each `PowerToolAuditRow` onto the SAME production
 * audit-trail v2 chain the auto-authorize gate already uses
 * (`auto-authorize-gate/audit.ts`): the Drizzle-backed `AuditSink` over the
 * ai-copilot `AuditTrailRecorder` (SHA-256 + HMAC chain). Mapping:
 *
 *   actionKind     = `power_tool.${row.toolId}`
 *   decision       = row.outcome === 'ok' ? 'executed' : 'denied'
 *   actor          = { kind:'ai_execution', id: row.callerId }
 *   actionCategory = 'other'   (the safe always-valid bucket)
 *   ai.attachments.powerTool = the full row (provenance for the regulator)
 *
 * Honest-degrade: a null db (degraded / test boot) yields a null sink and the
 * registry's own `emitAudit` short-circuits (it tolerates a null sink).
 * Platform-scope rows (`tenantId === null`) carry no tenant partition here, so
 * they are skipped — the audit-trail v2 chain is tenant-partitioned.
 *
 * `record()` NEVER throws — a failed audit append must not break the engine's
 * hot path (the registry already swallows sink throws, but we add our own
 * try/catch + logger.error as belt-and-braces so the gap is observable).
 *
 * The underlying Drizzle sink is memoised per-db-handle exactly like
 * `auto-authorize-gate/audit.ts` so we do not rebuild the chain plumbing on
 * every composed step.
 *
 * @module composition/power-tool-audit-sink
 */

import { powerTools } from '@borjie/central-intelligence';
import { createDrizzleAuditSinkAndReader } from './audit-sink-drizzle-adapter.js';

type PowerToolAuditRow = powerTools.PowerToolAuditRow;
type PowerToolAuditSink = powerTools.PowerToolAuditSink;

type SinkBundle = ReturnType<typeof createDrizzleAuditSinkAndReader>;

interface AuditSinkLogger {
  readonly warn?: (meta: object, msg: string) => void;
  readonly error?: (meta: object, msg: string) => void;
}

// Memoise the underlying Drizzle sink per-db-handle (mirrors
// auto-authorize-gate/audit.ts). Rebuilt only when the db identity changes.
let cachedDb: unknown = null;
let cachedSink: SinkBundle['sink'] | null = null;

/** Memoised Drizzle sink — rebuilt only when the db handle identity changes. */
function getSink(
  db: unknown,
  logger?: AuditSinkLogger,
): SinkBundle['sink'] | null {
  if (!db) return null;
  if (cachedSink && cachedDb === db) return cachedSink;
  const bundle = createDrizzleAuditSinkAndReader({
    db,
    ...(logger ? { logger } : {}),
  });
  cachedDb = db;
  cachedSink = bundle.sink;
  return cachedSink;
}

/**
 * Build a `PowerToolAuditSink` that lands every composed power-tool step on
 * the hash-chained, append-only audit trail. Returns `null` when `db` is null
 * (honest-degrade — the registry tolerates a null sink and short-circuits its
 * own `emitAudit`).
 */
export function createPowerToolAuditSink(
  db: unknown,
  logger: AuditSinkLogger,
): PowerToolAuditSink | null {
  if (!db) return null;
  return {
    async record(row: PowerToolAuditRow): Promise<void> {
      // Platform-scope rows carry no tenant partition here — the audit-trail
      // v2 chain is tenant-partitioned. Skip rather than mis-attribute.
      if (row.tenantId === null) return;
      const sink = getSink(db, logger);
      if (!sink) return;
      try {
        await sink.record({
          tenantId: row.tenantId,
          actor: { kind: 'ai_execution', id: row.callerId },
          actionKind: `power_tool.${row.toolId}`,
          actionCategory: 'other',
          decision: row.outcome === 'ok' ? 'executed' : 'denied',
          ai: {
            attachments: {
              powerTool: {
                toolId: row.toolId,
                tier: row.tier,
                inputJson: row.inputJson,
                outputJson: row.outputJson,
                outcome: row.outcome,
                errorMessage: row.errorMessage,
                approvalRecordId: row.approvalRecordId,
                destination: row.destination,
                at: row.at,
              },
            },
          },
        });
      } catch (err) {
        // Soft-fail: a failed audit append must NOT break the engine's hot
        // path. Logged so operators see the gap.
        logger.error?.(
          {
            wiring: 'power-tool-audit-sink',
            toolId: row.toolId,
            outcome: row.outcome,
            error: err instanceof Error ? err.message : String(err),
          },
          'power-tool-audit-sink: audit append failed',
        );
      }
    },
  };
}
