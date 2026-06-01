/**
 * Drizzle-backed adapters for the tab-suggester (CT-6).
 *
 * The suggester runner (`services/tab-suggester/runner.ts`) is pluggable:
 * it takes a `SuggesterObservations` accessor (the activity feeds it scans)
 * and a `SuggesterPersistence` (dedup-check + insert into
 * `tab_proposals_inbox`). These adapters are the production wiring the
 * scheduler injects.
 *
 * Tenant-scoping: the caller (proactive-wiring) binds the tenant GUC before
 * each tick, and every query also carries `tenant_id` in its WHERE/INSERT
 * so RLS FORCE holds even on the out-of-band worker path.
 *
 * Degraded-safe: the observation queries return `[]` on any error so a
 * missing/empty activity feed simply yields no candidate proposals — the
 * suggester is a quiet no-op rather than a crash. The persistence insert
 * surfaces failures to the caller (the runner logs them) so a write fault
 * is never silently swallowed.
 *
 * Dedup (idempotency): `hasActiveOrCooldown` mirrors the runner's policy —
 * SKIP when an OPEN proposal for (user, tabType, detector) exists OR a
 * DISMISSED one is still inside the cooldown window. The migration's
 * `tab_proposals_inbox_dedup_idx` makes this lookup cheap.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type {
  SuggesterObservations,
  SuggesterPersistence,
} from '../../services/tab-suggester/runner.js';
import type {
  DrillDownObservation,
  MwikilaObservation,
  NavigationObservation,
} from '../../services/tab-suggester/detectors.js';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const wrapped = result as { rows?: ReadonlyArray<Record<string, unknown>> };
  return wrapped?.rows ?? [];
}

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(0);
}

/**
 * Live observation feeds backed by `tab_event_log` (the brain↔tab loop
 * audit trail) — the durable record of owner navigation + drill-down +
 * Mwikila-escalation activity.
 *
 *   - drill-downs / navigations: `tab_event_log` rows where the snapshot
 *     carries a `route` (a `capture_emitted` / `proactive_nudge` trail).
 *   - mwikila actions: `mwikila_actions_inbox` proposals/executions, mapped
 *     to the tier+category the escalation detector expects.
 *
 * Every accessor is read-only, tenant-scoped, time-bounded, and degrades to
 * `[]` so the suggester never crashes on a sparse / missing feed.
 */
export function buildDrizzleSuggesterObservations(
  db: DbLike,
  logger: Logger,
): SuggesterObservations {
  async function safeRows(
    label: string,
    query: unknown,
  ): Promise<ReadonlyArray<Record<string, unknown>>> {
    try {
      return rowsOf(await db.execute(query));
    } catch (err) {
      logger.debug(
        {
          worker: 'proactive-scheduler',
          feed: label,
          err: err instanceof Error ? err.message : String(err),
        },
        'proactive: suggester observation feed degraded to []',
      );
      return [];
    }
  }

  return {
    async drillDowns({ tenantId, userId, sinceMs }): Promise<ReadonlyArray<DrillDownObservation>> {
      const sinceIso = new Date(sinceMs).toISOString();
      const rows = await safeRows(
        'drill_downs',
        sql`
          SELECT id,
                 snapshot ->> 'tabType' AS tab_type,
                 snapshot ->> 'focus'   AS focus,
                 created_at
            FROM tab_event_log
           WHERE tenant_id = ${tenantId}
             AND actor = ${'user:' + userId}
             AND snapshot ? 'tabType'
             AND snapshot ? 'focus'
             AND created_at >= ${sinceIso}::timestamptz
           ORDER BY created_at DESC
           LIMIT 500
        `,
      );
      const out: DrillDownObservation[] = [];
      for (const r of rows) {
        const tabType = typeof r.tab_type === 'string' ? r.tab_type : null;
        const focus = typeof r.focus === 'string' ? r.focus : null;
        const id = typeof r.id === 'string' ? r.id : String(r.id ?? '');
        if (!tabType || !focus || !id) continue;
        out.push({ id, tabType, focus, occurredAt: toDate(r.created_at) });
      }
      return out;
    },

    async navigations({ tenantId, userId, sinceMs }): Promise<ReadonlyArray<NavigationObservation>> {
      const sinceIso = new Date(sinceMs).toISOString();
      const rows = await safeRows(
        'navigations',
        sql`
          SELECT id,
                 snapshot ->> 'route' AS route,
                 created_at
            FROM tab_event_log
           WHERE tenant_id = ${tenantId}
             AND actor = ${'user:' + userId}
             AND snapshot ? 'route'
             AND created_at >= ${sinceIso}::timestamptz
           ORDER BY created_at DESC
           LIMIT 500
        `,
      );
      const out: NavigationObservation[] = [];
      for (const r of rows) {
        const route = typeof r.route === 'string' ? r.route : null;
        const id = typeof r.id === 'string' ? r.id : String(r.id ?? '');
        if (!route || !id) continue;
        out.push({ id, route, occurredAt: toDate(r.created_at) });
      }
      return out;
    },

    async mwikilaActions({ tenantId, sinceMs }): Promise<ReadonlyArray<MwikilaObservation>> {
      const sinceIso = new Date(sinceMs).toISOString();
      const rows = await safeRows(
        'mwikila_actions',
        sql`
          SELECT id, category, delegation_tier, proposed_at
            FROM mwikila_actions_inbox
           WHERE tenant_id = ${tenantId}
             AND proposed_at >= ${sinceIso}::timestamptz
           ORDER BY proposed_at DESC
           LIMIT 500
        `,
      );
      const out: MwikilaObservation[] = [];
      for (const r of rows) {
        const category = typeof r.category === 'string' ? r.category : null;
        const tierRaw = typeof r.delegation_tier === 'string' ? r.delegation_tier : null;
        const id = typeof r.id === 'string' ? r.id : String(r.id ?? '');
        if (!category || !tierRaw || !id) continue;
        if (tierRaw !== 'T0' && tierRaw !== 'T1' && tierRaw !== 'T2' && tierRaw !== 'T3') {
          continue;
        }
        out.push({
          id,
          category,
          tier: tierRaw,
          occurredAt: toDate(r.proposed_at),
        });
      }
      return out;
    },
  };
}

