/**
 * Chat-response Auditor gate.
 *
 * Closes the Borjie hard-rule "every junior recommendation cites >=1
 * `evidence_id` from LMBM or the intelligence corpus — the Auditor
 * Agent rejects responses with empty evidence chains" (CLAUDE.md →
 * Hard Rules → Evidence-required AI output).
 *
 * Before this module the Borjie `createAuditorAgent` factory in
 * `@borjie/ai-copilot` was exported but never called from any route.
 * The rule was shelfware. This gate wires the Auditor into every brain
 * /turn response so the violation is observable end-to-end.
 *
 * Design notes:
 *   - The Borjie `createAuditorAgent({ deps })` factory accepts a
 *     `RecommendationToAudit` and runs a two-stage flow whose Stage 2
 *     calls Claude. Calling Claude on every chat turn would double our
 *     LLM bill, so this gate ONLY uses the load-bearing Stage-1 check
 *     ("evidence_ids empty → reject"). We import `createAuditorAgent`
 *     and exercise its public surface so the wiring is real — the gate
 *     is a thin caller around the Stage-1 verdict, not a re-
 *     implementation.
 *   - Evidence ids in Borjie chat responses appear as bracketed inline
 *     citations such as `[evidence:lmbm_42]` / `[evidence:corpus:abc]`
 *     or as a `Sources:` footer. The extractor walks both surfaces.
 *   - Verdict is non-blocking by default (HARD MODE for JSON, SOFT for
 *     SSE) — we never silently swallow. The Pino log line is the
 *     canonical observable signal.
 */

import { MiningJuniors, type ClaudeClient } from '@borjie/ai-copilot';
import { createLogger } from '../utils/logger';

const { createAuditorAgent } = MiningJuniors;
type AuditorAgent = ReturnType<typeof createAuditorAgent>;
type AuditorOutput = Awaited<ReturnType<AuditorAgent['processInput']>>;
type JuniorDeps = Parameters<typeof createAuditorAgent>[0];

const logger = createLogger('chat-response-gate');

// Stub a JuniorDeps that never reaches Stage 2 — we short-circuit on
// the evidence-empty case which is decided in Stage 1 before any
// Claude call. The stub Claude throws if anyone ever reaches it so a
// regression that hits Stage 2 would surface loudly rather than burn
// tokens silently.
const STAGE2_DISABLED_MESSAGE =
  'chat-response-gate: Stage-2 reached unexpectedly; only Stage-1 evidence check should run for chat turns.';

const stubClaude: ClaudeClient = {
  async complete() {
    // Stage-2 reach is a regression — Stage-1 must short-circuit on
    // empty evidence_ids. Throwing here keeps the gate cheap (no
    // tokens burned) and surfaces the regression loudly.
    throw new Error(STAGE2_DISABLED_MESSAGE);
  },
};

let auditorSingleton: AuditorAgent | null = null;

function auditor(): AuditorAgent {
  if (auditorSingleton) return auditorSingleton;
  const deps: JuniorDeps = {
    claude: stubClaude,
    logger: {
      warn: (msg: string, meta?: Record<string, unknown>) =>
        logger.warn(msg, meta ?? {}),
      info: (msg: string, meta?: Record<string, unknown>) =>
        logger.info(msg, meta ?? {}),
      error: (msg: string, meta?: Record<string, unknown>) =>
        logger.error(msg, meta ?? {}),
    },
  };
  auditorSingleton = createAuditorAgent(deps);
  return auditorSingleton;
}

// ─── Evidence-id extractor ──────────────────────────────────────────
//
// Two surfaces are supported (combine results):
//   1. Bracketed inline citation:  `[evidence:LMBM_42]` /
//      `[evidence:corpus:abc-123]`
//   2. Sources footer:  one or more lines after a `Sources:` /
//      `Vyanzo:` heading carrying `- evidence_id: xxx` or `- xxx`.
//
// The patterns are intentionally permissive — the only thing the
// auditor cares about is whether the response cites >=1 evidence_id.
// We strip surrounding punctuation and dedupe.

const INLINE_EVIDENCE_RE =
  /\[evidence(?::[A-Za-z0-9_\-:.]+)+\]|\[evidence:\s*([A-Za-z0-9_\-:.]+)\s*\]/g;
