/**
 * PII redaction by clearance level.
 *
 * Clearance ranking: none < low < medium < high.
 * If the source requires a clearance higher than the agent holds, the
 * fragment is omitted from the agent context (and recorded in
 * `redactedFragmentIds` for audit).
 */

import type { PiiClearanceLevel } from '../types.js';

const CLEARANCE_RANK: Readonly<Record<PiiClearanceLevel, number>> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
};

export function clearanceRank(level: PiiClearanceLevel): number {
  return CLEARANCE_RANK[level];
}

export function hasClearance(args: {
  readonly agentClearance: PiiClearanceLevel;
  readonly fragmentRequires: PiiClearanceLevel;
}): boolean {
  return (
    CLEARANCE_RANK[args.agentClearance] >=
    CLEARANCE_RANK[args.fragmentRequires]
  );
}

/**
 * Detect and redact common PII patterns from a string. Used for
 * defence-in-depth when the agent must see a fragment but should not
 * see the PII inside it.
 *
 * Patterns covered:
 *   - Tanzanian phone numbers (+255 / 07xx / 06xx)
 *   - Kenyan phone numbers   (+254 / 07xx)
 *   - Ugandan phone numbers  (+256 / 07xx)
 *   - Generic email addresses
 *   - National ID numbers (20-digit TZ NIDA; 8-digit KE; UG variable)
 *   - Mobile money refs (M-Pesa, Tigo Pesa)
 */
export function redactPii(input: string): {
  readonly redacted: string;
  readonly hits: ReadonlyArray<{ kind: string; original: string }>;
} {
  const hits: Array<{ kind: string; original: string }> = [];
  let output = input;

  const patterns: ReadonlyArray<{ kind: string; regex: RegExp; replacement: string }> = [
    {
      kind: 'email',
      regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      replacement: '[REDACTED:email]',
    },
    {
      kind: 'phone-tz',
      regex: /(?:\+?255|0)[67]\d{8}/g,
      replacement: '[REDACTED:phone-tz]',
    },
    {
      kind: 'phone-ke',
      regex: /(?:\+?254|0)7\d{8}/g,
      replacement: '[REDACTED:phone-ke]',
    },
    {
      kind: 'phone-ug',
      regex: /(?:\+?256|0)7\d{8}/g,
      replacement: '[REDACTED:phone-ug]',
    },
    {
      kind: 'nida-tz',
      regex: /\b\d{20}\b/g,
      replacement: '[REDACTED:nida-tz]',
    },
    {
      kind: 'mobile-money-ref',
      regex: /\b[A-Z]{2}\d{8,12}[A-Z]{0,3}\b/g,
      replacement: '[REDACTED:mobile-money-ref]',
    },
  ];

  for (const { kind, regex, replacement } of patterns) {
    const matches = output.match(regex) ?? [];
    for (const m of matches) {
      hits.push({ kind, original: m });
    }
    output = output.replace(regex, replacement);
  }

  return { redacted: output, hits };
}
