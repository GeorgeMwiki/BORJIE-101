/**
 * Audit-chain link — every produced artifact emits one entry into the
 * `@borjie/audit-hash-chain` (per spec §5):
 *
 *   `{ recipe_id, recipe_version, checksum, span_citations, generated_at }`
 *
 * The hash is HMAC-SHA256 keyed by the tenant's audit secret (when the
 * caller supplies one) for tamper evidence. Stateless: callers persist
 * the returned entry.
 */

import { hashChainEntry } from '@borjie/audit-hash-chain';
import type { AuditPayload } from '@borjie/audit-hash-chain';
import type { DocumentArtifact, DocumentRecipe, SpanCitation } from '../types.js';

export interface DocAuditLinkArgs {
  readonly tenant_id: string;
  readonly recipe: Pick<DocumentRecipe, 'id' | 'version' | 'class' | 'authority_tier'>;
  readonly checksum: string;
  readonly span_citations: ReadonlyArray<SpanCitation>;
  readonly generated_at: string;
  readonly format: DocumentArtifact['format'];
  readonly prev_audit_hash?: string;
  readonly secret_id?: string;
  readonly secret_value?: string;
}

export interface DocAuditLink {
  readonly audit_hash: string;
  readonly payload: AuditPayload;
}

/**
 * Compose an audit-chain link for a freshly composed artifact. Caller
 * persists `{ payload, audit_hash, prev_audit_hash, secret_id }` into
 * the audit log.
 */
export function buildDocAuditLink(args: DocAuditLinkArgs): DocAuditLink {
  const payload: AuditPayload = Object.freeze({
    kind: 'doc_artifact',
    tenant_id: args.tenant_id,
    recipe_id: args.recipe.id,
    recipe_version: args.recipe.version,
    recipe_class: args.recipe.class,
    authority_tier: args.recipe.authority_tier,
    format: args.format,
    checksum: args.checksum,
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
