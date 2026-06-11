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
import { trace } from '@opentelemetry/api';
import { createLogger } from '../utils/logger';
import { screenResponseEthics, type EthicsGateVerdict } from './ethics-gate';

const { createAuditorAgent } = MiningJuniors;
type AuditorAgent = ReturnType<typeof createAuditorAgent>;
type AuditorOutput = Awaited<ReturnType<AuditorAgent['processInput']>>;
type JuniorDeps = Parameters<typeof createAuditorAgent>[0];

const logger = createLogger('chat-response-gate');

// ─── Stage-2 evidence-existence verifier (optional, DB-backed) ──────
//
// Stage-1 only checks that the response cites >=1 evidence_id. Stage-2
// adds the cheap, load-bearing SQL existence check: every cited
// evidence_id MUST resolve to a real `intelligence_corpus_chunks` row
// for the tenant (or the global `tenant_id IS NULL` corpus). A cited id
// that does NOT exist is a FABRICATED citation — the gate rejects it
// with `EVIDENCE_INVALID` so a hallucinated `[evidence:...]` can no
// longer pass enforcement just by matching the regex shape.
//
// The verifier is INJECTED by the composition root (it owns the DB
// handle). When unset the gate degrades to Stage-1-only — exactly the
// prior behaviour — so this is purely additive and never breaks a turn.

/**
 * Result of a Stage-2 evidence-existence probe.
 *
 *   - `verified: true`  → the corpus was reachable; `missingIds` lists the
 *     cited ids that do NOT resolve to a real chunk (empty = all real).
 *   - `verified: false` → the corpus query FAULTED (DB down / timeout).
 *     `missingIds` is empty but the citations are NOT blessed — the gate
 *     treats them as UNVERIFIED (fail-CLOSED). A broken corpus check must
 *     never silently validate a fabricated `[evidence:...]`.
 */
export interface EvidenceVerificationResult {
  readonly verified: boolean;
  readonly missingIds: readonly string[];
}

export interface EvidenceExistenceVerifier {
  /**
   * Probe whether each cited `evidenceId` exists as a corpus chunk for
   * this tenant. MUST be tenant-scoped + RLS-safe + read-only. MUST NOT
   * throw — on any infra fault, resolve with `{ verified: false }` so the
   * gate can fail CLOSED (treat citations as unverified) rather than
   * silently bless them.
   */
  verifyEvidenceIds(args: {
    readonly tenantId: string;
    readonly evidenceIds: readonly string[];
  }): Promise<EvidenceVerificationResult>;
}

let evidenceVerifier: EvidenceExistenceVerifier | null = null;

/**
 * Wire (or clear) the Stage-2 evidence-existence verifier. Called once
 * by the composition root with a DB-backed verifier; tests pass a
 * deterministic stub or `null` to exercise Stage-1-only behaviour.
 */
export function setEvidenceExistenceVerifier(
  verifier: EvidenceExistenceVerifier | null,
): void {
  evidenceVerifier = verifier;
}

/**
 * Narrow read port — the SAME `query(sql, params)` boundary the
 * portal-genui / widget-data resolvers consume from Drizzle's
 * `$client.unsafe`. Re-declared here so this gate depends on nothing
 * heavier than the signature (no `@borjie/database` import).
 */
export interface CorpusQueryPort {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<ReadonlyArray<Row>>;
}

/**
 * Build a DB-backed `EvidenceExistenceVerifier` over the
 * `intelligence_corpus_chunks` table. An id is "valid" when a chunk with
 * that id exists for the tenant OR in the global (`tenant_id IS NULL`)
 * Borjie corpus. The query is tenant-scoped + RLS-safe (RLS FORCE binds
 * `app.current_tenant_id`) + read-only + parameterised (no interpolation
 * of cited ids).
 *
 * FAIL-CLOSED: any infra fault resolves `{ verified: false }` — the corpus
 * could NOT be reached, so the cited ids are NOT blessed. The caller treats
 * them as UNVERIFIED rather than silently valid. A broken corpus check must
 * never let a fabricated `[evidence:...]` pass enforcement. (This is the
 * deliberate asymmetry: the corpus verifier fails CLOSED, while the auditor
 * gate around it fails OPEN so a broken auditor never breaks chat.)
 */
export function createCorpusEvidenceVerifier(
  port: CorpusQueryPort,
): EvidenceExistenceVerifier {
  return {
    async verifyEvidenceIds({ evidenceIds }) {
      const ids = Array.from(new Set(evidenceIds.filter((s) => s.length > 0)));
      if (ids.length === 0) return { verified: true, missingIds: [] };
      try {
        // Parameterised ANY($1) membership probe. The global corpus
        // (tenant_id IS NULL) is shared by every tenant, so a chunk is
        // visible when it is global OR belongs to the calling tenant —
        // RLS already restricts the tenant rows; the explicit OR admits
        // the global corpus that RLS would otherwise hide.
        const rows = await port.query<{ id: string }>(
          `SELECT id FROM public.intelligence_corpus_chunks
             WHERE id = ANY($1::text[])
               AND (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true))`,
          [ids],
        );
        const present = new Set(rows.map((r) => r.id));
        return {
          verified: true,
          missingIds: ids.filter((id) => !present.has(id)),
        };
      } catch (err) {
        // FAIL-CLOSED: the corpus is unreachable. Do NOT return `[]` (which
        // would read as "all cited ids are real"). Signal the fault so the
        // gate marks the citations UNVERIFIED. Pino error + OTel span attr
        // make the grounding fault observable end-to-end.
        emitGroundingFault('corpus_verifier_query_failed', err);
        return { verified: false, missingIds: [] };
      }
    },
  };
}

