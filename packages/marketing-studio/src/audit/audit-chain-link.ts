/**
 * Audit-chain link — every published marketing asset emits one entry
 * into `@borjie/audit-hash-chain` (per spec §11):
 *
 *   { recipe_id, recipe_version, channel, variant_id, checksum,
 *     audience_segment, span_citation_ids, generated_at }
 *
 * Stateless: callers persist the returned entry into the audit log.
 */

import { hashChainEntry } from '@borjie/audit-hash-chain';
import type { AuditPayload } from '@borjie/audit-hash-chain';
import type {
  AudienceSegment,
  AuthorityTier,
  Channel,
  ComposedAsset,
  SpanCitation,
} from '../types.js';

export interface MarketingAuditLinkArgs {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly channel: Channel;
  readonly variant_id: string;
  readonly checksum: string;
  readonly span_citations: ReadonlyArray<SpanCitation>;
  readonly generated_at: string;
  readonly prev_audit_hash?: string;
  readonly secret_id?: string;
  readonly secret_value?: string;
}

export interface MarketingAuditLink {
  readonly audit_hash: string;
  readonly payload: AuditPayload;
}

export function buildMarketingAuditLink(
  args: MarketingAuditLinkArgs,
): MarketingAuditLink {
  const payload: AuditPayload = Object.freeze({
    kind: 'marketing_asset',
    tenant_id: args.tenant_id,
    recipe_id: args.recipe_id,
    recipe_version: args.recipe_version,
    authority_tier: args.authority_tier,
    audience_segment: args.audience_segment,
    channel: args.channel,
    variant_id: args.variant_id,
    checksum: args.checksum,
    span_citation_ids: args.span_citations.map((c) => c.id),
    span_citation_count: args.span_citations.length,
    generated_at: args.generated_at,
  });

  const hashArgs: {
    prev?: string;
    payload: AuditPayload;
    secretId?: string;
    secretValue?: string;
  } = { payload };
  if (args.prev_audit_hash !== undefined) {
    hashArgs.prev = args.prev_audit_hash;
  }
  if (args.secret_id !== undefined) {
    hashArgs.secretId = args.secret_id;
  }
  if (args.secret_value !== undefined) {
    hashArgs.secretValue = args.secret_value;
  }

  const rowHash = hashChainEntry(hashArgs);
  return { audit_hash: rowHash, payload };
}

/**
 * Convenience overload: derive the audit link directly from a
 * ComposedAsset + recipe metadata. Used by composers as a one-liner.
 */
export interface FromAssetArgs {
  readonly tenant_id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly audience_segment: AudienceSegment;
  readonly authority_tier: AuthorityTier;
  readonly asset: Omit<ComposedAsset, 'audit_hash'>;
  readonly checksum: string;
}

export function buildLinkFromAsset(args: FromAssetArgs): MarketingAuditLink {
  return buildMarketingAuditLink({
    tenant_id: args.tenant_id,
    recipe_id: args.recipe_id,
    recipe_version: args.recipe_version,
    audience_segment: args.audience_segment,
    authority_tier: args.authority_tier,
    channel: args.asset.channel,
    variant_id: args.asset.variant_id,
    checksum: args.checksum,
    span_citations: args.asset.span_citations,
    generated_at: args.asset.generated_at,
  });
}