const FOOTER_HEADER_RE = /^(?:sources|vyanzo)\s*:\s*$/im;
const FOOTER_LINE_RE =
  /(?:^|\n)\s*[-*]\s*(?:evidence_id\s*:\s*)?([A-Za-z0-9_\-:.]+)/g;

export function extractEvidenceIds(responseText: string): readonly string[] {
  if (typeof responseText !== 'string' || responseText.length === 0) {
    return [];
  }
  const found = new Set<string>();
  for (const match of responseText.matchAll(INLINE_EVIDENCE_RE)) {
    const raw = match[1] ?? match[0];
    if (typeof raw !== 'string') continue;
    const cleaned = raw
      .replace(/^\[evidence:/, '')
      .replace(/\]$/, '')
      .trim();
    if (cleaned.length > 0) found.add(cleaned);
  }
  // Footer extraction — only look at the slice after the first Sources/Vyanzo
  // header to avoid pulling bullet-list items from earlier in the response.
  const headerMatch = responseText.match(FOOTER_HEADER_RE);
  if (headerMatch && typeof headerMatch.index === 'number') {
    const footerSlice = responseText.slice(headerMatch.index + headerMatch[0].length);
    for (const match of footerSlice.matchAll(FOOTER_LINE_RE)) {
      const candidate = match[1]?.trim();
      if (candidate && candidate.length > 0) found.add(candidate);
    }
  }
  return Array.from(found);
}

// ─── Public gate API ────────────────────────────────────────────────

export interface ChatResponseGateInput {
  readonly tenantId: string;
  readonly threadId: string | null;
  readonly userId: string;
  readonly personaId: string;
  readonly responseText: string;
  /** Anthropic / brain tokens spent on the turn (for cost-attributing the verdict). */
  readonly tokensUsed?: number;
}

export interface ChatResponseGateVerdict {
  readonly verdict: 'approve' | 'reject' | 'needs_human';
  readonly evidenceCount: number;
  readonly evidenceIds: readonly string[];
  readonly auditLogId: string;
  readonly evidenceWarning: 'no_evidence_cited' | null;
  readonly latencyMs: number;
  /** True if the gate raised a violation (evidence chain empty). */
  readonly violation: boolean;
}

/**
 * Audit a brain chat response against the evidence-chain hard rule.
 *
 * The function ALWAYS resolves — it never throws on a missing evidence
 * chain. The caller decides whether to surface the verdict to the
 * client (HARD mode → attach `evidence_warning` to the response body)
 * or only log it (SOFT mode → SSE path).
 *
 * Wave-AC1: Stage-2 is intentionally skipped here. The Borjie auditor's
 * Stage-2 (counter-model Claude call) is designed for inter-junior
 * recommendation review, not user-facing chat turns. Running it on every
 * turn would double the LLM bill. The Stage-1 evidence-chain check is
 * the load-bearing assertion behind the CLAUDE.md hard rule.
 */
export async function auditChatResponse(
  input: ChatResponseGateInput,
): Promise<ChatResponseGateVerdict> {
  const startedAt = Date.now();
  const evidenceIds = extractEvidenceIds(input.responseText);
  const recommendationId = input.threadId
    ? `${input.threadId}:${startedAt}`
    : `synthetic:${startedAt}`;

  // We hand the auditor a faithful RecommendationToAudit; Stage-1
  // decides on evidence_ids alone. Confidence omitted on purpose
  // (non-binding chat response).
  let verdictOutput: AuditorOutput | null = null;
  try {
    if (evidenceIds.length === 0) {
      verdictOutput = await auditor().processInput({
        tenantId: input.tenantId,
        recommendation: {
          origin_junior: `chat:${input.personaId}`,
          recommendation_id: recommendationId,
          payload: { responseText: input.responseText.slice(0, 2_000) },
          evidence_ids: [],
          binding: false,
        },
      });
    }
  } catch (err) {
    // The Stage-1 path doesn't touch Claude, so a throw here means the
    // factory itself failed. Log and continue — never let the gate
    // crash the chat turn.
    logger.warn('auditor invocation failed (non-fatal)', {
      err: err instanceof Error ? err.message : String(err),
      tenantId: input.tenantId,
      threadId: input.threadId,
    });
  }

  const latencyMs = Date.now() - startedAt;
  const violation = evidenceIds.length === 0;
  const verdict: ChatResponseGateVerdict['verdict'] = verdictOutput
    ? verdictOutput.verdict
    : 'approve';
  const auditLogId = verdictOutput
    ? verdictOutput.audit_log_id
    : `audit_${startedAt}_${recommendationId}`;
  const evidenceWarning = violation ? ('no_evidence_cited' as const) : null;

  // Pino structured log — canonical observable signal. Required fields
  // per the wiring spec: session_id (thread id) + tenant_id +
  // evidence_count + verdict + latency_ms.
  const logPayload = {
    session_id: input.threadId,
    tenant_id: input.tenantId,
    user_id: input.userId,
    persona_id: input.personaId,
    evidence_count: evidenceIds.length,
    verdict,
    latency_ms: latencyMs,
    tokens_used: input.tokensUsed ?? null,
    audit_log_id: auditLogId,
  };
  if (violation) {
    logger.warn('chat response auditor: no_evidence_cited', logPayload);
  } else {
    logger.info('chat response auditor: approved', logPayload);
  }

  return {
    verdict,
    evidenceCount: evidenceIds.length,
    evidenceIds,
    auditLogId,
    evidenceWarning,
    latencyMs,
    violation,
  };
}

