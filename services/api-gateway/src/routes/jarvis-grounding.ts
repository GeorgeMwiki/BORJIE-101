/**
 * Jarvis enforced-grounding helpers — extracted from `jarvis-router-factory.ts`
 * to keep the factory under the file-size budget and the many-small-files rule.
 *
 * CLAUDE.md hard rule: "Every junior recommendation cites >=1 evidence_id …
 * the Auditor Agent rejects responses with empty evidence chains." These
 * helpers wire that enforcement into BOTH Jarvis surfaces using the SAME
 * `auditChatResponse` / `decideStrictResponse` contract mining/chat +
 * brain.hono use — NOT a parallel mechanism:
 *
 *   - /think  = HARD mode → `auditAndEnforceThinkResponse`: an ungrounded
 *     tenant-scoped answer is WITHHELD (safe single-language message + 422);
 *     the ungrounded provider prose / reasoning is dropped, never leaked.
 *   - /stream = SOFT mode → `emitAuditorFrameStream`: a warn-only `auditor`
 *     frame for a client "unverified" badge (tokens already streamed — a
 *     stream cannot un-send, so no HARD withhold here).
 *
 * The asymmetry is deliberate: the corpus verifier INSIDE `auditChatResponse`
 * fails CLOSED (a broken corpus check never blesses a fake citation), while
 * these gate helpers fail OPEN (a broken auditor must never break chat).
 */

import pino from 'pino';
import {
  auditChatResponse,
  decideStrictResponse,
  type StrictWithholdLang,
} from '../composition/chat-response-gate.js';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'jarvis-grounding',
});

/**
 * Resolve the auditor / withhold locale from an `Accept-Language` header.
 * EN default; the toggle to `sw` (Swahili) is ABSOLUTE — when withholding we
 * ship exactly one language, never a mix (CLAUDE.md bilingual hard rule).
 */
export function pickAuditLang(acceptLanguage: string | null): StrictWithholdLang {
  if (typeof acceptLanguage !== 'string' || acceptLanguage.length === 0) {
    return 'en';
  }
  const first = acceptLanguage.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('sw') ? 'sw' : 'en';
}

/**
 * Resolve the HARD-mode strict-evidence kill-switch. DEFAULT-ON. Operators
 * can disable with `BORJIE_STRICT_EVIDENCE=off|0|false|no` to restore the
 * legacy observe-only behaviour (e.g. during a corpus back-fill where many
 * answers are legitimately evidence-thin). Read here (not cached) so the
 * switch takes effect on the next turn.
 */
export function strictEvidenceEnabled(): boolean {
  const raw = process.env.BORJIE_STRICT_EVIDENCE?.trim().toLowerCase();
  if (raw === undefined || raw === '') return true; // default ON
  return !(raw === 'off' || raw === '0' || raw === 'false' || raw === 'no');
}

/**
 * Extract the model prose from a kernel BrainDecision for auditing. Only
 * `answer` / `softened` carry a user-facing claim that must be grounded;
 * refusals / gates / other shapes carry no recommendation (return null →
 * gate skipped). Never throws on a malformed shape.
 */
export function decisionProseForAudit(decision: unknown): string | null {
  if (!decision || typeof decision !== 'object') return null;
  const d = decision as Record<string, unknown>;
  if (d.kind === 'answer' || d.kind === 'softened') {
    return typeof d.text === 'string' ? d.text : '';
  }
  return null;
}

export interface ThinkGroundingAudit {
  readonly verdict: string;
  readonly evidenceCount: number;
  readonly auditLogId: string;
  readonly evidenceWarning: string | null;
  readonly groundingFault: boolean;
  readonly enforced: boolean;
}

export interface ThinkGroundingDecision {
  readonly withheld: boolean;
  readonly status: 200 | 422;
  readonly safeText: string | null;
  readonly audit: ThinkGroundingAudit | null;
}

/**
 * HARD-mode enforcement for the /think JSON path. Audits the model prose
 * against the evidence-chain rule and decides whether to WITHHOLD it.
 *
 *   - tenant-scoped + ungrounded (or corpus-unverified) + strict-ON → withhold:
 *     safe single-language message + 422 (the evidence-free / unverified claim
 *     never reaches the user; provider prose is dropped, not leaked);
 *   - grounded / approved → ship original, 200;
 *   - platform-scope (no tenant) → SKIPPED (DP-cohort path has no corpus to
 *     ground against), 200;
 *   - non-answer decision (refusal / gate) → SKIPPED, 200.
 *
 * NEVER throws on a gate fault: a broken auditor must not break chat
 * (fail-OPEN on the gate). The corpus verifier inside `auditChatResponse`
 * fails CLOSED — that asymmetry is intentional.
 */
