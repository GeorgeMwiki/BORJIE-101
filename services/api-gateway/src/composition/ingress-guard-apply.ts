/**
 * Ingress input-guard APPLICATION helper — the shared call-site for the
 * blessed `getInputGuard()` detector across EVERY free-text chat entrypoint.
 *
 * `input-guard-wiring.ts` builds the detector (prompt-injection + jailbreak,
 * BP-5 audit sink, fail-OPEN-but-logged). `brain.hono.ts /turn` was the ONLY
 * route that called it. CLOSE-G extends that exact pattern to the other live
 * chat surfaces (brain-teach, public-chat, mining/chat, brain-voice,
 * brain-dispatch) WITHOUT each route re-deriving the refuse/tighten/redact
 * decision or duplicating the single-language refusal copy.
 *
 * This module is a THIN, PURE wrapper over `getInputGuard().guard(...)`:
 *   - it runs the SAME guard singleton (same detectors, same BP-5 audit sink);
 *   - it applies the SAME decision shape brain.hono /turn applies
 *     (refuse → single-language copy + never executes; tighten → run on the
 *      redacted text + raiseRail; allow → run on the (possibly redacted) text);
 *   - it carries the SAME single-language refusal vocabulary brain.hono uses
 *     (EN default; SW when the locale toggles — no mixing, CLAUDE.md absolute
 *      separation mandate);
 *   - it is FAIL-OPEN exactly like the guard (the underlying guard never
 *     throws; this wrapper additionally try/catches so a construction fault
 *     degrades to an allow of the original text — a guard bug must never drop a
 *     legitimate owner turn; the downstream rails remain in force).
 *
 * No `console.*` (the guard logs via its Pino shim). No `process.env` read
 * (the kill-switch is read once inside the guard singleton). Immutable: every
 * return value is a frozen new object.
 *
 * @module services/api-gateway/src/composition/ingress-guard-apply
 */

import { getInputGuard, type InputGuardResult } from './input-guard-wiring.js';

/** Locale for the single-language refusal copy. EN default; SW toggles. */
export type IngressGuardLang = 'en' | 'sw';

/**
 * Single-language input-containment refusal copy — IDENTICAL to
 * `INPUT_GUARD_REFUSAL_TEXTS` in brain.hono.ts. Returned when the ingress guard
 * flags a CRITICAL prompt-injection / jailbreak attempt. EN default; SW when
 * the locale toggles. No mixing (CLAUDE.md absolute-separation mandate).
 * Deliberately generic — it never echoes the attack or leaks why.
 */
export const INGRESS_GUARD_REFUSAL_TEXTS: Readonly<
  Record<IngressGuardLang, string>
> = Object.freeze({
  en: 'I can’t help with that request. Let me know what you’d like to do with your estate and I’ll get started.',
  sw: 'Siwezi kusaidia na ombi hilo. Niambie unachotaka kufanya kuhusu shamba lako nami nitaanza.',
});

/**
 * The applied ingress decision a route acts on. Mirrors the three brain.hono
 * /turn branches:
 *   - `refused: true`  → STOP the turn; emit `refusalMessage` (single-language).
 *   - `refused: false` → run the turn on `text` (the possibly-redacted user
 *     text — offending spans stripped on a lower-severity hit, identical to the
 *     input when nothing fired); `raiseRail` true when a HIGH-confidence
 *     jailbreak / injection means the safety rail must tighten downstream.
 */
export interface AppliedIngressGuard {
  readonly refused: boolean;
  readonly text: string;
  readonly raiseRail: boolean;
  readonly refusalMessage: string;
  /** The detector rules that fired (for the route's structured logging). */
  readonly reasons: ReadonlyArray<string>;
}

/** Resolve the refusal locale from an `Accept-Language` header value. */
export function pickIngressGuardLang(
  acceptLanguage: string | null | undefined,
): IngressGuardLang {
  if (typeof acceptLanguage !== 'string' || acceptLanguage.length === 0) {
    return 'en';
  }
  const first = acceptLanguage.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('sw') ? 'sw' : 'en';
}

/**
 * Run the blessed ingress guard over one user-text span and shape the
 * route-facing decision — the SAME contract brain.hono /turn applies. NEVER
 * throws: the guard is fail-OPEN-but-logged, and this wrapper try/catches so a
 * construction fault degrades to an allow of the original text (a guard bug
 * must never drop a legitimate turn — the kernel pre-flight, evidence gate, and
 * egress filter remain in force downstream).
 *
 * @param userText  the user's raw turn text (before any memory/cognitive preamble)
 * @param tenantId  scopes the BP-5 audit row
 * @param userId    scopes the BP-5 audit row (null for anonymous surfaces)
 * @param lang      locale for the single-language refusal copy
 */
export async function applyIngressGuard(args: {
  readonly userText: string;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly lang: IngressGuardLang;
}): Promise<AppliedIngressGuard> {
  const refusalMessage = INGRESS_GUARD_REFUSAL_TEXTS[args.lang];
  let result: InputGuardResult;
  try {
    result = await getInputGuard().guard({
      text: args.userText,
      tenantId: args.tenantId,
      userId: args.userId,
    });
  } catch {
    // Defence-in-depth: the guard never throws, but a construction fault must
    // not drop the turn. Fall through with the original text (downstream rails
    // still apply). No log here — the guard owns its Pino sink.
    return Object.freeze({
      refused: false,
      text: args.userText,
      raiseRail: false,
      refusalMessage,
      reasons: Object.freeze(['fail-open']),
    });
  }
  if (result.action === 'refuse') {
    return Object.freeze({
      refused: true,
      text: '',
      raiseRail: true,
      refusalMessage,
      reasons: result.reasons,
    });
  }
  return Object.freeze({
    refused: false,
    text: result.text,
    raiseRail: result.raiseRail,
    refusalMessage,
    reasons: result.reasons,
  });
}