// ─── HARD-mode enforcement ──────────────────────────────────────────
//
// CLAUDE.md hard rule: "The Auditor Agent REJECTS responses with empty
// evidence chains." Computing the verdict (above) is observe-only — it
// makes the violation visible but still ships the ungrounded answer.
// This block is the ENFORCEMENT half: in HARD (JSON) mode, when the
// verdict is reject / needs_human, we WITHHOLD the ungrounded
// responseText and substitute a safe, single-language placeholder so
// the user never receives an evidence-free recommendation.
//
// SSE stays a non-blocking warn frame (a stream cannot un-send tokens
// already flushed); the JSON path is the enforceable surface.
//
// EN/SW absolute (CLAUDE.md): the substitution is single-language —
// `en` by default, full Swahili when the active locale is `sw`, zero
// mixing.

/** Active locale for the safe-withhold message. EN default; SW toggles. */
export type StrictWithholdLang = 'en' | 'sw';

/**
 * Single-language safe message shown when the auditor withholds an
 * ungrounded answer. Deterministic (no LLM): the brain says it does not
 * yet have grounded evidence and will consult the records — rather than
 * shipping an evidence-free claim. Strictly one language per locale.
 */
export const STRICT_WITHHOLD_TEXTS: Readonly<Record<StrictWithholdLang, string>> =
  Object.freeze({
    en: "I don't have grounded evidence for that yet — let me check the records before I answer.",
    sw: 'Sina ushahidi wenye msingi kuhusu hilo bado — niangalie kumbukumbu kwanza kabla sijajibu.',
  });

/** Verdicts that trigger a HARD-mode withhold (anything that is not an approval). */
function verdictWithholds(verdict: ChatResponseGateVerdict['verdict']): boolean {
  return verdict === 'reject' || verdict === 'needs_human';
}

export interface StrictDecision {
  /** True when the original responseText was withheld and replaced. */
  readonly withheld: boolean;
  /** The text to actually ship to the client (safe message when withheld). */
  readonly responseText: string;
  /**
   * HTTP status the caller should use. `422` when withheld (the answer
   * failed the evidence gate), `200` otherwise.
   */
  readonly status: 200 | 422;
}

/**
 * Decide what a HARD-mode (JSON) caller should ship given an auditor
 * verdict. Pure + deterministic so it is unit-testable without a route.
 *
 *   - strict OFF                → never withhold (observe-only, legacy).
 *   - verdict approves          → ship the original text, 200.
 *   - verdict reject/needs_human → withhold: return the single-language
 *     safe message + 422.
 *
 * @param verdict       the auditor verdict for this response
 * @param originalText  the model's ungrounded responseText
 * @param lang          active locale (EN default, SW toggles)
 * @param strict        strict-mode flag (default ON for JSON callers)
 */
export function decideStrictResponse(args: {
  readonly verdict: ChatResponseGateVerdict['verdict'];
  readonly originalText: string;
  readonly lang: StrictWithholdLang;
  readonly strict: boolean;
}): StrictDecision {
  const { verdict, originalText, lang, strict } = args;
  if (!strict || !verdictWithholds(verdict)) {
    return { withheld: false, responseText: originalText, status: 200 };
  }
  return {
    withheld: true,
    responseText: STRICT_WITHHOLD_TEXTS[lang],
    status: 422,
  };
}
