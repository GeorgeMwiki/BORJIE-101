/**
 * Policy gate — deterministic OUTPUT validation + per-request context
 * checks. Runs after the sensor returns and before the kernel commits
 * the answer. Six concerns, in order:
 *
 *   1. Tenant-isolation context check — when a `request.tenantId` is
 *      supplied alongside a `decision.tenantId`, the two MUST match.
 *      Stops the kernel from emitting an answer claimed under one
 *      tenant scope that was actually produced inside a different
 *      tenant's context.
 *
 *   2. Scope-match context check — when the action being executed
 *      declares a set of required scopes, every one of them must be
 *      present in the caller's granted-scope set. (Defence-in-depth
 *      complement to the prompt-shield + autonomy-policy.)
 *
 *   3. Cost-ceiling context check — per-call USD-ceiling per tier:
 *      free=$0.05, pro=$0.25, enterprise=$2.50 (configurable via
 *      `costCeilings`). If `request.estimatedCostUsd` exceeds the
 *      caller's tier ceiling, the gate refuses BEFORE we render the
 *      output to disk. Sovereign actions are exempted (they go through
 *      the four-eye gate which carries its own cost authority).
 *
 *   4. Off-hours sensitive-action context check — refuses sovereign-
 *      tier (`stakes: 'critical'`) actions outside Tanzania business
 *      hours (08:00–18:00 EAT, Mon–Fri) unless the caller has supplied
 *      `afterHoursOverride: true`. Property management example: an
 *      eviction proposal at 23:30 on a Sunday almost never reflects a
 *      sober decision.
 *
 *   5. PII redaction — phone / national-id / email leakage that the
 *      sensor accidentally reproduced from a tool result.
 *
 *   6. Numerical claim hedging + regulatory hedge — un-cited absolute
 *      numbers and eviction/lockout language get softened.
 *
 * The new context checks (1)–(4) only fire when `input.request` is
 * supplied. Existing callers that pass `{ text, hasCitations }` see
 * the original output-only behaviour unchanged.
 *
 * The gate is a pure function. It returns an outcome describing what
 * was done so the kernel can decide whether the result is "pass",
 * "soften", or "block".
 */

import type { GateVerdict } from './kernel-types.js';

// ─────────────────────────────────────────────────────────────────────
// New context types for the K5 parity checks
// ─────────────────────────────────────────────────────────────────────

export type PolicyGateTier = 'free' | 'pro' | 'enterprise' | 'sovereign';

export interface PolicyGateRequestContext {
  /** Tenant scope the caller claims to be operating inside. */
  readonly tenantId?: string;
  /** Caller's granted scopes (action.read, payouts.write, etc.). */
  readonly grantedScopes?: ReadonlyArray<string>;
  /** Subscription tier — drives the cost ceiling. */
  readonly tier?: PolicyGateTier;
  /** USD cost the kernel estimates for this turn. */
  readonly estimatedCostUsd?: number;
  /** Stakes for this turn — drives the off-hours gate. */
  readonly stakes?: 'low' | 'medium' | 'high' | 'critical';
  /** When TRUE the caller explicitly accepts the off-hours risk. */
  readonly afterHoursOverride?: boolean;
  /** Optional override clock for the off-hours check; defaults to now. */
  readonly now?: Date;
  /** D9 — caller's preferred language. Drives language-consistency check. */
  readonly language?: 'en' | 'sw';
  /** D9 — numerical baselines per metric for the 10x-numerical-sanity heuristic. */
  readonly numericalBaselines?: Readonly<Record<string, number>>;
}

export interface PolicyGateDecisionContext {
  /** Tenant scope the produced output is actually grounded in. */
  readonly tenantId?: string;
  /** Scopes the action requires to execute. */
  readonly requiredScopes?: ReadonlyArray<string>;
  /** D9 — TRUE when the produced text makes a factual claim that needs a source. */
  readonly hasFactualClaim?: boolean;
  /** D9 — TRUE when the secondary judge contradicts the primary on a fact. */
  readonly judgeContradicted?: boolean;
}

export interface PolicyGateInput {
  readonly text: string;
  readonly hasCitations: boolean;
  readonly request?: PolicyGateRequestContext;
  readonly decision?: PolicyGateDecisionContext;
  /** Operator-tunable per-tier ceilings (USD per call). */
  readonly costCeilings?: Partial<Record<PolicyGateTier, number>>;
}

