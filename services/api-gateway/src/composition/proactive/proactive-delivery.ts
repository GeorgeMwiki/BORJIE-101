/**
 * Proactive delivery — drain inboxes onto the cockpit SSE bus.
 *
 * Two drains, both tenant-scoped (the caller binds the tenant GUC before
 * invoking) and both idempotent so a row is delivered to the owner tray at
 * most once per cooldown:
 *
 *   1. drainTabProposalsInbox — reads OPEN `tab_proposals_inbox` rows
 *      (not accepted, not dismissed, not surfaced within the cooldown) and
 *      publishes a `cockpit.tab.proposed` event — the SAME event the
 *      owner-web tray already consumes via `/api/v1/cockpit/stream`. After
 *      a successful publish it stamps `last_surfaced_at = now()` so the
 *      next pass skips the row until the cooldown elapses (idempotent
 *      delivery). This is the seam the tab-suggester was missing: rows it
 *      writes now actually reach the UI.
 *
 *   2. drainProactiveNudges — minimal consumer for kernel `proactive_nudge`
 *      rows in `tab_event_log` (item (c) of the audit: written with zero
 *      consumers). Surfaces each un-delivered nudge onto the cockpit bus as
 *      a `decision.recorded` pulse and marks it delivered in its snapshot so
 *      it is not re-emitted. Safe no-op when no such rows exist.
 *
 * Pino only; never throws out of the drain — a publish/stamp failure is
 * logged and the loop continues with the next row.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { CockpitEvent } from '../../services/cockpit-events/index.js';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/** Re-surface an unresolved proposal at most once per this window. */
const SURFACE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const wrapped = result as { rows?: ReadonlyArray<Record<string, unknown>> };
  return wrapped?.rows ?? [];
}

function asEvidenceIds(raw: unknown): ReadonlyArray<string> {
  if (Array.isArray(raw)) {
    return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (v): v is string => typeof v === 'string' && v.length > 0,
        );
      }
    } catch {
      /* fall through */
    }
  }
  return [];
}

export interface DrainTabProposalsInput {
  readonly db: DbLike;
  readonly tenantId: string;
  readonly logger: Logger;
  readonly publish: (event: CockpitEvent) => number;
  /** Override the re-surface cooldown (ms). Defaults to 1h. */
  readonly cooldownMs?: number;
  /** Cap rows drained per pass (defence against a backlog flood). */
  readonly limit?: number;
}

/**
 * Drain open `tab_proposals_inbox` rows for one tenant onto the cockpit bus.
 * Returns the count of proposals published.
 *
 * Idempotency: a row is eligible only when `accepted_at` / `dismissed_at`
 * are NULL AND it was not surfaced within `cooldownMs`. After publishing we
 * stamp `last_surfaced_at` so the same row is not re-delivered until the
 * cooldown elapses. The Borjie evidence rule is enforced too — rows with an
 * empty `evidence_ids` array are skipped (the Auditor would reject them).
 */
export async function drainTabProposalsInbox(
  input: DrainTabProposalsInput,
): Promise<number> {
  const { db, tenantId, logger, publish } = input;
  const cooldownMs = input.cooldownMs ?? SURFACE_COOLDOWN_MS;
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const cutoffIso = new Date(Date.now() - cooldownMs).toISOString();

  let rows: ReadonlyArray<Record<string, unknown>>;
  try {
    rows = rowsOf(
      await db.execute(sql`
        SELECT id, user_id, tab_type, title_en, title_sw,
               reason_en, reason_sw, evidence_ids, confidence
          FROM tab_proposals_inbox
         WHERE tenant_id = ${tenantId}
           AND accepted_at  IS NULL
           AND dismissed_at IS NULL
           AND (last_surfaced_at IS NULL OR last_surfaced_at < ${cutoffIso}::timestamptz)
         ORDER BY created_at ASC
         LIMIT ${limit}
      `),
    );
  } catch (err) {
    logger.warn(
      {
        worker: 'proactive-scheduler',
        tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'proactive: tab_proposals_inbox read failed',
    );
    return 0;
  }

  let published = 0;
  const nowIso = new Date().toISOString();
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : String(row.id ?? '');
    const userId = typeof row.user_id === 'string' ? row.user_id : null;
    const tabType = typeof row.tab_type === 'string' ? row.tab_type : null;
    const titleEn = typeof row.title_en === 'string' ? row.title_en : null;
    const reasonEn = typeof row.reason_en === 'string' ? row.reason_en : null;
    const evidenceIds = asEvidenceIds(row.evidence_ids);

    // Defence-in-depth grounding check: never surface an evidence-free
    // proposal (CLAUDE.md evidence-required rule).
    if (!id || !userId || !tabType || !titleEn || !reasonEn || evidenceIds.length === 0) {
      logger.warn(
        { worker: 'proactive-scheduler', tenantId, proposalId: id },
        'proactive: skipped malformed/evidence-free tab proposal',
      );
      continue;
    }

    const confidence =
      typeof row.confidence === 'number'
        ? row.confidence
        : row.confidence == null
          ? null
          : Number(row.confidence);
    const reasonSw = typeof row.reason_sw === 'string' ? row.reason_sw : null;

    try {
      publish({
        kind: 'cockpit.tab.proposed',
        tenantId,
        emittedAt: nowIso,
        userId,
        proposalId: id,
        tabType,
        title: titleEn,
        reasonEn,
        reasonSw,
        evidenceIds,
        confidence: Number.isFinite(confidence as number) ? (confidence as number) : null,
      });
      // Stamp AFTER a successful publish so a publish failure leaves the
      // row eligible for the next pass (at-least-once delivery, deduped by
      // the cooldown window).
      await db.execute(sql`
        UPDATE tab_proposals_inbox
           SET last_surfaced_at = ${nowIso}::timestamptz
         WHERE tenant_id = ${tenantId} AND id = ${id}
      `);
      published += 1;
    } catch (err) {
      logger.warn(
        {
          worker: 'proactive-scheduler',
          tenantId,
          proposalId: id,
          err: err instanceof Error ? err.message : String(err),
        },
        'proactive: failed to deliver tab proposal',
      );
    }
  }
  return published;
}

