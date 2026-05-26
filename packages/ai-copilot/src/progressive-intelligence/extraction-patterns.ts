/**
 * Extraction Patterns — regex + small-LLM hybrid extractors.
 *
 * Scans a raw text blob (chat turn, document, form field) and extracts
 * typed signals: amounts, dates, phones, NIDA IDs, property refs.
 *
 * Tuned for Tanzania and Kenya patterns but extensible per country.
 *
 * @module progressive-intelligence/extraction-patterns
 */

export type PatternKind =
  | 'amount'
  | 'date'
  | 'phone_tz'
  | 'phone_ke'
  | 'national_id_tz'
  | 'national_id_ke'
  | 'property_ref'
  | 'unit_label'
  | 'email'
  | 'duration_months';

export interface PatternMatch {
  readonly kind: PatternKind;
  readonly raw: string;
  readonly normalized: string | number;
  readonly confidence: number;
  readonly offset: number;
}

// ============================================================================
// Phone-prefix table
// ============================================================================
//
// Source of truth for the country dialing codes we extract from raw text.
// Each entry carries the ISO-3166 alpha-2 code, the international dialing
// prefix, and the national-format leading digit(s) we accept after `0`.
//
// IMPORTANT — this list is the bridge to `getJurisdictionalRules(country)`
// in `packages/domain-models/src/common/jurisdictional-rules.ts` (landing
// in ProdFix-5). Once that module merges, swap this constant for a
// runtime read so adding a new country no longer requires touching the
// extractor.
export const KNOWN_PHONE_PREFIXES: readonly {
  readonly country: string;
  readonly dialing: string;
  readonly national: string; // regex fragment, no anchors
}[] = Object.freeze([
  { country: 'TZ', dialing: '255', national: '[67]\\d{8}' },
  { country: 'KE', dialing: '254', national: '[17]\\d{8}' },
  { country: 'UG', dialing: '256', national: '[37]\\d{8}' },
  { country: 'RW', dialing: '250', national: '[78]\\d{8}' },
  { country: 'ZA', dialing: '27', national: '[678]\\d{8}' },
  { country: 'NG', dialing: '234', national: '[789]\\d{9}' },
]);

// ============================================================================
// Patterns
// ============================================================================

const PATTERNS = [
  {
    kind: 'amount' as const,
    pattern:
      /(?:TZS|TSH|KES|KSh|USD|\$)?\s*([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{1,2})?)\s*(?:TZS|TSH|KES|KSh|USD|\/=|-)?/g,
    normalize: (raw: string): number => {
      const digits = raw.replace(/[^0-9.]/g, '');
      return Number.parseFloat(digits);
    },
    minConfidence: 0.6,
  },
  {
    kind: 'date' as const,
    pattern:
      /\b(\d{1,2}[-/][A-Za-z]{3}[-/]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})\b/g,
    normalize: (raw: string): string => {
      try {
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) return raw;
        return d.toISOString().slice(0, 10);
      } catch {
        return raw;
      }
    },
    minConfidence: 0.7,
  },
  {
    kind: 'phone_tz' as const,
    pattern: /(?:\+255|255|0)[67]\d{8}/g,
    normalize: (raw: string): string => {
      const digits = raw.replace(/\D/g, '');
      if (digits.startsWith('255')) return `+${digits}`;
      if (digits.startsWith('0')) return `+255${digits.slice(1)}`;
      if (digits.length === 9) return `+255${digits}`;
      return `+${digits}`;
    },
    minConfidence: 0.9,
  },
  {
    kind: 'phone_ke' as const,
    pattern: /(?:\+254|254|0)7\d{8}/g,
    normalize: (raw: string): string => {
      const digits = raw.replace(/\D/g, '');
      if (digits.startsWith('254')) return `+${digits}`;
      if (digits.startsWith('0')) return `+254${digits.slice(1)}`;
      if (digits.length === 9) return `+254${digits}`;
      return `+${digits}`;
    },
    minConfidence: 0.85,
  },
  {
    // Tanzania NIDA is 20 digits
    kind: 'national_id_tz' as const,
    pattern: /\b\d{8}[- ]\d{5}[- ]\d{5}[- ]\d{2}\b/g,
    normalize: (raw: string): string => raw.replace(/[\s-]/g, ''),
    minConfidence: 0.95,
  },
  {
    // Kenya national ID is 7-8 digits (heuristic; needs context)
    kind: 'national_id_ke' as const,
    pattern: /\bID\s*(?:no\.?|number)?\s*[:#]?\s*(\d{7,8})\b/gi,
    normalize: (raw: string): string => raw.replace(/\D/g, ''),
    minConfidence: 0.7,
  },
  {
    kind: 'property_ref' as const,
    pattern: /\b(?:PLOT|LR|L\.R\.)\s*([A-Z0-9/-]{3,20})\b/gi,
    normalize: (raw: string): string => raw.toUpperCase().trim(),
    minConfidence: 0.85,
  },
  {
    kind: 'unit_label' as const,
    pattern: /\b(?:unit|apartment|apt|flat|room)\s+([A-Z0-9-]{1,6})\b/gi,
    normalize: (raw: string): string => {
      const match = raw.match(/([A-Z0-9-]{1,6})$/i);
      return match && match[1] !== undefined ? match[1].toUpperCase() : raw.toUpperCase();
    },
    minConfidence: 0.75,
  },
  {
    kind: 'email' as const,
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    normalize: (raw: string): string => raw.toLowerCase(),
    minConfidence: 0.95,
  },
  {
    kind: 'duration_months' as const,
    pattern: /\b(\d{1,3})\s*(?:month|mo\.?|months)\b/gi,
    normalize: (raw: string): number => {
      const match = raw.match(/(\d+)/);
      return match && match[1] !== undefined ? Number.parseInt(match[1], 10) : 0;
    },
    minConfidence: 0.9,
  },
] as const;

export interface ExtractionOptions {
  readonly kinds?: readonly PatternKind[];
  readonly minConfidence?: number;
}

/**
 * Extract structured signals from text.
 *
 * Returns all matches; caller chooses which to keep by confidence/kind.
 */
export function extractFromMessage(
  text: string,
  options: ExtractionOptions = {},
): readonly PatternMatch[] {
  if (!text) return [];
  const out: PatternMatch[] = [];
  const minConf = options.minConfidence ?? 0;

  for (const spec of PATTERNS) {
    if (options.kinds && !options.kinds.includes(spec.kind)) continue;
    // Re-create regex to reset `lastIndex` across calls
    const re = new RegExp(spec.pattern.source, spec.pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const raw = match[0];
      const normalized = spec.normalize(raw);
      if (
        typeof normalized === 'number' &&
        (Number.isNaN(normalized) || normalized === 0 && spec.kind === 'amount')
      ) {
        continue;
      }
      if (spec.minConfidence < minConf) continue;
      out.push({
        kind: spec.kind,
        raw,
        normalized,
        confidence: spec.minConfidence,
        offset: match.index,
      });
    }
  }

  return out;
}

/** Convenience: return the highest-confidence match of a specific kind. */
export function firstMatch(
  matches: readonly PatternMatch[],
  kind: PatternKind,
): PatternMatch | null {
  const filtered = matches.filter((m) => m.kind === kind);
  if (filtered.length === 0) return null;
  return [...filtered].sort((a, b) => b.confidence - a.confidence)[0] ?? null;
}