export async function auditAndEnforceThinkResponse(args: {
  readonly decision: unknown;
  readonly tenantId: string | null;
  readonly userId: string | null;
  readonly threadId: string;
  readonly personaId: string;
  readonly lang: StrictWithholdLang;
  readonly surface: string;
}): Promise<ThinkGroundingDecision> {
  const prose = decisionProseForAudit(args.decision);
  // Platform scope has no tenant corpus to ground against — skip (the spec
  // and brain.hono both exempt the DP-cohort path). Non-answer decisions
  // carry no claim. Either way: no enforcement, ship as-is.
  if (prose === null || !args.tenantId) {
    return { withheld: false, status: 200, safeText: null, audit: null };
  }
  try {
    const verdict = await auditChatResponse({
      tenantId: args.tenantId,
      threadId: args.threadId,
      userId: args.userId ?? 'unknown-user',
      personaId: args.personaId,
      responseText: prose,
    });
    const decision = decideStrictResponse({
      verdict: verdict.verdict,
      originalText: prose,
      lang: args.lang,
      strict: strictEvidenceEnabled(),
    });
    if (decision.withheld) {
      logger.warn(
        {
          wiring: 'jarvis-grounding',
          surface: args.surface,
          tenantId: args.tenantId,
          userId: args.userId,
          threadId: args.threadId,
          verdict: verdict.verdict,
          evidenceCount: verdict.evidenceCount,
          groundingFault: verdict.groundingFault,
          auditLogId: verdict.auditLogId,
          lang: args.lang,
        },
        'jarvis /think: ungrounded response WITHHELD in HARD mode (evidence-required)',
      );
    }
    return {
      withheld: decision.withheld,
      status: decision.status,
      safeText: decision.withheld ? decision.responseText : null,
      audit: {
        verdict: verdict.verdict,
        evidenceCount: verdict.evidenceCount,
        auditLogId: verdict.auditLogId,
        evidenceWarning: verdict.evidenceWarning,
        groundingFault: verdict.groundingFault,
        enforced: decision.withheld,
      },
    };
  } catch (err) {
    // FAIL-OPEN on the gate: a broken auditor must never break a chat turn.
    // (The corpus verifier inside the gate is the part that fails CLOSED.)
    logger.warn(
      {
        wiring: 'jarvis-grounding',
        surface: args.surface,
        threadId: args.threadId,
        err: err instanceof Error ? err.message : String(err),
      },
      'jarvis /think: grounding gate threw — failing open (shipping answer)',
    );
    return { withheld: false, status: 200, safeText: null, audit: null };
  }
}

/**
 * SOFT-mode enforcement for the /stream SSE path: emit a warn-only `auditor`
 * frame for a client-side "unverified" badge. Tokens were already streamed,
 * so a stream cannot un-send an ungrounded answer — this surfaces the verdict
 * (and any grounding fault) without blocking. Called BEFORE the `done` event.
 * NEVER throws — a gate / write fault must never abort the turn (fail-OPEN).
 */
export async function emitAuditorFrameStream(
  stream: { writeSSE: (data: { event: string; data: string }) => Promise<void> },
  args: {
    readonly decision: unknown;
    readonly tenantId: string | null;
    readonly userId: string | null;
    readonly threadId: string;
    readonly personaId: string;
    readonly surface: string;
  },
): Promise<void> {
  const prose = decisionProseForAudit(args.decision);
  // Platform scope or non-answer decisions carry no groundable claim.
  if (prose === null || !args.tenantId) return;
  try {
    const verdict = await auditChatResponse({
      tenantId: args.tenantId,
      threadId: args.threadId,
      userId: args.userId ?? 'unknown-user',
      personaId: args.personaId,
      responseText: prose,
    });
    await stream.writeSSE({
      event: 'auditor',
      data: JSON.stringify({
        verdict: verdict.verdict,
        evidenceCount: verdict.evidenceCount,
        auditLogId: verdict.auditLogId,
        evidenceWarning: verdict.evidenceWarning,
        groundingFault: verdict.groundingFault,
        // WARN-ONLY: tokens already streamed — we cannot withhold here. HARD
        // enforcement (withhold + 422) lives on /think only.
        mode: 'warn-only',
      }),
    });
  } catch (err) {
    // Auditor + SSE write are best-effort; never abort the turn (fail-OPEN).
    logger.warn(
      {
        wiring: 'jarvis-grounding',
        surface: args.surface,
        threadId: args.threadId,
        err: err instanceof Error ? err.message : String(err),
      },
      'jarvis /stream: failed to emit auditor frame (non-fatal)',
    );
  }
}
