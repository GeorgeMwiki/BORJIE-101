/**
 * Prompt spotlighting (datamarking) for the kernel megaprompt.
 *
 * Closes GAP-3 on the kernel composition path: retrieved / grounding /
 * tool content interpolated into the system prompt is fenced inside an
 * UNAMBIGUOUS, fixed sentinel delimiter that the {@link SECURITY_BOUNDARY_LAYER}
 * names, so the model treats the enclosed span as DATA only, never as
 * instructions — even if an injected "ignore previous instructions" rides
 * inside a corpus chunk or a tool result.
 *
 * Why a FIXED delimiter (not per-turn random): Anthropic's prompt-prefix
 * cache only hits when the prefix bytes are byte-identical across turns. The
 * security layers + grounding fragment sit in the cacheable prefix, so a
 * per-turn random token would defeat the cache. A fixed, distinctive sentinel
 * gives the model an unambiguous data marker while keeping the prefix stable.
 *
 * SHARED CONTRACT: these sentinel strings are intentionally identical to the
 * ones the ai-copilot orchestrator uses
 * (`packages/ai-copilot/src/orchestrator/untrusted-content.ts`). Both code
 * paths fence untrusted content the same way and the boundary copy names the
 * same delimiter, so the two surfaces present one consistent data-boundary
 * convention to the model. Keep the two in sync if either changes.
 *
 * Design rules honoured:
 *   - Immutability: every function returns a NEW string; inputs are never
 *     mutated.
 *   - Pure + deterministic: same inputs → byte-identical output (prompt-cache
 *     stability).
 *
 * Source: Hines et al. 2024, "Defending Against Indirect Prompt Injection
 * Attacks With Spotlighting" (Microsoft).
 *
 * @module @borjie/central-intelligence/kernel/prompt-spotlight
 */

/** Open / close sentinels fencing an untrusted data span (shared contract). */
export const UNTRUSTED_OPEN = '<<<BORJIE_UNTRUSTED_DATA>>>';
export const UNTRUSTED_CLOSE = '<<<END_BORJIE_UNTRUSTED_DATA>>>';

/**
 * Strip any forged fence sentinels from the inner text so an attacker cannot
 * inject a closing sentinel mid-document to "break out" of the data fence and
 * resume issuing instructions. Pure.
 */
function stripFenceForgery(text: string): string {
  return text.split(UNTRUSTED_OPEN).join('').split(UNTRUSTED_CLOSE).join('');
}

/**
 * Fence an untrusted span as data. Returns a NEW string. Empty /
 * whitespace-only input is returned unchanged (fencing nothing only adds
 * noise + shifts cache bytes).
 *
 * `label` is an optional short, TRUSTED, caller-supplied provenance tag
 * (e.g. a grounding fact id) rendered on the open fence; it must NOT be taken
 * from untrusted content.
 */
export function spotlight(text: string, label?: string): string {
  if (typeof text !== 'string' || text.trim().length === 0) return text ?? '';
  const safeInner = stripFenceForgery(text);
  const tag =
    typeof label === 'string' && label.trim().length > 0
      ? ` source=${label.trim()}`
      : '';
  return `${UNTRUSTED_OPEN}${tag}\n${safeInner}\n${UNTRUSTED_CLOSE}`;
}
