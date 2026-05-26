/**
 * Brand-DNA prompt prefix builder.
 *
 * Mechanically assembles the brand prefix + negative prompt for every
 * generation. Recipes never write raw style text — they call
 * `buildBrandedPrompt(spec, subject)` and receive a fully formed prompt
 * string. This guarantees brand consistency across recipes and across
 * provider adapters.
 *
 * Pure functions. No I/O.
 *
 * @module @borjie/media-generation/brand-lock/prompt-prefix-builder
 */

import type { BrandSpec } from '../types.js';

/**
 * Compose the brand-DNA prefix from the BrandSpec. The prefix carries:
 *   - photographic-style declaration
 *   - OKLCH palette anchors (primary + foreground + background)
 *   - typography rule
 *   - wordmark policy
 *   - blanket "Avoid:" line backed by the negative-prompt denylist
 *
 * The output is suitable for direct concatenation in front of a
 * subject specification.
 */
export function buildBrandPrefix(spec: BrandSpec): string {
  const palette = spec.palette
    .slice(0, 5)
    .map((p) => `${p.name} (${p.oklch})`)
    .join(', ');
  const avoidList = spec.negative_prompt_terms.join(', ');
  return [
    `Photographic style: ${spec.photographic_style}.`,
    `Color treatment: ${spec.brand} OKLCH palette — ${palette}.`,
    `Typography on graphics: ${spec.typography_rule}.`,
    `Wordmark policy: ${spec.wordmark_policy}.`,
    `Avoid: ${avoidList}.`,
  ].join(' ');
}

/**
 * Build the full branded prompt: `<prefix> <subject>`.
 *
 * `subject` is the recipe-supplied subject specification (e.g. "Hero
 * still of ore parcel PRL-001, 18.7 g/t Au from the Geita region,
 * documentary lighting, neutral background.").
 *
 * The function refuses to drop the brand prefix even if the recipe
 * asks for a "clean" prompt. The only way to render off-brand is to
 * fork the package, which is intentional.
 */
export function buildBrandedPrompt(
  spec: BrandSpec,
  subject: string,
): string {
  const prefix = buildBrandPrefix(spec);
  const safeSubject = subject.trim();
  if (safeSubject.length === 0) {
    return prefix;
  }
  return `${prefix}\n\nSubject: ${safeSubject}`;
}

/**
 * Build the negative prompt — provider adapters that accept a
 * dedicated `negative_prompt` field call this directly. The list is
 * the BrandSpec's denylist joined with `, `.
 */
export function buildNegativePrompt(spec: BrandSpec): string {
  return spec.negative_prompt_terms.join(', ');
}

/**
 * Returns true when the prompt contains the brand prefix's signature
 * markers — used as a defense-in-depth check by the dispatcher before
 * it sends a prompt to a provider. If a malicious caller built a
 * "branded" prompt by hand and forgot the prefix, this catches it.
 */
export function hasBrandPrefix(prompt: string, spec: BrandSpec): boolean {
  return (
    prompt.includes(`${spec.brand} OKLCH palette`) &&
    prompt.includes('Wordmark policy:')
  );
}