export interface PolicyGateOutput {
  readonly verdict: GateVerdict;
  readonly redactedText: string;
  readonly mutations: ReadonlyArray<string>;
}

// ─────────────────────────────────────────────────────────────────────
// Output PII / regulatory patterns (unchanged)
// ─────────────────────────────────────────────────────────────────────

const PII_PATTERNS: ReadonlyArray<{ kind: string; re: RegExp; replace: string }> = [
  { kind: 'phone-tz',  re: /\+?255[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}/g, replace: '[redacted-phone]' },
  { kind: 'phone-ke',  re: /\+?254[\s-]?\d{3}[\s-]?\d{3}[\s-]?\d{3}/g, replace: '[redacted-phone]' },
  { kind: 'phone-gen', re: /\b0[67]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g,    replace: '[redacted-phone]' },
  { kind: 'email',     re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,  replace: '[redacted-email]' },
  { kind: 'nida',      re: /\b\d{8}-\d{5}-\d{5}-\d{2}\b/g,             replace: '[redacted-nida]' },
];

const NUMERICAL_PATTERN = /\b\d{1,3}(?:[.,]\d+)?%/g; // 92.3% etc
// ISO-4217 + common informal labels. BORJIE is global — every
// currency we ship a plugin for must be detected here, otherwise the
// policy gate misses a money claim. Source of truth lives in
// packages/ai-copilot/src/security/currency-patterns.ts; replicated here
// because central-intelligence cannot import from ai-copilot (would
// create a backward edge).
const ABSOLUTE_MONEY_PATTERN =
  /\b(?:TZS|KES|UGX|RWF|NGN|ZAR|GHS|EGP|USD|EUR|GBP|CHF|JPY|CNY|INR|AUD|CAD|Ksh|KShs|Tsh|TShs|Sh|Shs)\s?\d[\d,]*(?:\.\d+)?\b/gi;

const REGULATORY_TRIGGERS: ReadonlyArray<RegExp> = [
  /\bevict\w*/i,
  /\bterminate? (the )?lease\b/i,
  /\bvacate (the )?premises\b/i,
  /\blockout\b/i,
];

// ─────────────────────────────────────────────────────────────────────
// Tier cost ceilings (USD per call)
// ─────────────────────────────────────────────────────────────────────

export const DEFAULT_COST_CEILINGS: Readonly<Record<PolicyGateTier, number>> =
  Object.freeze({
    free: 0.05,
    pro: 0.25,
    enterprise: 2.5,
    sovereign: Number.POSITIVE_INFINITY,
  });

// ─────────────────────────────────────────────────────────────────────
// Business-hours window (Tanzania — EAT, UTC+3)
// ─────────────────────────────────────────────────────────────────────

const BUSINESS_HOURS_TZ_OFFSET_MINUTES = 180; // EAT = UTC+3
const BUSINESS_HOUR_START = 8;  // 08:00 EAT
const BUSINESS_HOUR_END = 18;   // 18:00 EAT exclusive
// 1=Mon … 5=Fri (EAT)
const BUSINESS_WEEKDAYS: ReadonlyArray<number> = [1, 2, 3, 4, 5];

function isWithinBusinessHoursEAT(now: Date): boolean {
  const eatMs = now.getTime() + BUSINESS_HOURS_TZ_OFFSET_MINUTES * 60_000;
  const eat = new Date(eatMs);
  const dayUTC = eat.getUTCDay(); // 0=Sun .. 6=Sat
  const hourUTC = eat.getUTCHours();
  if (!BUSINESS_WEEKDAYS.includes(dayUTC)) return false;
  return hourUTC >= BUSINESS_HOUR_START && hourUTC < BUSINESS_HOUR_END;
}

// ─────────────────────────────────────────────────────────────────────
// Block helper
// ─────────────────────────────────────────────────────────────────────

