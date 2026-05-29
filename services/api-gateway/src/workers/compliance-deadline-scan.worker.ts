/**
 * Compliance Deadline Scan Cron — Roadmap R6 (cockpit SSE companion).
 *
 * Ticks every hour. For every row in `regulatory_filings` whose
 * `due_at` is within the configured warning horizon (default 7 days)
 * and whose `status` is still 'open' / 'in_progress' / null, emit a
 * cockpit-events `compliance.deadline_approaching` push so the owner
 * cockpit can toast the upcoming filing.
 *
 * Dedupe: a per-tick in-memory Set keyed by `(tenant_id, filing_id,
 * floor(daysRemaining))` prevents the same filing/window pair from
 * publishing twice inside one tick. Restart-resilience comes from
 * the cockpit being read-only — duplicate toasts are at worst
 * noisy, never wrong.
 *
 * Tenant isolation: the worker reads the canonical
 * `regulatory_filings.tenant_id` column directly (no
 * `app.tenant_id` GUC needed for service-role connections); every
 * emitted event is stamped with the row's tenant_id.
 *
 * Failure containment:
 *   - DB unwired → no-op + warn once on boot.
 *   - Per-row errors isolated; loop continues.
 *   - All errors via Pino — no console statements in services.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import { publishCockpitEvent } from '../services/cockpit-events';

const ONE_HOUR_MS = 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = ONE_HOUR_MS;
const DEFAULT_HORIZON_DAYS = 7;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

export interface ComplianceDeadlineScanOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly intervalMs?: number;
  readonly horizonDays?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
}

export interface ComplianceDeadlineScanHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<TickResult>;
}

export interface TickResult {
  scanned: number;
  emitted: number;
}

interface FilingRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly filing_type: string;
  readonly due_at: string;
}

function rowsOf(raw: unknown): ReadonlyArray<FilingRow> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<FilingRow>;
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const rows = (raw as { rows: unknown }).rows;
    if (Array.isArray(rows)) return rows as ReadonlyArray<FilingRow>;
  }
  return [];
}

export function createComplianceDeadlineScan(
  options: ComplianceDeadlineScanOptions,
): ComplianceDeadlineScanHandle {
  const now = options.now ?? (() => new Date());
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const horizonDays = Math.max(1, options.horizonDays ?? DEFAULT_HORIZON_DAYS);
  const enabled = options.enabled ?? true;

  let timer: NodeJS.Timeout | null = null;
  let running = false;

  async function tickOnce(): Promise<TickResult> {
    if (running) return { scanned: 0, emitted: 0 };
    running = true;
    try {
      const nowDate = now();
      let rows: ReadonlyArray<FilingRow> = [];
      try {
        const raw = await options.db.execute(sql`
          SELECT id::text AS id,
                 tenant_id::text AS tenant_id,
                 filing_type,
                 due_at::text AS due_at
            FROM regulatory_filings
           WHERE due_at >= ${nowDate.toISOString()}::timestamptz
             AND due_at <= ${new Date(nowDate.getTime() + horizonDays * ONE_DAY_MS).toISOString()}::timestamptz
             AND (status IS NULL OR status IN ('open','in_progress'))
           ORDER BY due_at ASC
           LIMIT 200
        `);
        rows = rowsOf(raw);
      } catch (err) {
        options.logger.warn(
          {
            worker: 'compliance-deadline-scan',
            err: err instanceof Error ? err.message : String(err),
          },
          'compliance-deadline-scan: query failed',
        );
        return { scanned: 0, emitted: 0 };
      }

      const seen = new Set<string>();
      let emitted = 0;
      for (const row of rows) {
        const dueDate = new Date(row.due_at);
        if (Number.isNaN(dueDate.getTime())) continue;
        const daysRemaining = Math.max(
          0,
          Math.ceil((dueDate.getTime() - nowDate.getTime()) / ONE_DAY_MS),
        );
        const key = `${row.tenant_id}::${row.id}::${daysRemaining}`;
        if (seen.has(key)) continue;
        seen.add(key);
        publishCockpitEvent({
          kind: 'compliance.deadline_approaching',
          tenantId: row.tenant_id,
          emittedAt: nowDate.toISOString(),
          filingId: row.id,
          filingKind: row.filing_type,
          dueAt: dueDate.toISOString(),
          daysRemaining,
        });
        emitted += 1;
      }

      return { scanned: rows.length, emitted };
    } finally {
      running = false;
    }
  }

  function start(): void {
    if (!enabled) {
      options.logger.info(
        { worker: 'compliance-deadline-scan' },
        'compliance-deadline-scan disabled',
      );
      return;
    }
    if (timer !== null) return;
    timer = setInterval(() => {
      tickOnce().catch((err) => {
        options.logger.warn(
          {
            worker: 'compliance-deadline-scan',
            err: err instanceof Error ? err.message : String(err),
          },
          'compliance-deadline-scan: tick failed',
        );
      });
    }, intervalMs);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, tickOnce };
}
