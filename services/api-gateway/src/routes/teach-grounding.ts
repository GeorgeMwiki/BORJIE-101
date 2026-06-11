/**
 * Teach-route enforced grounding — the SAME `auditChatResponse` /
 * `decideStrictResponse` contract jarvis /think + /stream use (see
 * `jarvis-grounding.ts`), applied to the owner's PRIMARY chat surface
 * (`/api/v1/brain/teach` in brain-teach.hono.ts), which previously shipped
 * its accumulated answer with ZERO auditor grounding while the fail-closed
 * gate protected only /turn /think /stream.
 *
 * The teach stream is SSE — but unlike jarvis /stream, the FULL answer is
 * accumulated server-side BEFORE the first chunk is flushed, so a HARD
 * withhold is possible here:
 *
 *   - HARD (strict ON + reject/needs_human verdict) → the ungrounded prose
 *     is WITHHELD: the caller ships the single-language safe message
 *     (`STRICT_WITHHOLD_TEXTS`, EN/SW absolute — zero mixing) plus an
 *     `auditor` frame with `enforced:true`, then terminates the stream.
 *   - SOFT (verdict approves, or strict OFF) → the answer streams unchanged
 *     and a warn-only `auditor` frame is emitted BEFORE `done` (the same
 *     client "unverified" badge contract jarvis /stream emits).
 *
 * The asymmetry from jarvis-grounding carries over: the corpus verifier
 * INSIDE `auditChatResponse` fails CLOSED (a broken corpus check never
 * blesses a fake citation), while THIS helper fails OPEN (a broken auditor
 * must never break chat — on a gate fault the answer ships unaudited, with
 * no frame).
 */

import pino from 'pino';

import {
  auditChatResponse,
  decideStrictResponse,
  type StrictWithholdLang,
} from '../composition/chat-response-gate.js';
import { strictEvidenceEnabled } from './jarvis-grounding.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'teach-grounding',
});

/** Wire payload of the `auditor` SSE frame the teach route emits. */
export interface TeachAuditorFrame {
  readonly verdict: string;
  readonly evidenceCount: number;
  readonly auditLogId: string;
  readonly evidenceWarning: string | null;
  readonly groundingFault: boolean;
  /** 'withheld' on the HARD path; 'warn-only' on the SOFT path. */
  readonly mode: 'withheld' | 'warn-only';
  readonly enforced: boolean;
}

export interface TeachGroundingDecision {
  /** True when the answer prose must be replaced by `safeText`. */
  readonly withheld: boolean;
  /** Single-language safe message to ship instead (HARD path only). */
  readonly safeText: string | null;
  /** The `auditor` SSE frame payload; null when the gate faulted (fail-OPEN). */
  readonly frame: TeachAuditorFrame | null;
}

/**
 * Audit the accumulated teach answer against the evidence-chain hard rule
 * and decide HARD-withhold vs warn-only. NEVER throws — a broken auditor
 * must never break chat (fail-OPEN on the gate): on a fault the caller
 * streams the original answer with no frame.
 */
export async function auditTeachAnswer(args: {
  readonly answerText: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string | null;
  readonly lang: StrictWithholdLang;
}): Promise<TeachGroundingDecision> {
  try {
    const verdict = await auditChatResponse({
      tenantId: args.tenantId,
      threadId: args.sessionId,
      userId: args.userId,
      personaId: 'mwikila-teach',
      responseText: args.answerText,
    });
    const decision = decideStrictResponse({
      verdict: verdict.verdict,
      originalText: args.answerText,
      lang: args.lang,
      strict: strictEvidenceEnabled(),
    });
    if (decision.withheld) {
      logger.warn(
        {
          wiring: 'teach-grounding',
          tenantId: args.tenantId,
          userId: args.userId,
          sessionId: args.sessionId,
          verdict: verdict.verdict,
          evidenceCount: verdict.evidenceCount,
          groundingFault: verdict.groundingFault,
          auditLogId: verdict.auditLogId,
          lang: args.lang,
        },
        'brain/teach: ungrounded answer WITHHELD in HARD mode (evidence-required)',
      );
    }
    return {
      withheld: decision.withheld,
      safeText: decision.withheld ? decision.responseText : null,
      frame: {
        verdict: verdict.verdict,
        evidenceCount: verdict.evidenceCount,
        auditLogId: verdict.auditLogId,
        evidenceWarning: verdict.evidenceWarning,
        groundingFault: verdict.groundingFault,
        mode: decision.withheld ? 'withheld' : 'warn-only',
        enforced: decision.withheld,
      },
    };
  } catch (err) {
    // FAIL-OPEN on the gate: a broken auditor must never break a chat turn.
    // (The corpus verifier inside the gate is the part that fails CLOSED.)
    logger.warn(
      {
        wiring: 'teach-grounding',
        tenantId: args.tenantId,
        sessionId: args.sessionId,
        err: err instanceof Error ? err.message : String(err),
      },
      'brain/teach: grounding gate threw — failing open (shipping answer)',
    );
    return { withheld: false, safeText: null, frame: null };
  }
}
