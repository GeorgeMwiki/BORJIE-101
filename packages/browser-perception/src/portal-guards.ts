/**
 * Portal guards — AXTree scans that detect when a legacy portal has put
 * up a wall the driver must NOT try to push through autonomously:
 *
 *   - a CAPTCHA / hCaptcha / reCAPTCHA challenge,
 *   - an MFA / one-time-code / authenticator prompt,
 *   - a "session expired / logged out / unauthorized" state.
 *
 * SOTA grounding (Anthropic Computer Use guardrails + WebVoyager
 * halt-for-help): an autonomous web agent must recognise these states
 * and HALT with a structured reason rather than blindly retrying a
 * filing — both for correctness (a CAPTCHA can't be brute-forced) and
 * for money-adjacent safety (never re-submit into an expired session).
 *
 * Each detector is a pure read over a captured {@link AxTreeSnapshot}:
 * it flattens the tree and tests role/name patterns. No page mutation,
 * no throwing — a missing/empty snapshot simply yields `false`.
 */

import { flattenAxNodes, type AxTreeSnapshot } from './axtree-snapshot.js';

/** Result of a single guard scan. */
export interface GuardHit {
  readonly detected: boolean;
  /** The control name that tripped the guard (for the audit trail). */
  readonly evidence?: string;
}

const CAPTCHA_NAME = /captcha|recaptcha|hcaptcha|i'?m not a robot|verify you are human/i;
const CAPTCHA_ROLE = /captcha/i;

const MFA_NAME =
  /\b(?:enter (?:the )?(?:code|otp)|verification code|one[- ]time (?:code|password)|two[- ]factor|2fa|authenticator|security code|sms code)\b/i;

const SESSION_EXPIRED_NAME =
  /\b(?:session (?:expired|timed out)|logged out|sign(?:ed)? out|unauthori[sz]ed|please log ?in again|your session has ended|login required|authentication required)\b/i;

function scan(
  snapshot: AxTreeSnapshot | null | undefined,
  predicate: (role: string, name: string) => boolean,
): GuardHit {
  if (!snapshot || !snapshot.root) return { detected: false };
  for (const node of flattenAxNodes(snapshot.root)) {
    const role = node.role ?? '';
    const name = node.name ?? '';
    if (predicate(role, name)) {
      return { detected: true, ...(name ? { evidence: name } : {}) };
    }
  }
  return { detected: false };
}

/** Detect a CAPTCHA / bot-check challenge in the snapshot. */
export function detectCaptcha(
  snapshot: AxTreeSnapshot | null | undefined,
): GuardHit {
  return scan(
    snapshot,
    (role, name) => CAPTCHA_ROLE.test(role) || CAPTCHA_NAME.test(name),
  );
}

/** Detect an MFA / one-time-code / authenticator prompt in the snapshot. */
export function detectMfaPrompt(
  snapshot: AxTreeSnapshot | null | undefined,
): GuardHit {
  return scan(snapshot, (_role, name) => MFA_NAME.test(name));
}

/** Detect a session-expired / logged-out / unauthorized state. */
export function detectSessionExpired(
  snapshot: AxTreeSnapshot | null | undefined,
): GuardHit {
  return scan(snapshot, (_role, name) => SESSION_EXPIRED_NAME.test(name));
}

/** The structured reasons a guard surfaces to the orchestrator. */
export type GuardReason =
  | 'captcha-required'
  | 'mfa-required'
  | 'session-expired-after-login';

export interface GuardScanResult {
  readonly tripped: boolean;
  readonly reason?: GuardReason;
  readonly evidence?: string;
}

/**
 * Run all three guards over a snapshot in priority order
 * (session-expiry first — it invalidates everything after it, then
 * captcha, then MFA). Returns the first hit, or `{ tripped:false }`.
 */
export function scanPortalGuards(
  snapshot: AxTreeSnapshot | null | undefined,
): GuardScanResult {
  const session = detectSessionExpired(snapshot);
  if (session.detected) {
    return {
      tripped: true,
      reason: 'session-expired-after-login',
      ...(session.evidence ? { evidence: session.evidence } : {}),
    };
  }
  const captcha = detectCaptcha(snapshot);
  if (captcha.detected) {
    return {
      tripped: true,
      reason: 'captcha-required',
      ...(captcha.evidence ? { evidence: captcha.evidence } : {}),
    };
  }
  const mfa = detectMfaPrompt(snapshot);
  if (mfa.detected) {
    return {
      tripped: true,
      reason: 'mfa-required',
      ...(mfa.evidence ? { evidence: mfa.evidence } : {}),
    };
  }
  return { tripped: false };
}
