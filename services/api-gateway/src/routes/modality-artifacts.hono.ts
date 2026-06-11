/**
 * /api/v1/modality-artifacts — fetch the artifact behind a surfaced modality
 * proposal so the owner-web GenUITabHost can render it on Open.
 *
 *   GET /api/v1/modality-artifacts/:proposalId
 *     Returns the proposal's synthesized UI spec + the underlying artifact
 *     (forecast JSON / document archive refs / media descriptor) that was
 *     stashed in the `tab_proposals_inbox.config` jsonb when the modality
 *     executor surfaced the proposal. Read-only: this NEVER mutates a tab —
 *     accepting the proposal (which persists the tab) is a separate POST that
 *     the existing portal-genui router owns.
 *
 * Tenant boundary: `tab_proposals_inbox` is tenant-scoped (FORCE RLS via the
 * `app.current_tenant_id` GUC the database middleware binds). We do NOT
 * double-filter in app code; RLS is the gate. The proposal must also belong
 * to the calling user (recipient) — enforced in the WHERE clause.
 *
 * @module routes/modality-artifacts.hono
 */

import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { getArtifactEgressMembrane } from '../composition/artifact-egress-wiring.js';

interface DbExec {
  execute(query: unknown): Promise<unknown>;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const wrapped = result as { rows?: ReadonlyArray<Record<string, unknown>> };
  return wrapped?.rows ?? [];
}

function parseConfig(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      /* fall through */
    }
  }
  return {};
}

/**
 * Build the modality-artifacts router. Mounted at `/api/v1/modality-artifacts`.
 * The artifact is returned verbatim from the proposal row's `config` — the
 * SAME jsonb the modality executor's proposal sink stashed. Auth + the
 * tenant-bound db handle come from the standard middleware stack.
 */
export function createModalityArtifactsRouter(): Hono {
  const app = new Hono();

  app.use('*', authMiddleware);
  app.use('*', databaseMiddleware);

  app.get('/:proposalId', async (c) => {
    const proposalId = c.req.param('proposalId');
    if (!proposalId) {
      return c.json({ error: 'proposalId required' }, 400);
    }
    const db = c.get('db') as DbExec | null;
    if (!db) {
      return c.json({ error: 'database unavailable' }, 503);
    }
    const auth = c.get('auth') as { userId?: string } | undefined;
    const userId = auth?.userId ?? null;
    if (!userId) {
      return c.json({ error: 'unauthenticated' }, 401);
    }

    let rows: ReadonlyArray<Record<string, unknown>>;
    try {
      rows = rowsOf(
        await db.execute(sql`
          SELECT id, tab_type, title_en, title_sw, reason_en, reason_sw,
                 config, confidence, evidence_ids,
                 accepted_at, dismissed_at
            FROM tab_proposals_inbox
           WHERE id = ${proposalId}
             AND user_id = ${userId}
             AND detector = 'modality-arbiter'
           LIMIT 1
        `),
      );
    } catch (err) {
      return c.json(
        { error: 'artifact lookup failed', detail: err instanceof Error ? err.message : 'unknown' },
        500,
      );
    }

    const row = rows[0];
    if (!row) {
      return c.json({ error: 'proposal not found' }, 404);
    }

    const config = parseConfig(row.config);

    // ARTIFACT EGRESS MEMBRANE (INV-H / INV-D): the `tab` preview + the
    // free-form `artifact` descriptor are stashed verbatim in the proposal
    // `config` jsonb and would otherwise reach the client UN-PROJECTED, bypassing
    // the text egress firewall. Project them through the StatusSpan | Output |
    // Evidence allow-list: keep only renderable content + evidence_ids + status,
    // dropping every mechanic field (agent / tool names, arbiter rationale,
    // internal ids, chain-of-thought, audit provenance) at every depth.
    // FAIL-CLOSED: on projection fault the membrane substitutes a safe-minimal
    // artifact, never the raw blob.
    const projected = getArtifactEgressMembrane().guardEnvelope({
      tab: config.tab ?? null,
      artifact: config.artifact ?? null,
      evidenceIds: row.evidence_ids,
    });

    // The artifact + the synthesized UI spec the FE hydrates on Open. The
    // surface only mutates when the owner ACCEPTS (separate persist POST) —
    // this endpoint is read-only.
    return c.json({
      proposalId: String(row.id),
      artifactKind: typeof config.artifactKind === 'string' ? config.artifactKind : null,
      posture: typeof config.posture === 'string' ? config.posture : 'propose',
      reversible: config.reversible === true,
      accepted: row.accepted_at != null,
      dismissed: row.dismissed_at != null,
      // The genui-synthesized UI spec (a PortalTab preview) — membrane-projected.
      tab: projected.tab,
      // The underlying artifact: forecast JSON / document archive refs /
      // media descriptor — membrane-projected (mechanic keys scrubbed).
      artifact: projected.artifact,
      evidenceIds: projected.evidenceIds,
      confidence:
        typeof row.confidence === 'number'
          ? row.confidence
          : row.confidence == null
            ? null
            : Number(row.confidence),
    });
  });

  return app;
}
