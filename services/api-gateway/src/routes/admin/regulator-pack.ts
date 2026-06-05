/**
 * Regulator-pack builder — composes a tenant's audit bundle + compliance
 * filings + evidence chain into ONE verifiable artifact (WS-5, task 2).
 *
 * Pure functions only — no I/O, no clocks, no RNG. The caller (the admin
 * superpowers approval handler) fetches the four corpora from Postgres
 * (tenant-scoped via RLS) and hands them in; this module shapes them into a
 * deterministic, tamper-evident bundle.
 *
 * Verifiability (mirrors packages/ai-copilot/src/audit-trail/bundle.ts):
 *   - `bundleHash`       sha256 over the canonicalised sections + meta. Stable
 *                        key order so re-hashing identical contents reproduces
 *                        the digest.
 *   - `bundleSignature`  HMAC-sha256(bundleHash, secret) — detects signing-key
 *                        rotation / impersonation. null when no secret (dev).
 *   - `verifyRegulatorPack(bundle, secret)` recomputes both and reports tamper
 *                        status; a single flipped byte fails verification.
 *
 * The evidence chain additionally carries a continuity flag: each entry's
 * `prevHash` must equal the previous entry's `thisHash` (the ai_audit_chain
 * hash-chain invariant), so a regulator can confirm no AI turn was excised.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// ─── Source + bundle shapes ──────────────────────────────────────────────────

/** Raw rows fetched from Postgres (already tenant-scoped). */
export interface RegulatorPackSources {
  readonly auditEvents: ReadonlyArray<Record<string, unknown>>;
  readonly regulatoryFilings: ReadonlyArray<Record<string, unknown>>;
  readonly complianceExports: ReadonlyArray<Record<string, unknown>>;
  readonly evidenceChain: ReadonlyArray<EvidenceChainEntry>;
}

export interface EvidenceChainEntry {
  readonly sequenceId: number;
  readonly thisHash: string;
  readonly prevHash: string;
  readonly action: string;
  readonly [k: string]: unknown;
}

export interface RegulatorPackMeta {
  readonly tenantId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly generatedAt: string;
  readonly requestedBy: string;
  readonly approvedBy: string;
}

export interface RegulatorPackBundle {
  readonly bundleVersion: 1;
  readonly kind: 'regulator_pack';
  readonly tenantId: string;
  readonly period: { readonly start: string; readonly end: string };
  readonly generatedAt: string;
  /** Four-eye provenance — who proposed + who approved the export. */
  readonly fourEye: {
    readonly requestedBy: string;
    readonly approvedBy: string;
  };
  readonly sections: {
    readonly auditEvents: ReadonlyArray<Record<string, unknown>>;
    readonly regulatoryFilings: ReadonlyArray<Record<string, unknown>>;
    readonly complianceExports: ReadonlyArray<Record<string, unknown>>;
    readonly evidenceChain: ReadonlyArray<EvidenceChainEntry>;
  };
  readonly counts: {
    readonly auditEvents: number;
    readonly regulatoryFilings: number;
    readonly complianceExports: number;
    readonly evidenceChain: number;
  };
  /** True when the evidence chain's prevHash links are all intact. */
  readonly evidenceChainContinuous: boolean;
  readonly bundleHash: string;
  readonly bundleSignature: string | null;
}

export interface VerifyRegulatorPackResult {
  readonly hashValid: boolean;
  readonly signatureValid: boolean;
  readonly valid: boolean;
}

// ─── Canonicalisation ─────────────────────────────────────────────────────────

/** Stable JSON: object keys sorted recursively so key order can't shift hash. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      sorted[k] = (v as Record<string, unknown>)[k];
    }
    return sorted;
  });
}

/**
 * The exact subset that is hashed. Excludes the hash + signature themselves
 * (a digest can't cover itself). Includes meta so a regulator can't re-stamp
 * the period / tenant / four-eye provenance without breaking the hash.
 */
