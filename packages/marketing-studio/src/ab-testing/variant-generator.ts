/**
 * Variant generator — produces N deterministic variants from a base
 * brief. Each variant differs by a single dimension: headline, CTA,
 * tone, length. Pure — variants are functions of (brief, seed).
 */

import type { AudienceSegment, Channel } from '../types.js';

export interface VariantBrief {
  readonly base_message: string;
  readonly cta_options: ReadonlyArray<string>;
  readonly headline_options: ReadonlyArray<string>;
  readonly tone_options: ReadonlyArray<string>;
}

export interface Variant {
  readonly id: string;
  readonly headline: string;
  readonly cta: string;
  readonly tone: string;
  readonly base_message: string;
}

export interface GenerateArgs {
  readonly recipe_id: string;
  readonly channel: Channel;
  readonly audience_segment: AudienceSegment;
  readonly variant_count: number;
  readonly brief: VariantBrief;
}

/**
 * Generate `variant_count` deterministic variants. Cycles through the
 * brief option arrays — for variant i, uses headline[i%len], cta[i%len],
 * tone[i%len]. Caller may produce different brief options per segment.
 */
export function generateVariants(args: GenerateArgs): ReadonlyArray<Variant> {
  const out: Array<Variant> = [];
  for (let i = 0; i < args.variant_count; i++) {
    const headline = pickWithFallback(args.brief.headline_options, i, '');
    const cta = pickWithFallback(args.brief.cta_options, i, '');
    const tone = pickWithFallback(args.brief.tone_options, i, 'neutral');
    out.push({
      id: `${args.recipe_id}-${args.channel}-${args.audience_segment}-v${i}`,
      headline,
      cta,
      tone,
      base_message: args.brief.base_message,
    });
  }
  return Object.freeze(out);
}

function pickWithFallback<T>(arr: ReadonlyArray<T>, index: number, fallback: T): T {
  if (arr.length === 0) {
    return fallback;
  }
  const v = arr[index % arr.length];
  return v ?? fallback;
}
