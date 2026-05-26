/**
 * Audit-chain link — every produced media artefact emits one entry
 * into `@borjie/audit-hash-chain` (per spec §7):
 *
 *   `{ recipe_id, recipe_version, class, format, checksum, provenance, safety_scan, generated_at }`
 *
 * The hash is HMAC-SHA256 keyed by the tenant's audit secret (when
 * supplied). Stateless: callers persist the returned entry.
 *
 * Pure functions. Mirrors document-templates' `buildDocAuditLink`.
 *
 * @module @borjie/media-generation/audit/audit-chain-link
 */

import { hashChainEntry } from '@borjie/audit-hash-chain';
import { createHash } from 'node:crypto';
import type { AuditPayload } from '@borjie/audit-hash-chain';
import type {
  MediaArtifact,
  MediaProvenance,
  MediaRecipe,
  SpanCitation,
} from '../types.js';

export interface MediaAuditLinkArgs {
  readonly tenant_id: string;
  readonly recipe: Pick<
    MediaRecipe,
    'id' | 'version' | 'class' | 'authority_tier'
  >;
  readonly format: MediaArtifact['format'];
  readonly checksum: string;
  readonly provenance: MediaProvenance;
  readonly span_citations: ReadonlyArray<SpanCitation>;
  readonly generated_at: string;
  readonly prev_audit_hash?: string;
  readonly secret_id?: string;
  readonly secret_value?: string;
}

export interface MediaAuditLink {
  readonly audit_hash: string;
  readonly payload: AuditPayload;
}

/**
 * Compose an audit-chain link for a freshly composed artifact. Caller
 * persists `{ payload, audit_hash, prev_audit_hash, secret_id }` into
 * the audit log.
 */
export function buildMediaAuditLink(args: MediaAuditLinkArgs): MediaAuditLink {
  // Hash the prompt so a verifier can confirm the prompt text without
  // forcing the audit row to carry the full string.
  const prompt_hash = createHash('sha256')
    .update(args.provenance.prompt_text)
    .digest('hex');

  const payload: AuditPayload = Object.freeze({
    kind: 'media_artifact',
    tenant_id: args.tenant_id,
    recipe_id: args.recipe.id,
    recipe_version: args.recipe.version,
    recipe_class: args.recipe.class,
    authority_tier: args.recipe.authority_tier,
    format: args.format,
    checksum: args.checksum,
    model_provider: args.provenance.model_provider,
    model_id: args.provenance.model_id,
    model_version: args.provenance.model_version,
    prompt_hash,
    seed: args.provenance.seed,
    safety_scan: args.provenance.safety_scan,
    cost_usd_cents: args.provenance.cost_usd_cents,
    duration_ms: args.provenance.duration_ms,
    span_citation_ids: args.span_citations.map((c) => c.id),
    span_citation_count: args.span_citations.length,
    generated_at: args.generated_at,
  });

  const audit_hash = hashChainEntry({
    payload,
    ...(args.prev_audit_hash !== undefined ? { prev: args.prev_audit_hash } : {}),
    ...(args.secret_id !== undefined ? { secretId: args.secret_id } : {}),
    ...(args.secret_value !== undefined ? { secretValue: args.secret_value } : {}),
  });

  return { audit_hash, payload };
}

/**
 * One-shot checksum for raw artifact bytes. Adapters call this on the
 * final bytes before sealing the artifact + emitting the audit row.
 */
export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}
