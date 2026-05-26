/**
 * Shared helpers for composer modules — citation gating, audit-chain
 * link, UTM application, channel-native length enforcement.
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  AudienceSegment,
  AuthorityTier,
  Channel,
  ComposedAsset,
  ComposedAssetAttachment,
  MarketingClass,
  SpanCitation,
} from '../types.js';
import { MarketingError } from '../types.js';
import { buildMarketingAuditLink } from '../audit/audit-chain-link.js';
import { applyUtmToBody, buildUtmTags, type UtmTags } from '../telemetry/utm-builder.js';

export const CHANNEL_LENGTH_LIMITS: Readonly<Record<Channel, number>> = Object.freeze({
  linkedin_organic: 3000,
  linkedin_ads: 600,
  x_organic: 280,
  x_ads: 280,
  meta_organic: 2200,
  meta_ads: 1500,
  tiktok_organic: 2200,
  tiktok_ads: 1500,
  youtube_organic: 5000,
  youtube_ads: 1500,
  google_ads: 90,
  email: 1_000_000,
  web_landing: 1_000_000,
  pr_wire: 1_000_000,
  rss: 1_000_000,
  podcast: 1_000_000,
});

/** Length the channel-native body uses, excluding hidden prompt comments. */
function visibleLength(body: string): number {
  return stripPromptComments(body).length;
}

/** Strip `<!--prompt:...-->` hidden hints so they don't count toward limits. */
export function stripPromptComments(body: string): string {
  return body.replace(/<!--prompt:[^]*?-->\n?/g, '');
}

export function enforceChannelLength(body: string, channel: Channel): string {
  const limit = CHANNEL_LENGTH_LIMITS[channel];
  if (visibleLength(body) <= limit) {
    return body;
  }
  // Trim with ellipsis. Never silently drop — callers should compose
  // shorter copy; we trim defensively. We operate on the visible body.
  const visible = stripPromptComments(body);
  return visible.slice(0, Math.max(0, limit - 1)) + '…';
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf-8').digest('hex');
}

export interface BuildComposedAssetArgs {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly publish_authority_tier: AuthorityTier;
  readonly cls: MarketingClass;
  readonly channel: Channel;
  readonly variant_id: string;
  readonly body: string;
  readonly attachments?: ReadonlyArray<ComposedAssetAttachment>;
  readonly span_citations: ReadonlyArray<SpanCitation>;
  readonly generated_at: string;
}

/**
 * Pipeline: enforce channel length → apply UTM tags → checksum →
 * audit-chain link → freeze ComposedAsset.
 */
export function buildComposedAsset(args: BuildComposedAssetArgs): ComposedAsset {
  const utm: UtmTags = buildUtmTags({
    channel: args.channel,
    recipe_id: args.recipe_id,
    variant_id: args.variant_id,
    audience_segment: args.audience_segment,
  });

  const bodyWithUtm = applyUtmToBody(args.body, utm);
  const trimmed = enforceChannelLength(bodyWithUtm, args.channel);
  const checksum = sha256Hex(trimmed);

  const link = buildMarketingAuditLink({
    tenant_id: args.tenant_id,
    recipe_id: args.recipe_id,
    recipe_version: args.recipe_version,
    audience_segment: args.audience_segment,
    authority_tier: args.authority_tier,
    channel: args.channel,
    variant_id: args.variant_id,
    checksum,
    span_citations: args.span_citations,
    generated_at: args.generated_at,
  });

  const utmObject: Readonly<Record<string, string>> = Object.freeze({
    utm_source: utm.utm_source,
    utm_medium: utm.utm_medium,
    utm_campaign: utm.utm_campaign,
    utm_content: utm.utm_content,
    ...(utm.utm_term !== undefined ? { utm_term: utm.utm_term } : {}),
  });

  return Object.freeze({
    id: randomUUID(),
    class: args.cls,
    channel: args.channel,
    variant_id: args.variant_id,
    body: trimmed,
    attachments: Object.freeze([...(args.attachments ?? [])]),
    span_citations: Object.freeze([...args.span_citations]),
    utm_tags: utmObject,
    publish_authority_tier: args.publish_authority_tier,
    audit_hash: link.audit_hash,
    generated_at: args.generated_at,
  });
}

export function pinGeneratedAt(provided?: string): string {
  return provided ?? new Date().toISOString();
}

export function requireCitations(
  citations: ReadonlyArray<SpanCitation>,
  minCount: number,
): void {
  if (citations.length < minCount) {
    throw new MarketingError(
      'CITATION_GAP',
      `recipe requires ${minCount} citation(s) but only ${citations.length} supplied`,
      [String(minCount), String(citations.length)],
    );
  }
}
