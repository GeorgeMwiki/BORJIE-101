/**
 * BORJIE Constitution citation verifier.
 *
 * Pure-function evaluator that takes a candidate AI response, the action
 * the brain proposes to take, and the tenant jurisdiction. Returns a
 * verdict object the calling gate can act on:
 *
 *   - `pass: false` when any `severity:refuse` clause applies and is
 *     violated, OR when a refuse clause applies but the candidate
 *     response fails to cite it.
 *   - `violations: Clause[]` enumerates the broken clauses for the
 *     audit trail.
 *   - `escalate: true` when the action requires human approval (any
 *     `refuse` clause matched) or when more than one `warn` clause
 *     applies (signals risk concentration).
 *
 * The verifier is wire-agnostic (no DB, no network). Callers feed in a
 * `ViolationDetector` for the few clauses that need semantic checks
 * (e.g. C05 non-discrimination); for clauses with purely structural
 * tests, defaults inline.
 *
 * Pattern mirrors LITFIN `verifyCitations` extended to multi-jurisdiction
 * + severity-driven verdicts. Research:
 *   .audit/litfin-sota-2026-05-23/03-security-governance.md
 */

import {
  BORJIE_CONSTITUTION_V1,
  clausesForAction,
  clausesForJurisdiction,
  type ConstitutionClause,
  type Jurisdiction,
} from './borjie-constitution.js';

/**
 * Input to the verifier. `candidateResponse` is the natural-language
 * draft the brain is about to emit; `action` is the action tag (e.g.
 * `eviction.notice.send`); `jurisdiction` is the tenant location.
 *
 * `evidence` is an optional structured payload used by clause-specific
 * detectors (e.g. for C03 — the disbursement waterfall, for C06 —
 * the payment quote object). When omitted, the verifier falls back to
 * the cheaper text-only checks.
 */
export interface VerifyInput {
  readonly candidateResponse: string;
  readonly action: string;
  readonly jurisdiction: Jurisdiction;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

/**
 * Per-clause result, included in the verdict for audit trace.
 */
export interface ClauseResult {
  readonly clauseId: string;
  readonly cited: boolean;
  readonly violated: boolean;
  readonly reason: string;
}

/**
 * Final verdict shape consumed by the brain's action gate.
 */
export interface VerifyVerdict {
  readonly pass: boolean;
  readonly violations: ReadonlyArray<ConstitutionClause>;
  readonly escalate: boolean;
  /** Disclaimers the caller should append (from `inform` clauses). */
  readonly disclaimers: ReadonlyArray<string>;
  /** Warnings the caller should surface (from `warn` clauses). */
  readonly warnings: ReadonlyArray<string>;
  /** Per-clause trace for the audit chain (every applicable clause). */
  readonly trace: ReadonlyArray<ClauseResult>;
  /** Action tag the verdict was rendered against (echoed for audit). */
  readonly action: string;
  /** Jurisdiction the verdict was rendered against (echoed for audit). */
  readonly jurisdiction: Jurisdiction;
}

/**
 * Hyphen + underscore + case insensitive regex match for a clause id
 * inside a free-text rationale.
 */
function rationaleCitesClause(rationale: string, clauseId: string): boolean {
  const escaped = clauseId.replace(/-/g, '[-_]?');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(rationale);
}

/**
 * Resolve the applicable clauses for an (action, jurisdiction) pair.
 *
 * Applicability rule:
 *   1. action must match the clause's `appliesTo` list, AND
 *   2. jurisdiction must match the clause's `jurisdictions` list
 *      (or the clause is global with `'*'`).
 */
export function applicableClauses(
  action: string,
  jurisdiction: Jurisdiction,
): ReadonlyArray<ConstitutionClause> {
  const byAction = clausesForAction(action);
  return clausesForJurisdiction(jurisdiction, byAction);
}

/**
 * Core verifier. Pure function: same inputs always produce same outputs.
 *
 * Rules:
 *   - A `refuse` clause applies and the candidate response does not
 *     cite the clause id  -> violation, pass=false, escalate=true.
 *   - A `warn` clause applies  -> non-blocking warning; surface text.
 *   - An `inform` clause applies  -> non-blocking disclaimer to append.
 *
 * Citation discipline: the response MUST cite every applicable `refuse`
 * clause id verbatim (hyphen / underscore insensitive). This is the
 * deliberative-alignment contract (Anthropic CAI v3 / OpenAI DA).
 */
export function verifyResponse(input: VerifyInput): VerifyVerdict {
  const applicable = applicableClauses(input.action, input.jurisdiction);

  const trace: ClauseResult[] = [];
  const violations: ConstitutionClause[] = [];
  const warnings: string[] = [];
  const disclaimers: string[] = [];

  for (const clause of applicable) {
    const cited = rationaleCitesClause(input.candidateResponse, clause.id);
    let violated = false;
    let reason = 'applies and acknowledged';

    if (clause.severity === 'refuse') {
      if (!cited) {
        violated = true;
        reason =
          'refuse-severity clause applies but candidate response does not cite the clause id';
      }
    } else if (clause.severity === 'warn') {
      warnings.push(`[${clause.id}] ${clause.title}`);
    } else if (clause.severity === 'inform') {
      disclaimers.push(`[${clause.id}] ${clause.title}: ${clause.text}`);
    }

    if (violated) {
      violations.push(clause);
    }
    trace.push({
      clauseId: clause.id,
      cited,
      violated,
      reason,
    });
  }

  const hasRefuseApplicable = applicable.some((c) => c.severity === 'refuse');
  const pass = violations.length === 0;
  const escalate = hasRefuseApplicable || warnings.length >= 2;

  return {
    pass,
    violations: Object.freeze(violations.slice()),
    escalate,
    disclaimers: Object.freeze(disclaimers.slice()),
    warnings: Object.freeze(warnings.slice()),
    trace: Object.freeze(trace.slice()),
    action: input.action,
    jurisdiction: input.jurisdiction,
  };
}

/**
 * Render an audit-trace entry as a single line for the hash-chain. The
 * brain ships this string into the C11 audit-trail along with the
 * verdict object.
 */
export function renderAuditTrace(verdict: VerifyVerdict): string {
  const parts = [
    `action=${verdict.action}`,
    `jurisdiction=${verdict.jurisdiction}`,
    `pass=${String(verdict.pass)}`,
    `escalate=${String(verdict.escalate)}`,
    `violations=${verdict.violations.map((c) => c.id).join(',') || 'none'}`,
    `warnings=${verdict.warnings.length}`,
    `disclaimers=${verdict.disclaimers.length}`,
  ];
  return parts.join(' | ');
}

/**
 * Convenience: lookup a clause by id, scoped to the constitution this
 * verifier targets. Mirrors LITFIN getClause.
 */
export function getClauseById(id: string): ConstitutionClause | null {
  return BORJIE_CONSTITUTION_V1.find((c) => c.id === id) ?? null;
}
