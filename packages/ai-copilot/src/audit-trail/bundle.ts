/**
 * Audit-trail export bundle — Wave 27 Agent C.
 *
 * Produces a signed JSON bundle a tenant admin can download to prove the
 * contents of their audit trail over a given range. Bundle layout:
 *
 *   {
 *     "bundleVersion": 1,
 *     "tenantId": "...",
 *     "generatedAt": "...",
 *     "range": { from, to, category, actorKind },
 *     "entries": [ ...AuditTrailEntry[] ],
 *     "verification": { valid, entriesChecked, brokenAt?, firstValidAt?, lastValidAt? },
 *     "bundleHash": "<sha256 of entries array>",
 *     "bundleSignature": "<hmac-sha256(bundleHash, secret)>"
 *   }
 *
 * `bundleHash` + `bundleSignature` make the bundle itself tamper-evident
 * OUT-of-band: anyone with the signing secret can re-hash the entries and
 * confirm the bundle came from the genuine BORJIE platform.
 */

import { createHash } from 'crypto';
import type {
  AuditActionCategory,
  AuditActorKind,
  AuditTrailEntry,
  AuditTrailRepository,
  VerifyRangeResult,
} from './types.js';
import { canonicalEvidence, signHash } from './hash-chain.js';
import { createAuditTrailVerifier } from './verifier.js';

export interface ExportBundleOptions {
  readonly from?: Date;
  readonly to?: Date;
  readonly category?: AuditActionCategory;
  readonly actorKind?: AuditActorKind;
  readonly limit?: number;
}

export interface AuditTrailBundle {
  readonly bundleVersion: 1;
  readonly tenantId: string;
  readonly generatedAt: string;
  readonly range: {
    readonly from: string | null;
    readonly to: string | null;
    readonly category: AuditActionCategory | null;
    readonly actorKind: AuditActorKind | null;
  };
  readonly entries: readonly AuditTrailEntry[];
  readonly verification: VerifyRangeResult;
  readonly bundleHash: string;
  readonly bundleSignature: string | null;
}

export interface BundleDeps {
  readonly repo: AuditTrailRepository;
  readonly signingSecret?: string | null;
  readonly now?: () => Date;
}

/**
 * Build an export bundle. Verification runs against the FULL chain (not
 * just the window) so the `verification.valid` flag tells the tenant
 * whether any row in their tenancy has been tampered with.
 */
export async function exportBundle(
  deps: BundleDeps,
  tenantId: string,
  options: ExportBundleOptions = {},
): Promise<AuditTrailBundle> {
  if (!tenantId || tenantId.trim() === '') {
    throw new Error('audit-trail-bundle: tenantId is required');
  }
  const now = deps.now ?? (() => new Date());
  const verifier = createAuditTrailVerifier({
    repo: deps.repo,
    signingSecret: deps.signingSecret ?? null,
  });

  const entries = await deps.repo.list(tenantId, options);
  const verification = await verifier.verifyRange(tenantId, options);
  const bundleHash = hashEntries(entries);
  const bundleSignature = signHash(bundleHash, deps.signingSecret ?? null);

  return {
    bundleVersion: 1,
    tenantId,
    generatedAt: now().toISOString(),
    range: {
      from: options.from?.toISOString() ?? null,
      to: options.to?.toISOString() ?? null,
      category: options.category ?? null,
      actorKind: options.actorKind ?? null,
    },
    entries,
    verification,
    bundleHash,
    bundleSignature,
  };
}

function hashEntries(entries: readonly AuditTrailEntry[]): string {
  const serialised = entries
    .map((e) => `${e.sequenceId}:${e.thisHash}:${canonicalEvidence(e.evidence)}`)
    .join('\n');
  return createHash('sha256').update(serialised).digest('hex');
}

/**
 * NDJSON streamer — useful for very large ranges where we don't want to
 * hold the whole bundle in memory. Yields one JSON-line per entry, then
 * the trailer object containing verification + bundleHash + signature.
 */
export async function* streamBundleNdjson(
  deps: BundleDeps,
  tenantId: string,
  options: ExportBundleOptions = {},
): AsyncGenerator<string, void, unknown> {
  const bundle = await exportBundle(deps, tenantId, options);
  // Header line
  yield JSON.stringify({
    type: 'header',
    bundleVersion: bundle.bundleVersion,
    tenantId: bundle.tenantId,
    generatedAt: bundle.generatedAt,
    range: bundle.range,
  }) + '\n';

  for (const entry of bundle.entries) {
    yield JSON.stringify({ type: 'entry', entry }) + '\n';
  }

  yield JSON.stringify({
    type: 'trailer',
    verification: bundle.verification,
    bundleHash: bundle.bundleHash,
    bundleSignature: bundle.bundleSignature,
  }) + '\n';
}