function blockedOutput(reason: string, mutation: string): PolicyGateOutput {
  return {
    verdict: { status: 'block', reason },
    redactedText: '',
    mutations: [mutation],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export function runPolicyGate(initialInput: PolicyGateInput): PolicyGateOutput {
  let input: PolicyGateInput = initialInput;
  const request = input.request;
  const decision = input.decision;
  // D9 mutations accumulate here so they survive the existing
  // `mutations` initialisation below.
  const preMutations: string[] = [];

  // 1) Tenant-isolation context check.
  if (
    request?.tenantId &&
    decision?.tenantId &&
    request.tenantId !== decision.tenantId
  ) {
    return blockedOutput(
      `tenant-isolation violation: request.tenantId="${request.tenantId}" but decision.tenantId="${decision.tenantId}"`,
      'blocked:tenant-isolation',
    );
  }

  // 2) Scope-match context check.
  if (decision?.requiredScopes && decision.requiredScopes.length > 0) {
    const granted = new Set(request?.grantedScopes ?? []);
    const missing = decision.requiredScopes.filter((s) => !granted.has(s));
    if (missing.length > 0) {
      return blockedOutput(
        `missing required scope(s): ${missing.join(', ')}`,
        'blocked:scope-mismatch',
      );
    }
  }

  // 3) Cost-ceiling context check (sovereign tier is exempted — its budget
  //    is governed by the four-eye gate, not by this gate).
  if (
    request?.tier &&
    request.tier !== 'sovereign' &&
    typeof request.estimatedCostUsd === 'number' &&
    Number.isFinite(request.estimatedCostUsd) &&
    request.estimatedCostUsd >= 0
  ) {
    const ceilings = { ...DEFAULT_COST_CEILINGS, ...(input.costCeilings ?? {}) };
    const ceiling = ceilings[request.tier];
    if (typeof ceiling === 'number' && request.estimatedCostUsd > ceiling) {
      return blockedOutput(
        `cost-ceiling exceeded: estimated $${request.estimatedCostUsd.toFixed(4)} > tier "${request.tier}" ceiling $${ceiling.toFixed(2)}`,
        'blocked:cost-ceiling',
      );
    }
  }

  // 4) Off-hours sovereign-action context check.
  if (
    request?.stakes === 'critical' &&
    request.afterHoursOverride !== true
  ) {
    const now = request.now ?? new Date();
    if (!isWithinBusinessHoursEAT(now)) {
      return blockedOutput(
        'sovereign-tier action refused outside Tanzania business hours (08:00–18:00 EAT weekdays); supply afterHoursOverride=true to proceed',
        'blocked:off-hours-sovereign',
      );
    }
  }

  // 5) D9 — language-consistency check (soften / hedge).
  if (request?.language) {
    if (detectLanguageMismatch(input.text, request.language)) {
      input = {
        ...input,
        text: `${input.text.trimEnd()}\n\n(Note: response language requested as "${request.language}" — please verify against the source-language version.)`,
      };
      preMutations.push('hedged:language-consistency');
    }
  }

  // 6) D9 — grounding-cite check (block).
  if (decision?.hasFactualClaim === true && !input.hasCitations) {
    return blockedOutput(
      'grounding-cite violation: response contains a factual claim but no source citation was attached',
      'blocked:grounding-cite',
    );
  }

  // 7) D9 — fabrication (judge cross-check) gate (block).
  if (decision?.judgeContradicted === true) {
    return blockedOutput(
      'fabrication suspected: secondary judge contradicted the primary sensor on a factual claim',
      'blocked:fabrication',
    );
  }

  // 8) D9 — 10x-numerical-sanity heuristic (soften / hedge).
  if (
    request?.numericalBaselines &&
    Object.keys(request.numericalBaselines).length > 0
  ) {
    const flagged = detectTenXSanityViolations(
      input.text,
      request.numericalBaselines,
    );
    if (flagged.length > 0) {
      input = {
        ...input,
        text: appendSanityHedge(input.text, flagged),
      };
      preMutations.push('hedged:10x-numerical-sanity');
    }
  }

  // ─── Output-side checks (unchanged) ────────────────────────────────
  let text = input.text;
  const mutations: string[] = [...preMutations];

  for (const p of PII_PATTERNS) {
    if (p.re.test(text)) {
      text = text.replace(p.re, p.replace);
      mutations.push(`redacted:${p.kind}`);
    }
  }

  if (!input.hasCitations) {
    if (NUMERICAL_PATTERN.test(text)) {
      mutations.push('hedged:uncited-percentage');
      text = text.replace(
        NUMERICAL_PATTERN,
        (m) => `${m} (uncited — verify against the source tool)`,
      );
    }
    if (ABSOLUTE_MONEY_PATTERN.test(text)) {
      mutations.push('hedged:uncited-money');
      text = text.replace(
        ABSOLUTE_MONEY_PATTERN,
        (m) => `${m} (uncited — verify against the ledger)`,
      );
    }
  }

  let regulatoryHit = false;
  for (const re of REGULATORY_TRIGGERS) {
    if (re.test(text)) {
      regulatoryHit = true;
      break;
    }
  }
  if (regulatoryHit && !/arrears ladder|notice period|tribunal/i.test(text)) {
    text =
      text.trimEnd() +
      '\n\nNote: any termination action must follow the documented arrears ladder and notice period. I am not the decision-maker for those steps.';
    mutations.push('appended:regulatory-hedge');
  }

  let verdict: GateVerdict;
  if (mutations.some((m) => m.startsWith('redacted:'))) {
    verdict = { status: 'soften', reason: 'PII redacted in output' };
  } else if (mutations.length > 0) {
    verdict = { status: 'soften', reason: 'output hedged for regulatory or citation safety' };
  } else {
    verdict = { status: 'pass' };
  }

  return { verdict, redactedText: text, mutations };
}

/** Exported for diagnostics + tests; do not mutate. */
export { isWithinBusinessHoursEAT };
// ──────────────────────────────────────────────────────────────────
// D9 helpers — language consistency + 10x numerical sanity.
// ──────────────────────────────────────────────────────────────────

const SWAHILI_MARKERS: ReadonlyArray<RegExp> = [
  /\b(ni|na|ya|wa|katika|kwa|kwamba|hii|hiyo|hivyo|sasa|baada|kabla)\b/gi,
  /\b(nyumba|pango|kodi|mwenye|mpangaji|mwezi|siku|leo|jana|kesho)\b/gi,
  /\b(habari|asante|tafadhali|samahani|karibu|jambo|mambo)\b/gi,
];

const ENGLISH_MARKERS: ReadonlyArray<RegExp> = [
  /\b(the|and|is|are|was|were|will|with|in|on|at|by|for|to|of|from)\b/gi,
  /\b(rent|lease|tenant|property|unit|payment|invoice|arrears|notice|month|day)\b/gi,
];

export function detectLanguageMismatch(text: string, expected: 'en' | 'sw'): boolean {
  if (!text || text.length < 40) return false;
  let sw = 0;
  let en = 0;
  for (const re of SWAHILI_MARKERS) {
    sw += (text.match(re) ?? []).length;
  }
  for (const re of ENGLISH_MARKERS) {
    en += (text.match(re) ?? []).length;
  }
  const total = sw + en;
  if (total < 4) return false;
  const swRatio = sw / total;
  const enRatio = en / total;
  if (expected === 'sw' && swRatio < 0.4) return true;
  if (expected === 'en' && enRatio < 0.6) return true;
  return false;
}

export interface NumericalSanityFlag {
  readonly metric: string;
  readonly baseline: number;
  readonly observed: number;
  readonly ratio: number;
}

const TEN_X_LOW = 9;
const TENTH_LOW = 0.05;
const TENTH_HIGH = 0.15;

export function detectTenXSanityViolations(
  text: string,
  baselines: Readonly<Record<string, number>>,
): ReadonlyArray<NumericalSanityFlag> {
  const flags: NumericalSanityFlag[] = [];
  const lower = text.toLowerCase();
  for (const [metric, baseline] of Object.entries(baselines)) {
    if (!Number.isFinite(baseline) || baseline === 0) continue;
    const idx = lower.indexOf(metric.toLowerCase());
    if (idx < 0) continue;
    const window = text.slice(Math.max(0, idx - 80), idx + metric.length + 80);
    const numbers = (window.match(/[\d][\d,]*(?:\.\d+)?/g) ?? [])
      .map((s) => Number(s.replace(/,/g, '')))
      .filter((n) => Number.isFinite(n) && (n < 1900 || n > 2100 || n > 3_000));
    for (const n of numbers) {
      if (n === baseline) continue;
      const ratio = n / baseline;
      if (
        (ratio >= TEN_X_LOW && ratio <= 100) ||
        (ratio >= TENTH_LOW && ratio <= TENTH_HIGH)
      ) {
        flags.push({ metric, baseline, observed: n, ratio });
        break;
      }
    }
  }
  return flags;
}

function appendSanityHedge(
  text: string,
  flagged: ReadonlyArray<NumericalSanityFlag>,
): string {
  const lines = flagged.map(
    (f) =>
      `  - ${f.metric}: observed ${f.observed} vs baseline ${f.baseline} (${f.ratio.toFixed(1)}× shift) — verify against the ledger before acting.`,
  );
  return `${text.trimEnd()}\n\nNumerical-sanity flag (10× rule):\n${lines.join('\n')}`;
}