function hashableView(bundle: Omit<RegulatorPackBundle, 'bundleHash' | 'bundleSignature'>): string {
  return canonical({
    bundleVersion: bundle.bundleVersion,
    kind: bundle.kind,
    tenantId: bundle.tenantId,
    period: bundle.period,
    generatedAt: bundle.generatedAt,
    fourEye: bundle.fourEye,
    sections: bundle.sections,
    counts: bundle.counts,
    evidenceChainContinuous: bundle.evidenceChainContinuous,
  });
}

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** HMAC-sha256(hash, secret); null when no secret (dev → unsigned). */
function sign(hash: string, secret: string | null): string | null {
  if (!secret || secret.length === 0) return null;
  return createHmac('sha256', secret).update(hash, 'utf8').digest('hex');
}

/** Constant-time hex compare (equal-length HMAC/sha256 hex → safe). */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify the ai_audit_chain hash-link invariant: entry[n].prevHash must equal
 * entry[n-1].thisHash once sorted by sequenceId. An empty chain is trivially
 * continuous (nothing to excise).
 */
function isEvidenceChainContinuous(
  entries: ReadonlyArray<EvidenceChainEntry>,
): boolean {
  if (entries.length <= 1) return true;
  const sorted = [...entries].sort((a, b) => a.sequenceId - b.sequenceId);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]!.prevHash !== sorted[i - 1]!.thisHash) return false;
  }
  return true;
}

// ─── Build + verify ───────────────────────────────────────────────────────────

/**
 * Assemble the verifiable regulator pack. Deterministic: identical sources +
 * meta + secret always yield an identical `bundleHash` / `bundleSignature`.
 */
export function buildRegulatorPack(
  sources: RegulatorPackSources,
  meta: RegulatorPackMeta,
  signingSecret: string | null,
): RegulatorPackBundle {
  const sections = {
    auditEvents: sources.auditEvents,
    regulatoryFilings: sources.regulatoryFilings,
    complianceExports: sources.complianceExports,
    evidenceChain: sources.evidenceChain,
  };
  const counts = {
    auditEvents: sources.auditEvents.length,
    regulatoryFilings: sources.regulatoryFilings.length,
    complianceExports: sources.complianceExports.length,
    evidenceChain: sources.evidenceChain.length,
  };
  const evidenceChainContinuous = isEvidenceChainContinuous(sources.evidenceChain);

  const withoutDigest: Omit<RegulatorPackBundle, 'bundleHash' | 'bundleSignature'> = {
    bundleVersion: 1,
    kind: 'regulator_pack',
    tenantId: meta.tenantId,
    period: { start: meta.periodStart, end: meta.periodEnd },
    generatedAt: meta.generatedAt,
    fourEye: { requestedBy: meta.requestedBy, approvedBy: meta.approvedBy },
    sections,
    counts,
    evidenceChainContinuous,
  };

  const bundleHash = sha256(hashableView(withoutDigest));
  const bundleSignature = sign(bundleHash, signingSecret);

  return { ...withoutDigest, bundleHash, bundleSignature };
}

/**
 * Recompute the hash + signature over the supplied bundle and report whether
 * it has been tampered with. `hashValid` catches content edits; `signatureValid`
 * catches a wrong/rotated signing key. When the bundle is unsigned, the
 * signature is considered valid IFF the verifier also supplies no secret.
 */
export function verifyRegulatorPack(
  bundle: RegulatorPackBundle,
  signingSecret: string | null,
): VerifyRegulatorPackResult {
  const recomputedHash = sha256(
    hashableView({
      bundleVersion: bundle.bundleVersion,
      kind: bundle.kind,
      tenantId: bundle.tenantId,
      period: bundle.period,
      generatedAt: bundle.generatedAt,
      fourEye: bundle.fourEye,
      sections: bundle.sections,
      counts: bundle.counts,
      evidenceChainContinuous: bundle.evidenceChainContinuous,
    }),
  );
  const hashValid = safeEqualHex(recomputedHash, bundle.bundleHash);

  let signatureValid: boolean;
  if (!signingSecret || signingSecret.length === 0) {
    signatureValid = bundle.bundleSignature === null;
  } else {
    const expected = sign(recomputedHash, signingSecret);
    signatureValid =
      expected !== null &&
      bundle.bundleSignature !== null &&
      safeEqualHex(expected, bundle.bundleSignature);
  }

  return { hashValid, signatureValid, valid: hashValid && signatureValid };
}