/**
 * Emit the canonical `grounding_fault` warning audit: a Pino ERROR line plus
 * an OTel span attribute on the active span (best-effort — never throws).
 * Surfaces a corpus-verifier fault so a fail-CLOSED "unverified" verdict is
 * traceable to its cause rather than looking like a clean reject.
 */
function emitGroundingFault(reason: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  logger.error('grounding_fault: corpus evidence verifier unavailable (fail-closed)', {
    grounding_fault: reason,
    err: message,
  });
  try {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute('borjie.grounding_fault', true);
      span.setAttribute('borjie.grounding_fault_reason', reason);
    }
  } catch {
    // OTel attribution is best-effort observability — a tracing fault must
    // never escape the grounding gate.
  }
}

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

// Flat (non-nested) quantifier — avoids ReDoS on inputs like
// `[evidence::::::::::::::::` (no closing bracket).  The path segments
// `corpus:abc-123` are captured as one flat run of allowed chars
// separated by colons, which preserves the original matching semantics.
const INLINE_EVIDENCE_RE =
  /\[evidence:[A-Za-z0-9_\-:.]{1,200}\]|\[evidence:\s*([A-Za-z0-9_\-:.]{1,200})\s*\]/g;
const FOOTER_HEADER_RE = /^(?:sources|vyanzo)\s*:\s*$/im;
const FOOTER_LINE_RE =
  /(?:^|\n)\s*[-*]\s*(?:evidence_id\s*:\s*)?([A-Za-z0-9_\-:.]{1,200})/g;

// Maximum response length fed to the regex engine.  Evidence ids are never
// longer than a few hundred chars; anything beyond this cap is safely
// truncated for the regex pass (the full text is still returned to callers).
const MAX_REGEX_INPUT = 64_000;

