/**
 * UTM tag builder — per spec §5.
 *
 *   utm_source   = mr_mwikila
 *   utm_medium   = <channel>
 *   utm_campaign = <recipe_id>
 *   utm_content  = <variant_id>
 *   utm_term     = <audience_segment> (optional)
 *
 * Pure — never modifies the input URL beyond appending the query
 * string. Returns null when input is not a parseable absolute URL.
 */

import type { AudienceSegment, Channel } from '../types.js';

export interface UtmTags {
  readonly utm_source: string;
  readonly utm_medium: string;
  readonly utm_campaign: string;
  readonly utm_content: string;
  readonly utm_term?: string;
}

export interface BuildArgs {
  readonly channel: Channel;
  readonly recipe_id: string;
  readonly variant_id: string;
  readonly audience_segment?: AudienceSegment;
  readonly source?: string;
}

export function buildUtmTags(args: BuildArgs): UtmTags {
  const base: UtmTags = {
    utm_source: args.source ?? 'mr_mwikila',
    utm_medium: args.channel,
    utm_campaign: args.recipe_id,
    utm_content: args.variant_id,
  };
  if (args.audience_segment !== undefined) {
    return Object.freeze({ ...base, utm_term: args.audience_segment });
  }
  return Object.freeze(base);
}

/**
 * Append UTM tags to a URL. Returns the augmented URL string or
 * `null` when the input is not a valid absolute URL.
 */
export function applyUtmToUrl(url: string, tags: UtmTags): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  parsed.searchParams.set('utm_source', tags.utm_source);
  parsed.searchParams.set('utm_medium', tags.utm_medium);
  parsed.searchParams.set('utm_campaign', tags.utm_campaign);
  parsed.searchParams.set('utm_content', tags.utm_content);
  if (tags.utm_term !== undefined) {
    parsed.searchParams.set('utm_term', tags.utm_term);
  }
  return parsed.toString();
}

/**
 * Convenience: rewrite every absolute URL inside `body` to include
 * UTM tags. Markdown / HTML safe — only operates on `http(s)://...`
 * URLs.
 */
export function applyUtmToBody(body: string, tags: UtmTags): string {
  return body.replace(/https?:\/\/[^\s<>"'`)\]]+/g, (m) => {
    const next = applyUtmToUrl(m, tags);
    return next ?? m;
  });
}
