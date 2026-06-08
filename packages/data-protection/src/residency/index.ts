/**
 * Data-residency tagging (DP-06).
 *
 * Every encrypted blob carries WHERE its key material lives so a regulator
 * (or the deep-health probe) can prove that a tenant's RESTRICTED data is
 * encrypted under a key bound to the tenant's residency region — not the
 * platform default. This module is the pure tagging + validation layer; the
 * actual region→CMK selection is the KMS port's job (kms-key-manager.ts).
 *
 * Jurisdiction-agnostic: no country code is named here. The residency region
 * is an opaque string (`af-south-1`, `eu-west-1`, …) supplied by the caller's
 * tenant-region resolver. A residency POLICY (which classes must stay in
 * region) is injected, not hard-coded.
 *
 * No `process.env`, no DB, no KMS import — a pure leaf.
 */

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import type { Classification } from '../types.js';

/**
 * Residency tag attached to (or stored alongside) an encrypted blob.
 * `keyRegion` is where the wrapping CMK lives; `residencyRegion` is where the
 * tenant's data is REQUIRED to live. When they diverge for an in-region class
 * the blob is non-compliant (see `assertResidencyCompliant`).
 */
export interface DataResidencyTag {
  readonly tenantId: string;
  /** Region the tenant's data must reside in (their home jurisdiction). */
  readonly residencyRegion: string;
  /** Region of the CMK that actually wrapped this blob's DEK. */
  readonly keyRegion: string;
  readonly classification: Classification;
  /** ISO-8601 stamp for audit. */
  readonly taggedAt: string;
  /** Deterministic hash of the tag for tamper-evident co-storage. */
  readonly tagHash: string;
}

/**
 * Residency policy: which classes MUST be key-bound to the tenant's region.
 * Injected by the caller (from a jurisdiction profile / compliance plugin),
 * never hard-coded — a new jurisdiction is a new policy row, not a code edit.
 */
export interface ResidencyPolicy {
  /** Classes that must reside in-region (key + data). */
  readonly inRegionClasses: ReadonlySet<Classification>;
}

/** Default: the sensitive classes stay in-region. Callers may override. */
export const DEFAULT_RESIDENCY_POLICY: ResidencyPolicy = Object.freeze({
  inRegionClasses: new Set<Classification>([
    'restricted',
    'critical',
    'pii',
    'phi',
    'financial',
  ]),
});

function hashTag(input: {
  readonly tenantId: string;
  readonly residencyRegion: string;
  readonly keyRegion: string;
  readonly classification: Classification;
  readonly taggedAt: string;
}): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(
        [
          input.tenantId,
          input.residencyRegion,
          input.keyRegion,
          input.classification,
          input.taggedAt,
        ].join('|'),
      ),
    ),
  );
}

/** Build a residency tag for an encryption operation. */
export function tagResidency(input: {
  readonly tenantId: string;
  readonly residencyRegion: string;
  readonly keyRegion: string;
  readonly classification: Classification;
  readonly now?: Date;
}): DataResidencyTag {
  const taggedAt = (input.now ?? new Date()).toISOString();
  const tagHash = hashTag({
    tenantId: input.tenantId,
    residencyRegion: input.residencyRegion,
    keyRegion: input.keyRegion,
    classification: input.classification,
    taggedAt,
  });
  return Object.freeze({
    tenantId: input.tenantId,
    residencyRegion: input.residencyRegion,
    keyRegion: input.keyRegion,
    classification: input.classification,
    taggedAt,
    tagHash,
  });
}

export interface ResidencyComplianceResult {
  readonly compliant: boolean;
  /** Set when non-compliant — a human-readable reason for the audit log. */
  readonly reason?: string;
}

/**
 * Validate a tag against a residency policy. A blob is COMPLIANT when:
 *   - the class is not residency-bound (any region is fine), OR
 *   - the class IS residency-bound AND `keyRegion === residencyRegion`.
 *
 * Never throws — returns a structured result the caller logs / acts on. (The
 * encryption path may choose to hard-fail on non-compliance; the validation
 * itself is side-effect free.)
 */
export function checkResidencyCompliant(
  tag: DataResidencyTag,
  policy: ResidencyPolicy = DEFAULT_RESIDENCY_POLICY,
): ResidencyComplianceResult {
  // Tamper check first — a tag whose hash does not recompute is untrusted.
  const expected = hashTag({
    tenantId: tag.tenantId,
    residencyRegion: tag.residencyRegion,
    keyRegion: tag.keyRegion,
    classification: tag.classification,
    taggedAt: tag.taggedAt,
  });
  if (expected !== tag.tagHash) {
    return Object.freeze({
      compliant: false,
      reason: 'residency tag hash mismatch (tampered or corrupted)',
    });
  }
  if (!policy.inRegionClasses.has(tag.classification)) {
    return Object.freeze({ compliant: true });
  }
  if (tag.keyRegion === tag.residencyRegion) {
    return Object.freeze({ compliant: true });
  }
  return Object.freeze({
    compliant: false,
    reason: `class '${tag.classification}' must be key-bound to '${tag.residencyRegion}' but was wrapped under '${tag.keyRegion}'`,
  });
}

/** Throwing variant for hot paths that must hard-fail on a residency breach. */
export function assertResidencyCompliant(
  tag: DataResidencyTag,
  policy: ResidencyPolicy = DEFAULT_RESIDENCY_POLICY,
): void {
  const result = checkResidencyCompliant(tag, policy);
  if (!result.compliant) {
    throw new Error(`data-residency: ${result.reason ?? 'non-compliant'}`);
  }
}
