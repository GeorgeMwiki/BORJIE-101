/**
 * createDrafterRegistry — the driveId → DrafterFn routing table (Wave-C C3
 * WIN-3: graded homeostatic corrective, the mid-rung action).
 *
 * Each `DrafterFn` adapts the EXISTING autonomous handler for its drive
 * (license-renewal / royalty-filing / payroll, built over the real Drizzle
 * ports in mwikila-autonomous-ports.ts) into the reconcile engine's
 * `{ drafted, draftRef }` shape. When the corrective ladder reaches the `draft`
 * rung for a breached drive, the bound drafter:
 *   1. RE-USES the handler's pure `propose()` to build a real corrective
 *      artifact from the live estate data (an expiring-licence renewal packet /
 *      a month-end royalty filing draft / a payroll batch preview); then
 *   2. writes it as a DRAFT row into `mwikila_actions_inbox` with
 *      status='proposed' (the SAME safe-halt seam the ladder's owner-direct
 *      rung uses) — deduped by commitmentId so a re-tick never double-files.
 *
 * PROPOSE-ONLY (hard rule): the row lands `proposed` for HITL review and is
 * NEVER executed. The drafter has NO executor handle — it cannot post to the
 * ledger, submit a filing, or renew a licence. Money / licence stay HITL
 * forever; the autonomy cap (clamped in the reconcile engine) governs whether
 * the draft rung is even reached. A handler/port outage returns
 * `{ drafted: false }` and the engine surfaces the concern without the artifact
 * (a drafter outage never breaks the sweep).
 *
 * No `console.*` (Pino shim only). Immutable inputs.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';

import type { MdCommitment } from '@borjie/database/repositories';

import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';
import type { DrafterFn, DrafterRegistry } from './reconcile-engine.js';
import {
  buildLicenseRenewalPorts,
  buildRoyaltyFilingPorts,
  buildPayrollPorts,
} from '../mwikila-autonomous-ports.js';
import { createLicenseRenewalHandler } from '../../services/mwikila-autonomy/handlers/license-renewal.js';
import { createRoyaltyFilingHandler } from '../../services/mwikila-autonomy/handlers/royalty-filing-prep.js';
import { createPayrollHandler } from '../../services/mwikila-autonomy/handlers/payroll-prep.js';
import type {
  MwikilaHandler,
  MwikilaHandlerProposal,
} from '../../services/mwikila-autonomy/handler-runtime.js';

interface DbExecLike {
  execute(query: unknown): Promise<unknown>;
}

/** DRAFT proposals always land `proposed` (HITL) under the T1 owner tier. */
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7-day review horizon

/**
 * Adapt one autonomous handler into a `DrafterFn`: build the proposal from the
 * live estate data, then write it as a DRAFT `proposed` inbox row (deduped by
 * commitmentId). PROPOSE-ONLY — never executed.
 */
