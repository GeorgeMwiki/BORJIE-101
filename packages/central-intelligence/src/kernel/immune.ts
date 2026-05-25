/**
 * Cognitive immune system — generic input screener (step 1a).
 *
 * The existing `checkPublicInviolable` covers the unauthenticated
 * marketing surface only. This module extends the immune-system idea
 * to ALL surfaces: tenant-app, owner-portal, estate-manager-app,
 * admin-portal, platform-hq, classroom. Per-surface tunings make the
 * tenant-app permissive of "I'd like to pay rent" while keeping the
 * admin-portal alert to admin-impersonation attempts.
 *
 * Verdicts:
 *   - 'allow'                — proceed unchanged
 *   - 'sanitize_and_proceed' — sanitised text replaces the original;
 *                              the kernel uses the returned `sanitized`
 *                              text downstream
 *   - 'refuse'               — block the turn with a category-keyed
 *                              refusal reason
 *
 * The screener is pure (regex + string ops), no LLM. Composition
 * roots may extend the rule sets per tenant by passing
 * `extraPatterns`.
 */

export type ImmuneSurface =
  | 'marketing'
  | 'tenant-app'
  | 'owner-portal'
  | 'estate-manager-app'
  | 'admin-portal'
  | 'platform-hq'
  | 'classroom';

export type ImmuneCategory =
  | 'prompt-injection'
  | 'system-prompt-extraction'
  | 'pii-overshare'
  | 'admin-impersonation'
  | 'malicious-payload'
  | 'oversized-input';

export type ImmuneVerdict = 'allow' | 'sanitize_and_proceed' | 'refuse';

export interface ImmuneScreenContext {
  /** Optional tenant id so per-tenant rule overlays can fire. */
  readonly tenantId?: string | null;
  /** Optional auth roles for admin-impersonation checks. */
  readonly callerRoles?: ReadonlyArray<string>;
}

export interface ImmuneScreenResult {
  readonly verdict: ImmuneVerdict;
  readonly category?: ImmuneCategory;
  readonly reason?: string;
  /** Present when verdict === 'sanitize_and_proceed'. */
  readonly sanitized?: string;
}

export interface ImmuneScreenInput {
  readonly text: string;
  readonly surface: ImmuneSurface;
  readonly ctx?: ImmuneScreenContext;
}

// ─────────────────────────────────────────────────────────────────────
// Patterns
// ─────────────────────────────────────────────────────────────────────

const PROMPT_INJECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\bignore\s+(previous|all|the\s+above|prior)\s+instructions?\b/i,
  /\bdisregard\s+(your|all|the|previous)\s+(instructions?|rules?|guidelines?|prompt)/i,
  /\b(developer|admin|root|debug|jailbreak|DAN)\s+mode\b/i,
  /```[^`]*\bsystem\s*:/i,
  /<\s*\|?\s*system\s*\|?\s*>/i,
  /\boverride\s+(your|all|the)\s+(safety|prompt|instructions?|policy|rules?)/i,
];

const SYSTEM_PROMPT_EXTRACTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(reveal|show|print|repeat|output|recite|leak|expose)\s+(me\s+)?(your|the)\s+(system\s+prompt|initial\s+instructions?|hidden\s+(rules?|prompt)|original\s+(prompt|instructions?))/i,
  /\bwhat\s+(is|are|were)\s+(your|the)\s+(initial|hidden|original|system)\s+(instructions?|prompt|rules?)/i,
  /\b(dump|exfiltrate|expose)\s+(your|the)\s+(prompt|configuration|secrets?|api\s*keys?)/i,
];

