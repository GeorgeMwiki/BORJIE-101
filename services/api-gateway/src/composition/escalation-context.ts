/**
 * Escalation locale-completeness helper.
 *
 * The escalations GET projection (`projectEscalation` in
 * routes/mining/escalations.hono.ts) renders the active locale from a
 * `context: { en, sw }` pair: Swahili from the `context_sw` column, English
 * from the additive `context` jsonb side-channel under key `contextEn`
 * (migration 0356). A direct-DB writer that persists ONLY `context_sw`
 * therefore makes an EN owner see the localized placeholder
 * (`escalations.bodyUnavailable`) instead of a real narrative.
 *
 * This makes every direct writer born locale-complete: it best-effort
 * translates the (Swahili) narrative to English at write time and returns it
 * for the `contextEn` bag key. It returns `null` — NEVER the untranslated
 * source — when translation is unavailable (provider unbound / failure /
 * no-op), so the GET reader falls back to the localized placeholder rather
 * than rendering a Swahili body to an English owner (zero-mix canon).
 *
 * `translate()` is globally bound at the composition root
 * (composition/translation-wiring.ts, gated on ANTHROPIC_API_KEY); when
 * unbound it fail-opens to a `passthrough` provider, which we treat as "no
 * English available" → null. The call never throws into the escalation
 * write path (wrapped); an escalation must raise even if translation is down.
 */

import { translate } from '@borjie/translation';

const ESCALATION_SURFACE = 'escalation.context' as const;

export async function resolveEscalationContextEn(
  swNarrative: string,
  tenantId: string,
): Promise<string | null> {
  const src = swNarrative.trim();
  if (src.length === 0) return null;
  try {
    const out = await translate({
      text: src,
      sourceLang: 'sw',
      targetLang: 'en',
      tenantId,
      surface: ESCALATION_SURFACE,
    });
    // 'passthrough' = no real translation happened (provider unbound or
    // fail-open). A returned text identical to the source is likewise a
    // no-op. Either way there is no trustworthy English narrative → null.
    if (out.provider === 'passthrough') return null;
    const en = out.text.trim();
    return en.length > 0 && en !== src ? en : null;
  } catch {
    return null;
  }
}

/**
 * Merge a best-effort `contextEn` into an escalation `context` jsonb bag.
 * Always returns a NEW object (immutability); `contextEn` is included even
 * when null so the persisted shape is explicit and the GET reader's
 * `context ->> 'contextEn'` key is present.
 */
export function withContextEn<T extends Record<string, unknown>>(
  bag: T,
  contextEn: string | null,
): T & { readonly contextEn: string | null } {
  return { ...bag, contextEn };
}