/**
 * Persistence backed by `tab_proposals_inbox`. `hasActiveOrCooldown` is the
 * dedup gate; `insertProposal` writes the row the delivery drain later
 * surfaces. Evidence ids are written as-is (the detector guarantees ≥1, and
 * the table CHECK enforces 1..5).
 */
export function buildDrizzleSuggesterPersistence(
  db: DbLike,
  logger: Logger,
): SuggesterPersistence {
  return {
    async hasActiveOrCooldown({ tenantId, userId, tabType, detector, cooldownMs }) {
      const cutoffIso = new Date(Date.now() - cooldownMs).toISOString();
      try {
        const rows = rowsOf(
          await db.execute(sql`
            SELECT 1
              FROM tab_proposals_inbox
             WHERE tenant_id = ${tenantId}
               AND user_id   = ${userId}
               AND tab_type  = ${tabType}
               AND detector  = ${detector}
               AND (
                 (accepted_at IS NULL AND dismissed_at IS NULL)
                 OR (dismissed_at IS NOT NULL AND dismissed_at >= ${cutoffIso}::timestamptz)
               )
             LIMIT 1
          `),
        );
        return rows.length > 0;
      } catch (err) {
        // Fail CLOSED on a dedup read error: better to skip a proposal than
        // to risk spamming the owner with a duplicate.
        logger.warn(
          {
            worker: 'proactive-scheduler',
            tenantId,
            err: err instanceof Error ? err.message : String(err),
          },
          'proactive: dedup check failed — skipping proposal to avoid spam',
        );
        return true;
      }
    },

    async insertProposal({ tenantId, userId, result }) {
      const rows = rowsOf(
        await db.execute(sql`
          INSERT INTO tab_proposals_inbox (
            tenant_id, user_id, tab_type, title_en, title_sw,
            reason_en, reason_sw, config, confidence, evidence_ids, detector
          ) VALUES (
            ${tenantId},
            ${userId},
            ${result.tabType},
            ${result.titleEn},
            ${result.titleSw},
            ${result.reasonEn},
            ${result.reasonSw},
            ${JSON.stringify(result.config ?? {})}::jsonb,
            ${result.confidence},
            ${JSON.stringify(result.evidenceIds)}::jsonb,
            ${result.detector}
          )
          RETURNING id
        `),
      );
      const id = rows[0]?.id;
      return typeof id === 'string' ? id : String(id ?? '');
    },
  };
}
