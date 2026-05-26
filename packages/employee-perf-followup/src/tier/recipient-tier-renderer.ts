/**
 * Recipient-tier renderer (Wave PERF-1).
 *
 * Implements the three-tier privacy matrix mandated by
 * `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md §3`:
 *
 *   | Recipient                | Counts | Streaks | Content body            |
 *   |--------------------------|--------|---------|--------------------------|
 *   | Subject (employee)       | ✓      | ✓       | full text               |
 *   | Direct supervisor (1-up) | ✓      | ✓       | redacted ≤2 sentences   |
 *   | Owner (root MD)          | ✓      | ✓       | aggregate stats only    |
 *   | Cross-tenant / federation| ✗      | ✗       | never shared            |
 *
 * The supervisor view replaces every detected PII identifier with a
 * salted SHA-256-derived placeholder and caps the body to two
 * sentences. The owner view drops the body entirely and returns
 * aggregate stats only.
 *
 * Citations (per FOUNDER_LOCKED §3):
 *   - GDPR Art. 5(1)(c) — data minimisation
 *     https://gdpr.eu/article-5-how-to-process-personal-data/
 *   - NIST SP 800-122 — PII protection guide
 *     https://csrc.nist.gov/publications/detail/sp/800-122/final
 *   - Apple Differential Privacy Overview
 *     https://www.apple.com/privacy/docs/Differential_Privacy_Overview.pdf
 *   - MIT Tacit-Knowledge access control (Nonaka 1995 SECI model)
 */

import {
  SUPERVISOR_TIER_SENTENCE_CAP,
  type AggregateOwnerStats,
  type EmployeeScorecard,
  type RecipientTier,
  type TieredView,
} from '../types.js';

export interface RenderInput {
  readonly scorecard: EmployeeScorecard;
  readonly tier: RecipientTier;
  readonly fullBody: string;
  /** For owner aggregate — every scorecard in the tenant for the date. */
  readonly tenantScorecardsForDate?: ReadonlyArray<EmployeeScorecard>;
  /** Redactor — production wires session-mirror's salted-sha256 redactor. */
  readonly redact?: (text: string) => string;
}

/** Default redactor — strips common PII shapes and masks bare-word
 *  identifiers (proper-noun shaped). Production hosts override. */
function defaultRedactor(text: string): string {
  let out = text;
  // Email addresses.
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[redacted-email]');
  // Phone-ish runs of digits (≥7 in a row).
  out = out.replace(/\d{7,}/g, '[redacted-num]');
  // National IDs / passports — capital letter runs followed by digits.
  out = out.replace(/\b[A-Z]{2,}\d{4,}\b/g, '[redacted-id]');
  // Proper-noun shaped bare words (capitalised) longer than 3 chars,
  // when preceded by a space (avoid mangling start-of-sentence words).
  // We keep a small allow-list of band/state words.
  const ALLOW = new Set([
    'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
    'Oct', 'Nov', 'Dec', 'Yes', 'No', 'On', 'Off',
  ]);
  out = out.replace(
    /(^|\s)([A-Z][a-z]{3,})/g,
    (_m, lead: string, word: string) => {
      if (ALLOW.has(word)) return `${lead}${word}`;
      return `${lead}[redacted]`;
    },
  );
  return out;
}

/**
 * Truncate `text` to the first `n` sentences. Sentence boundaries
 * are `.`, `!`, `?` followed by whitespace or EOL.
 */
export function truncateToSentences(text: string, n: number): string {
  if (n <= 0) return '';
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  const re = /[.!?](\s|$)/g;
  let count = 0;
  let endIdx = trimmed.length;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    count += 1;
    if (count === n) {
      endIdx = m.index + 1;
      break;
    }
  }
  let out = trimmed.slice(0, endIdx).trim();
  // If we hit the cap before the original ended, mark the truncation.
  if (count >= n && endIdx < trimmed.length) {
    if (!/[.!?]$/.test(out)) out = `${out}.`;
    out = `${out} …`;
  }
  return out;
}

function countsFromScorecard(card: EmployeeScorecard): {
  readonly kpis_total: number;
  readonly kpis_at_or_above: number;
} {
  const ON_TARGET_FLOOR = 0.7;
  let atOrAbove = 0;
  for (const r of card.kpis) {
    if (r.band >= ON_TARGET_FLOOR) atOrAbove += 1;
  }
  return { kpis_total: card.kpis.length, kpis_at_or_above: atOrAbove };
}

function streakFromScorecard(card: EmployeeScorecard): number {
  const sig = card.signals as { streak_days?: number };
  return typeof sig.streak_days === 'number' ? sig.streak_days : 0;
}

function topAnomalies(
  cards: ReadonlyArray<EmployeeScorecard>,
  cap: number,
): ReadonlyArray<string> {
  const counts = new Map<string, number>();
  for (const c of cards) {
    const sig = c.signals as { anomalies?: ReadonlyArray<string> };
    const arr = sig.anomalies ?? [];
    for (const a of arr) {
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
  }
  const entries: Array<readonly [string, number]> = [];
  for (const e of counts.entries()) entries.push(e);
  entries.sort((a, b) => b[1] - a[1]);
  return entries.slice(0, cap).map((e) => e[0]);
}

function computeAggregate(
  cards: ReadonlyArray<EmployeeScorecard>,
): AggregateOwnerStats {
  if (cards.length === 0) {
    return {
      n_employees: 0,
      mean_score: 0,
      n_below_target: 0,
      n_exceeded: 0,
      top_signals: [],
    };
  }
  let sum = 0;
  let below = 0;
  let exceeded = 0;
  const BELOW_FLOOR = 0.7;
  const EXCEED_FLOOR = 0.9;
  for (const c of cards) {
    sum += c.overall_score;
    if (c.overall_score < BELOW_FLOOR) below += 1;
    if (c.overall_score >= EXCEED_FLOOR) exceeded += 1;
  }
  return {
    n_employees: cards.length,
    mean_score: sum / cards.length,
    n_below_target: below,
    n_exceeded: exceeded,
    top_signals: topAnomalies(cards, 3),
  };
}

/**
 * Render a single tiered view from a scorecard. The renderer is the
 * sole enforcement point for the FOUNDER_LOCKED §3 matrix — every
 * downstream surface (chat, email, WhatsApp) consumes the output of
 * this function and adds no privacy logic of its own.
 */
export function renderTier(input: RenderInput): TieredView {
  const { scorecard, tier, fullBody } = input;
  const counts = countsFromScorecard(scorecard);
  const streak_days = streakFromScorecard(scorecard);
  const redactor = input.redact ?? defaultRedactor;
  if (tier === 'subject') {
    return {
      tier,
      counts,
      streak_days,
      body: fullBody,
    };
  }
  if (tier === 'supervisor') {
    const redacted = redactor(fullBody);
    const capped = truncateToSentences(
      redacted,
      SUPERVISOR_TIER_SENTENCE_CAP,
    );
    return {
      tier,
      counts,
      streak_days,
      body: capped,
    };
  }
  // owner tier — aggregate stats only.
  const aggregate = computeAggregate(
    input.tenantScorecardsForDate ?? [scorecard],
  );
  return {
    tier,
    counts,
    streak_days,
    body: '',
    aggregate,
  };
}

/** Cross-tenant / federation guard — explicit null per FOUNDER_LOCKED §3. */
export function renderCrossTenantView(): TieredView | null {
  return null;
}