const ADMIN_IMPERSONATION_PATTERNS: ReadonlyArray<RegExp> = [
  /\bi\s+am\s+(from|with|on\s+behalf\s+of)\s+(borjie|boss[-\s]?nyumba|the\s+platform|admin|hq|head\s+office|support|the\s+team|the\s+developers?)/i,
  /\b(this\s+is|i'?m)\s+(a\s+)?(borjie|platform|admin|hq|support|developer|engineer)\b/i,
  /\bas\s+(an?\s+)?(authoris?ed|verified)\s+(admin|operator|staff|engineer|tester)\b/i,
];

// PII patterns we *sanitise* rather than refuse — e.g. user pastes
// their card number into a complaint. We mask and proceed.
const PII_PATTERNS: ReadonlyArray<{ pattern: RegExp; mask: string }> = [
  // Credit-card-shaped digit blob (Luhn not validated; mask aggressively).
  { pattern: /\b(?:\d[ -]?){13,19}\b/g, mask: '[redacted-card]' },
  // M-Pesa / mobile money txn ids (QPx[A-Z0-9]{7+}, etc.).
  { pattern: /\b[A-Z]{2,4}\d{6,12}\b/g, mask: '[redacted-txn]' },
];

// Malicious payload — script tags, SQL-ish union-select obvious markers.
const MALICIOUS_PAYLOAD_PATTERNS: ReadonlyArray<RegExp> = [
  /<\s*script[\s>]/i,
  /\bunion\s+all\s+select\b/i,
  /\bdrop\s+table\b/i,
  /\b;\s*--\s*$/m,
];

// ─────────────────────────────────────────────────────────────────────
// Per-surface tunings — refusal vs. sanitise behaviour.
// ─────────────────────────────────────────────────────────────────────

const MAX_INPUT_CHARS_BY_SURFACE: Record<ImmuneSurface, number> = {
  marketing: 2_000,
  'tenant-app': 4_000,
  'owner-portal': 6_000,
  'estate-manager-app': 6_000,
  'admin-portal': 8_000,
  'platform-hq': 12_000,
  classroom: 4_000,
};

function isAdminSurface(surface: ImmuneSurface): boolean {
  return surface === 'admin-portal' || surface === 'platform-hq';
}

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

export interface ImmuneScreener {
  screenInput(input: ImmuneScreenInput): ImmuneScreenResult;
}

export function createImmuneScreener(): ImmuneScreener {
  return {
    screenInput(input) {
      const text = input.text ?? '';
      const surface = input.surface;

      if (text.length === 0) return { verdict: 'allow' };

      // 1) Oversized input → refuse.
      const maxChars = MAX_INPUT_CHARS_BY_SURFACE[surface] ?? 4_000;
      if (text.length > maxChars) {
        return {
          verdict: 'refuse',
          category: 'oversized-input',
          reason: `input exceeds ${maxChars} characters for surface=${surface}`,
        };
      }

      // 2) Malicious payload markers → refuse.
      for (const re of MALICIOUS_PAYLOAD_PATTERNS) {
        if (re.test(text)) {
          return {
            verdict: 'refuse',
            category: 'malicious-payload',
            reason: 'input contains a known malicious-payload marker',
          };
        }
      }

      // 3) Prompt injection markers → refuse.
      for (const re of PROMPT_INJECTION_PATTERNS) {
        if (re.test(text)) {
          return {
            verdict: 'refuse',
            category: 'prompt-injection',
            reason: 'input contains a known prompt-injection marker',
          };
        }
      }

      // 4) System-prompt extraction → refuse.
      for (const re of SYSTEM_PROMPT_EXTRACTION_PATTERNS) {
        if (re.test(text)) {
          return {
            verdict: 'refuse',
            category: 'system-prompt-extraction',
            reason: 'input appears to attempt system-prompt extraction',
          };
        }
      }

      // 5) Admin impersonation — refuse on every surface EXCEPT
      //    platform-hq (where the caller may legitimately be an admin)
      //    AND admin-portal when an admin role is present.
      const hasAdminRole = (input.ctx?.callerRoles ?? []).some(
        (r) =>
          r.toLowerCase().includes('admin') ||
          r.toLowerCase() === 'platform-admin',
      );
      const adminImpersonationException =
        surface === 'platform-hq' ||
        (surface === 'admin-portal' && hasAdminRole);
      if (!adminImpersonationException) {
        for (const re of ADMIN_IMPERSONATION_PATTERNS) {
          if (re.test(text)) {
            return {
              verdict: 'refuse',
              category: 'admin-impersonation',
              reason: 'unverifiable admin / platform claim from this surface',
            };
          }
        }
      }

      // 6) PII overshare — sanitise and proceed (we don't refuse
      //    because the user usually wants HELP with the very thing
      //    they pasted). Admin surfaces are exempt — admins legitimately
      //    look up txn-ids and account numbers.
      if (!isAdminSurface(surface)) {
        let sanitized = text;
        let dirtied = false;
        for (const { pattern, mask } of PII_PATTERNS) {
          const next = sanitized.replace(pattern, mask);
          if (next !== sanitized) {
            sanitized = next;
            dirtied = true;
          }
        }
        if (dirtied) {
          return {
            verdict: 'sanitize_and_proceed',
            category: 'pii-overshare',
            reason: 'input contained sensitive numeric blobs; sanitised',
            sanitized,
          };
        }
      }

      return { verdict: 'allow' };
    },
  };
}

export const IMMUNE_LIMITS = {
  maxCharsBySurface: MAX_INPUT_CHARS_BY_SURFACE,
} as const;
