/**
 * Drizzle-backed `ModalityProposalSink` — routes a built proposal out via the
 * EXISTING portal-genui `tab_proposal` channel.
 *
 * Two-step delivery (the SAME path the tab-suggester uses, so the proposal
 * reaches the owner tray through machinery that already exists):
 *
 *   1. PERSIST the proposal as an OPEN `tab_proposals_inbox` row. The
 *      synthesized UI spec (the PortalTab preview), the artifact, and the
 *      autonomy posture ride in `config` jsonb so the owner-web GenUITabHost
 *      can hydrate the exact preview on Open. The row is `accepted_at = NULL`
 *      / `dismissed_at = NULL` → the surface mutates ONLY when the owner
 *      accepts (POST persist) — the invariant's approval gate.
 *   2. PUBLISH a `cockpit.tab.proposed` event so the ambient "Opened X from
 *      your chat" notice appears immediately (the same drain
 *      `drainTabProposalsInbox` would emit on its next pass — we publish
 *      eagerly here so a live chat turn surfaces without waiting for the
 *      scheduler). At-most-once: the inbox row is the dedup key.
 *
 * `posture: 'auto'` flips the row's intent to an ambient auto-spawn but STILL
 * reversible (the FE renders Open/Undo and the row carries
 * `auto_spawn: true`); it NEVER persists a tab server-side here. Default
 * `propose` waits for the explicit accept.
 *
 * Evidence-required: a proposal with an empty evidence chain is rejected
 * before it reaches this sink (the builder returns null), and we
 * defence-in-depth skip an empty chain here too.
 *
 * Pino only; never throws — a persist/publish failure is logged and the turn
 * continues (the chat reply is already produced).
 *
 * @module composition/modality-capability/proposal-sink
 */

import { sql } from 'drizzle-orm';

import type { CockpitEvent } from '../../services/cockpit-events/index.js';
import type { ModalityProposalSink } from './modality-executor.js';
import type { ModalityProposal } from './modality-proposal.js';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/** Minimal Pino-shaped logger (avoids a hard `pino` type coupling at this seam). */
export interface SinkLogger {
  info(meta: object, msg: string): void;
  warn(meta: object, msg: string): void;
}

export interface DrizzleModalityProposalSinkDeps {
  readonly db: DbLike;
  readonly logger: SinkLogger;
  /** Resolve the tenant id for the current request scope. */
  readonly tenantId: string;
  /** Resolve the owning user id (proposal recipient). */
  readonly userId: string;
  /** Active locale for the reason copy (single-language; no mixing). */
  readonly language: 'en' | 'sw';
  /** Publish to the cockpit bus (the existing tray channel). */
  readonly publish: (event: CockpitEvent) => number;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const wrapped = result as { rows?: ReadonlyArray<Record<string, unknown>> };
  return wrapped?.rows ?? [];
}

/**
 * Build the Drizzle-backed sink. Bound per-request (tenant + user + locale)
 * because `tab_proposals_inbox` is tenant-scoped (RLS via the GUC the
 * middleware binds) and the recipient is the current user.
 */
export function createDrizzleModalityProposalSink(
  deps: DrizzleModalityProposalSinkDeps,
): ModalityProposalSink {
  return {
    async emit(proposal: ModalityProposal): Promise<{ readonly surfacedProposalId: string }> {
      const { payload } = proposal;
      // Defence-in-depth — the Auditor rejects evidence-free proposals.
      const evidenceIds = Array.isArray(proposal.artifact['evidence_ids'])
        ? (proposal.artifact['evidence_ids'] as unknown[]).filter(
            (v): v is string => typeof v === 'string' && v.length > 0,
          )
        : [];
      if (evidenceIds.length === 0) {
        deps.logger.warn(
          { wiring: 'modality-proposal-sink', artifactKind: proposal.artifactKind },
          'modality-proposal-sink: skipped evidence-free proposal',
        );
        return { surfacedProposalId: payload.proposalId };
      }

      // `config` carries the FULL synthesized UI spec + artifact + posture so
      // the owner-web GenUITabHost hydrates the exact preview on Open. The
      // FE re-validates + re-scopes the tab server-side on accept.
      const config = {
        source: 'modality-arbiter' as const,
        artifactKind: proposal.artifactKind,
        posture: proposal.posture,
        autoSpawn: proposal.posture === 'auto',
        reversible: true,
        tab: payload.tab,
        artifact: proposal.artifact,
        summary: payload.summary,
      };
      const tabType = `genui_${proposal.artifactKind}`;
      const reasonEn = deps.language === 'en' ? payload.reason : '';
      const reasonSw = deps.language === 'sw' ? payload.reason : null;

      try {
        const inserted = rowsOf(
          await deps.db.execute(sql`
            INSERT INTO tab_proposals_inbox (
              tenant_id, user_id, tab_type, title_en, title_sw,
              reason_en, reason_sw, config, confidence, evidence_ids, detector
            ) VALUES (
              ${deps.tenantId},
              ${deps.userId},
              ${tabType},
              ${payload.title},
              ${payload.title},
              ${reasonEn || payload.reason},
              ${reasonSw},
              ${JSON.stringify(config)}::jsonb,
              ${payload.confidence},
              ${JSON.stringify(evidenceIds)}::jsonb,
              ${'modality-arbiter'}
            )
            RETURNING id
          `),
        );
        const rowId =
          inserted[0] && typeof inserted[0]['id'] !== 'undefined'
            ? String(inserted[0]['id'])
            : payload.proposalId;

        // Eager publish — surface the ambient notice immediately. The drain
        // dedups by the inbox row's cooldown so we never double-surface.
        try {
          deps.publish({
            kind: 'cockpit.tab.proposed',
            tenantId: deps.tenantId,
            emittedAt: new Date().toISOString(),
            userId: deps.userId,
            proposalId: rowId,
            tabType,
            title: payload.title,
            reasonEn: reasonEn || payload.reason,
            reasonSw,
            evidenceIds,
            confidence: payload.confidence,
          });
        } catch (pubErr) {
          deps.logger.warn(
            {
              wiring: 'modality-proposal-sink',
              proposalId: rowId,
              err: pubErr instanceof Error ? pubErr.message : String(pubErr),
            },
            'modality-proposal-sink: publish failed (row persisted; drain will resurface)',
          );
        }

        deps.logger.info(
          {
            wiring: 'modality-proposal-sink',
            artifactKind: proposal.artifactKind,
            posture: proposal.posture,
            proposalId: rowId,
          },
          'modality-proposal-sink: proposal surfaced (proposal-gated; no UI mutated)',
        );
        return { surfacedProposalId: rowId };
      } catch (err) {
        deps.logger.warn(
          {
            wiring: 'modality-proposal-sink',
            artifactKind: proposal.artifactKind,
            err: err instanceof Error ? err.message : String(err),
          },
          'modality-proposal-sink: persist failed — no proposal surfaced',
        );
        return { surfacedProposalId: payload.proposalId };
      }
    },
  };
}