export function extractEvidenceIds(responseText: string): readonly string[] {
  if (typeof responseText !== 'string' || responseText.length === 0) {
    return [];
  }
  // Cap the slice handed to the regex engine so a pathologically large
  // response body cannot trigger catastrophic backtracking.
  const safeText =
    responseText.length > MAX_REGEX_INPUT
      ? responseText.slice(0, MAX_REGEX_INPUT)
      : responseText;
  const found = new Set<string>();
  for (const match of safeText.matchAll(INLINE_EVIDENCE_RE)) {
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
  const headerMatch = safeText.match(FOOTER_HEADER_RE);
  if (headerMatch && typeof headerMatch.index === 'number') {
    const footerSlice = safeText.slice(headerMatch.index + headerMatch[0].length);
    for (const match of footerSlice.matchAll(FOOTER_LINE_RE)) {
      const candidate = match[1]?.trim();
      if (candidate && candidate.length > 0) found.add(candidate);
    }
  }
  return Array.from(found);
}

/**
 * Lightweight, synchronous Stage-1 grounding check: does this response cite
 * at least one evidence_id? This is the cheap shape-only assertion behind the
 * CLAUDE.md hard rule ("every recommendation cites >=1 evidence_id"). It does
 * NOT confirm the cited ids exist in the corpus — that is the (async,
 * DB-backed, fail-CLOSED) Stage-2 verifier inside `auditChatResponse`. Use
 * this for a fast pre-check; use `decideStrictResponse` over an
 * `auditChatResponse` verdict as the single source of truth for enforcement.
 */
export function isResponseGrounded(responseText: string): boolean {
  return extractEvidenceIds(responseText).length > 0;
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
  readonly evidenceWarning: 'no_evidence_cited' | 'evidence_invalid' | null;
  readonly latencyMs: number;
  /**
   * The cited evidence_ids that did NOT resolve to a real corpus chunk
   * for the tenant (Stage-2). Empty when the verifier is unwired or
   * every cited id exists.
   */
  readonly invalidEvidenceIds: readonly string[];
  /**
   * True when the Stage-2 corpus verifier FAULTED (DB down / timeout) so
   * the cited evidence_ids could NOT be confirmed. Fail-CLOSED: the cited
   * ids are treated as UNVERIFIED (not silently valid) and the verdict is
   * escalated to `needs_human` so a fabricated citation can never pass
   * enforcement on the back of a broken corpus check.
   */
  readonly groundingFault: boolean;
  /**
   * True if the gate raised a violation — empty evidence chain, a
   * FABRICATED (non-existent) cited evidence_id, an UNVERIFIED corpus probe
   * (grounding fault), OR a high/critical ethics-framework dark-pattern
   * detection.
   */
  readonly violation: boolean;
  /**
   * Ethics-framework verdict for this response (dark-pattern scan +
   * transparency principle flags). A `block` recommendation escalates
   * the overall `verdict` to `reject` so HARD-mode enforcement
   * withholds the response (fail-closed).
   */
  readonly ethics: EthicsGateVerdict;
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

  // Stage-2 — evidence-existence verification. When the verifier is wired AND
  // the response cited >=1 evidence_id, assert every cited id resolves to a
  // real corpus chunk for the tenant. A non-existent (fabricated) id is a
  // hard reject (`EVIDENCE_INVALID`).
  //
  // FAIL-CLOSED on the corpus: when the verifier reports `verified: false`
  // (DB down / timeout) we DO NOT bless the citations. They are marked
  // UNVERIFIED (`groundingFault`) and the verdict escalates to needs_human —
  // a broken corpus check must never let a fabricated citation through.
  let invalidEvidenceIds: readonly string[] = [];
  let groundingFault = false;
  if (evidenceVerifier && evidenceIds.length > 0) {
    try {
      const probe = await evidenceVerifier.verifyEvidenceIds({
        tenantId: input.tenantId,
        evidenceIds,
      });
      if (probe.verified) {
        invalidEvidenceIds = probe.missingIds;
      } else {
        groundingFault = true;
      }
    } catch (err) {
      // Defence-in-depth — the port contract says never throw, but a
      // contract violation must NOT crash the chat turn. Treat a thrown
      // verifier the SAME as a reported fault: fail CLOSED (unverified).
      groundingFault = true;
      emitGroundingFault('corpus_verifier_threw', err);
    }
  }
  const evidenceInvalid = invalidEvidenceIds.length > 0;

  // Ethics-framework screen — composes the dark-pattern detector +
  // transparency principles over the AI's actual response copy. Pure +
  // best-effort; a high/critical dark pattern recommends a BLOCK which
  // we fold into the verdict below (fail-closed).
  const ethics = screenResponseEthics({ responseText: input.responseText });

  const latencyMs = Date.now() - startedAt;
  const evidenceEmpty = evidenceIds.length === 0;
  // NOTE: the `evidenceWarning` string union is intentionally NOT widened for
  // the grounding-fault case (a downstream consumer pins the narrow union). The
  // precise "citation present but UNVERIFIED because the corpus was unreachable"
  // signal is carried by the dedicated `groundingFault: true` field + the
  // `needs_human` verdict below — not by a new warning literal.
  const evidenceWarning: ChatResponseGateVerdict['evidenceWarning'] =
    evidenceEmpty
      ? 'no_evidence_cited'
      : evidenceInvalid
        ? 'evidence_invalid'
        : null;

  // Base verdict from the evidence-chain auditor (Stage-1).
  const auditorVerdict: ChatResponseGateVerdict['verdict'] = verdictOutput
    ? verdictOutput.verdict
    : 'approve';
  // Ethics escalation: a `block` recommendation forces a reject so the
  // existing HARD-mode enforcement withholds the manipulative answer. A
  // fabricated citation (Stage-2) is ALSO a hard reject — a confident answer
  // citing evidence that does not exist is worse than one citing none.
  //
  // Grounding fault (corpus unreachable) → `needs_human`: we cannot prove the
  // citation is real, so we MUST NOT bless it (fail-CLOSED). needs_human still
  // triggers a HARD-mode withhold but is distinct from an outright reject so
  // the cause (unverified, not fabricated) stays legible in the audit trail.
  const verdict: ChatResponseGateVerdict['verdict'] =
    ethics.recommendation === 'block' || evidenceInvalid
      ? 'reject'
      : groundingFault
        ? 'needs_human'
        : auditorVerdict;
  const violation =
    evidenceEmpty || evidenceInvalid || groundingFault || ethics.violation;
  const auditLogId = verdictOutput
    ? verdictOutput.audit_log_id
    : `audit_${startedAt}_${recommendationId}`;

  // Pino structured log — canonical observable signal. Required fields
  // per the wiring spec: session_id (thread id) + tenant_id +
  // evidence_count + verdict + latency_ms.
  const logPayload = {
    session_id: input.threadId,
    tenant_id: input.tenantId,
    user_id: input.userId,
    persona_id: input.personaId,
    evidence_count: evidenceIds.length,
    invalid_evidence_count: invalidEvidenceIds.length,
    grounding_fault: groundingFault,
    verdict,
    latency_ms: latencyMs,
    tokens_used: input.tokensUsed ?? null,
    audit_log_id: auditLogId,
    ethics_recommendation: ethics.recommendation,
    ethics_dark_patterns: ethics.darkPatterns.map((d) => d.type),
    ethics_max_severity: ethics.maxSeverity,
  };
  if (ethics.violation) {
    logger.warn('chat response gate: ethics dark-pattern violation', logPayload);
  } else if (evidenceInvalid) {
    logger.warn('chat response auditor: evidence_invalid', logPayload);
  } else if (groundingFault) {
    logger.warn('chat response auditor: evidence_unverified (grounding fault)', logPayload);
  } else if (evidenceEmpty) {
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
    invalidEvidenceIds,
    groundingFault,
    violation,
    ethics,
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