export interface DrainProactiveNudgesInput {
  readonly db: DbLike;
  readonly tenantId: string;
  readonly logger: Logger;
  readonly publish: (event: CockpitEvent) => number;
  readonly limit?: number;
}

/**
 * Minimal consumer for kernel `proactive_nudge` rows in `tab_event_log`.
 *
 * Until this drain those rows were written with ZERO consumers (audit gap
 * (c)). We surface each not-yet-delivered nudge onto the cockpit bus as a
 * `decision.recorded` pulse (the closest existing, owner-visible event
 * kind) and flag `snapshot.delivered = true` so it is emitted at most once.
 *
 * Eligibility: `event_kind = 'proactive_nudge'` AND the snapshot does not
 * already carry `delivered: true`. Safe no-op when there are no such rows.
 */
export async function drainProactiveNudges(
  input: DrainProactiveNudgesInput,
): Promise<number> {
  const { db, tenantId, logger, publish } = input;
  const limit = Math.min(100, Math.max(1, input.limit ?? 25));

  let rows: ReadonlyArray<Record<string, unknown>>;
  try {
    rows = rowsOf(
      await db.execute(sql`
        SELECT id, proposal_id, persona_id, snapshot, notes, created_at
          FROM tab_event_log
         WHERE tenant_id  = ${tenantId}
           AND event_kind = 'proactive_nudge'
           AND COALESCE((snapshot ->> 'delivered')::boolean, false) = false
         ORDER BY created_at ASC
         LIMIT ${limit}
      `),
    );
  } catch (err) {
    // The table / column may be absent in some deployments — degrade to 0.
    logger.debug(
      {
        worker: 'proactive-scheduler',
        tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'proactive: proactive_nudge drain query skipped',
    );
    return 0;
  }

  let delivered = 0;
  const nowIso = new Date().toISOString();
  for (const row of rows) {
    const id = typeof row.id === 'string' ? row.id : String(row.id ?? '');
    if (!id) continue;
    const notes = typeof row.notes === 'string' && row.notes.length > 0 ? row.notes : 'Mr. Mwikila has a proactive suggestion for you.';
    try {
      publish({
        kind: 'decision.recorded',
        tenantId,
        emittedAt: nowIso,
        decisionId: id,
        subject: notes.slice(0, 200),
        severity: 'low',
      });
      await db.execute(sql`
        UPDATE tab_event_log
           SET snapshot = jsonb_set(
                 COALESCE(snapshot, '{}'::jsonb),
                 '{delivered}',
                 'true'::jsonb,
                 true
               )
         WHERE tenant_id = ${tenantId} AND id = ${id}
      `);
      delivered += 1;
    } catch (err) {
      logger.warn(
        {
          worker: 'proactive-scheduler',
          tenantId,
          nudgeId: id,
          err: err instanceof Error ? err.message : String(err),
        },
        'proactive: failed to deliver proactive_nudge',
      );
    }
  }
  if (delivered > 0) {
    logger.info(
      { worker: 'proactive-scheduler', tenantId, delivered },
      'proactive: surfaced kernel proactive_nudge rows to cockpit',
    );
  }
  return delivered;
}