export function drafterFor(
  db: DbExecLike,
  handler: MwikilaHandler,
  logger: PinoLikeLogger,
): DrafterFn {
  return async (c, ctx) => {
    let proposal: MwikilaHandlerProposal | null = null;
    try {
      proposal = await handler.propose({
        tenantId: ctx.tenantId,
        actingOnUserId: c.ownerId,
        now: new Date(ctx.nowMs),
      });
    } catch (err) {
      logger.warn(
        { commitmentId: c.id, actionKind: handler.actionKind, err: errMsg(err) },
        'md-drafter: handler propose() failed (swallowed — surfacing without draft)',
      );
      return { drafted: false };
    }
    // No live actionable data this tick → nothing to draft (not an error).
    if (proposal === null) return { drafted: false };

    const draftRef = `${proposal.actionKind}:${c.id}`;
    const ttlIso = new Date(ctx.nowMs + DRAFT_TTL_MS).toISOString();
    try {
      // Write the DRAFT row into the SAME safe-halt seam the ladder uses:
      // status='proposed', T1, HITL — never executed. Dedupe on commitmentId so
      // a re-tick refreshes nothing and never double-files. The owner_id must
      // resolve to a real user (the FK guard) or the write is a no-op.
      const result = await db.execute(sql`
        INSERT INTO mwikila_actions_inbox
          (tenant_id, acting_on_user_id, action_kind, category,
           delegation_tier, status, summary, summary_sw, rationale,
           payload, proposal_ttl_at, provenance)
        SELECT ${c.tenantId}, ${c.ownerId}, ${proposal.actionKind},
               ${proposal.category}, 'T1', 'proposed',
               ${proposal.summary}, ${proposal.summarySw}, ${proposal.rationale},
               ${JSON.stringify({
                 ...proposal.payload,
                 commitmentId: c.id,
                 breachSeverity: ctx.breachSeverity,
                 draftRef,
               })}::jsonb,
               ${ttlIso}::timestamptz,
               ${JSON.stringify({ via: 'md-commitment-graded-corrective-draft' })}::jsonb
         WHERE EXISTS (SELECT 1 FROM users WHERE id = ${c.ownerId})
           AND NOT EXISTS (
             SELECT 1 FROM mwikila_actions_inbox
              WHERE tenant_id = ${c.tenantId}
                AND status = 'proposed'
                AND payload ->> 'commitmentId' = ${c.id}
                AND action_kind = ${proposal.actionKind}
           )
        RETURNING id
      `);
      // The conditional INSERT writes ZERO rows when the owner FK is missing or
      // a proposed draft already exists (dedupe). Only claim `drafted` when a
      // row was actually written — otherwise the ladder must not report a draft.
      const wrote = rowsOf(result).length > 0;
      return wrote ? { drafted: true, draftRef } : { drafted: false };
    } catch (err) {
      logger.warn(
        { commitmentId: c.id, actionKind: proposal.actionKind, err: errMsg(err) },
        'md-drafter: draft write failed (swallowed — surfacing without draft)',
      );
      return { drafted: false };
    }
  };
}

/**
 * Build the driveId → DrafterFn registry. Each drive that has a real autonomous
 * handler gets its bound drafter:
 *   - licence-currency  → license-renewal handler (renewal packet)
 *   - royalty-currency  → royalty-filing handler   (month-end filing draft)
 *   - cash-runway       → payroll handler          (payroll batch preview;
 *                          payroll is the dominant cash-out a runway breach
 *                          most often demands action on)
 * Drives without a matching handler (safety / offtake-coverage / equipment-
 * health) are intentionally absent — the engine falls back to the louder
 * nudge/in-app rung for those, never a fabricated draft.
 */
export function createDrafterRegistry(
  db: DbExecLike,
  logger: PinoLikeLogger = createPinoLikeLogger('md-drafter-registry'),
): DrafterRegistry {
  // The handler ports take a pino `Logger`; the gateway threads a PinoLikeLogger
  // here. The ports only call `.warn(meta, msg)` which both shapes satisfy —
  // adapt structurally so a single gateway logger drives both.
  const portLogger = logger as unknown as Logger;

  const licenceHandler = createLicenseRenewalHandler(
    buildLicenseRenewalPorts(db, portLogger),
  );
  const royaltyHandler = createRoyaltyFilingHandler(
    buildRoyaltyFilingPorts(db, portLogger),
  );
  const payrollHandler = createPayrollHandler(
    buildPayrollPorts(db, portLogger),
  );

  const entries: ReadonlyArray<readonly [string, DrafterFn]> = [
    ['licence-currency', drafterFor(db, licenceHandler, logger)],
    ['royalty-currency', drafterFor(db, royaltyHandler, logger)],
    ['cash-runway', drafterFor(db, payrollHandler, logger)],
  ];

  return new Map(entries);
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Driver-agnostic row reader (postgres-js array | pg `{ rows }`). */
function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const rows = (result as { rows?: ReadonlyArray<Record<string, unknown>> })
    ?.rows;
  return Array.isArray(rows) ? rows : [];
}
