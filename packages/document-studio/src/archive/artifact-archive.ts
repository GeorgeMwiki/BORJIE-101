/**
 * @borjie/document-studio — immutable artifact archive + audit-hash
 * linkage.
 *
 * Every rendered document that leaves the pipeline is sealed here:
 *
 *   render bytes ──sha256──┐
 *                          ├──► WORM audit entry (hash-chained, append-only)
 *   citation set ─sha256──┘                │
 *                                          ▼
 *                              ArchivedArtifact (immutable record:
 *                              storage key + both sha256 + chain hash +
 *                              optional signed-artifact linkage)
 *
 * The archive REUSES the existing `WormAuditStore` (worm-audit.ts) for
 * the hash-chain (hard rail: AI audit chain is hash-chained, append-only)
 * and adds an immutable artifact registry on top. The storage transport
 * is an injected port (`ArchiveStoragePort`) so this package never binds
 * Supabase/S3 directly — production wires the real bucket, tests wire an
 * in-memory store.
 */

import { sha256Hex } from '../citations/citation-verifier.js';
import { toVerifierCitations } from '../citations/adapt.js';
import { citationsSha256 } from '../signing/worm-audit.js';
import type { WormAuditEntry, WormAuditStore } from '../signing/worm-audit.js';
import type { Citation, DocFormat } from '../types.js';

/**
 * Injected blob-storage port. The studio uploads sealed bytes through
 * this; it never knows whether the backend is Supabase Storage, S3, or
 * an in-memory map. Mirrors the project's `StorageAdapter` shape without
 * importing it (keeps this package dependency-light).
 */
export interface ArchiveStoragePort {
  /** Persist bytes under a key in a bucket; returns the stored key. */
  put(input: {
    readonly bucket: string;
    readonly key: string;
    readonly bytes: Uint8Array;
    readonly contentType: string;
  }): Promise<{ readonly key: string }>;
}

/** The immutable record of one sealed, archived document. */
export interface ArchivedArtifact {
  readonly artifactId: string;
  readonly tenantId: string;
  readonly documentKind: string;
  readonly format: DocFormat;
  readonly language: 'en' | 'sw';
  readonly currencyCode: string;
  readonly storageBucket: string;
  readonly storageKey: string;
  /** sha256 of the rendered bytes. */
  readonly renderedSha256: string;
  /** sha256 of the citation set (evidence chain fingerprint). */
  readonly citationsSha256: string;
  /** The WORM chain hash this artifact is bound to. */
  readonly auditChainHash: string;
  /** The prior chain hash — the append-only linkage. */
  readonly previousChainHash: string | null;
  readonly sealedAtIso: string;
  /** Set once an e-sign envelope is linked to this artifact. */
  readonly signature?: {
    readonly provider: string;
    readonly envelopeId: string;
    readonly tier: string;
    /** sha256 of the SIGNED bytes (differs from `renderedSha256`). */
    readonly signedSha256: string;
    readonly signedStorageKey: string;
  };
}

export interface SealInput {
  readonly tenantId: string;
  readonly actorId: string;
  readonly documentKind: string;
  readonly format: DocFormat;
  readonly language: 'en' | 'sw';
  readonly currencyCode: string;
  readonly bytes: Uint8Array;
  readonly citations: ReadonlyArray<Citation>;
  /** Bucket to archive under (injected by the caller's config). */
  readonly bucket: string;
  /** Wall-clock seed — pinned so the same input archives identically. */
  readonly generatedAt: Date;
}

export interface ArtifactArchive {
  /** Render → upload → WORM-seal → immutable artifact record. */
  seal(input: SealInput): Promise<ArchivedArtifact>;
  /** Attach a completed signature to a previously sealed artifact. */
  linkSignature(input: {
    readonly artifactId: string;
    readonly provider: string;
    readonly envelopeId: string;
    readonly tier: string;
    readonly signedBytes: Uint8Array;
    readonly bucket: string;
  }): Promise<ArchivedArtifact>;
  /** Fetch a sealed artifact (immutable snapshot). */
  get(artifactId: string): ArchivedArtifact | undefined;
  /** Verify the underlying WORM chain for a tenant. */
  verifyChain(tenantId: string): Promise<{ ok: boolean; brokenAt?: number }>;
}

/** Build the deterministic storage key for a sealed artifact. */
export function archiveStorageKey(
  tenantId: string,
  documentKind: string,
  renderedSha256: string,
  format: DocFormat,
): string {
  return `documents/${tenantId}/${documentKind}/${renderedSha256}.${format}`;
}

/**
 * Construct the archive over an injected WORM store + storage port. The
 * artifact registry itself is in-memory here (an immutable Map); the
 * durable record lives in the WORM store + blob storage. Production may
 * pass a Drizzle-backed `WormAuditStore`.
 */
export function createArtifactArchive(deps: {
  readonly worm: WormAuditStore;
  readonly storage: ArchiveStoragePort;
}): ArtifactArchive {
  const byId = new Map<string, ArchivedArtifact>();
  // The WORM entryId is the canonical artifact id, keyed for linkage.
  function wormToArtifact(
    entry: WormAuditEntry,
    base: Omit<
      ArchivedArtifact,
      | 'artifactId'
      | 'renderedSha256'
      | 'citationsSha256'
      | 'auditChainHash'
      | 'previousChainHash'
      | 'signature'
    >,
  ): ArchivedArtifact {
    return Object.freeze({
      artifactId: entry.entryId,
      renderedSha256: entry.renderedSha256,
      citationsSha256: entry.citationsSha256,
      auditChainHash: entry.chainHash,
      previousChainHash: entry.previousEntryHash,
      ...base,
    });
  }

  return {
    async seal(input) {
      const renderedSha256 = sha256Hex(input.bytes);
      const key = archiveStorageKey(
        input.tenantId,
        input.documentKind,
        renderedSha256,
        input.format,
      );
      // 1. Upload the bytes (idempotent on content-addressed key).
      const stored = await deps.storage.put({
        bucket: input.bucket,
        key,
        bytes: input.bytes,
        contentType: contentTypeFor(input.format),
      });
      // 2. Append the hash-chained WORM entry.
      const entry = await deps.worm.append({
        tenantId: input.tenantId,
        actorId: input.actorId,
        documentKind: input.documentKind,
        documentId: stored.key,
        renderedAtIso: input.generatedAt.toISOString(),
        renderedSha256,
        citationsSha256: citationsSha256(toVerifierCitations(input.citations)),
      });
      // 3. Build the immutable artifact record.
      const artifact = wormToArtifact(entry, {
        tenantId: input.tenantId,
        documentKind: input.documentKind,
        format: input.format,
        language: input.language,
        currencyCode: input.currencyCode,
        storageBucket: input.bucket,
        storageKey: stored.key,
        sealedAtIso: input.generatedAt.toISOString(),
      });
      byId.set(artifact.artifactId, artifact);
      return artifact;
    },

    async linkSignature(input) {
      const existing = byId.get(input.artifactId);
      if (!existing) {
        throw new Error(
          `artifact-archive: unknown artifact '${input.artifactId}'`,
        );
      }
      if (existing.signature) {
        throw new Error(
          `artifact-archive: artifact '${input.artifactId}' already signed ` +
            '(append-only — cannot overwrite a sealed signature)',
        );
      }
      const signedSha256 = sha256Hex(input.signedBytes);
      const signedKey = `${existing.storageKey}.signed.pdf`;
      const stored = await deps.storage.put({
        bucket: input.bucket,
        key: signedKey,
        bytes: input.signedBytes,
        contentType: 'application/pdf',
      });
      const updated: ArchivedArtifact = Object.freeze({
        ...existing,
        signature: {
          provider: input.provider,
          envelopeId: input.envelopeId,
          tier: input.tier,
          signedSha256,
          signedStorageKey: stored.key,
        },
      });
      byId.set(updated.artifactId, updated);
      return updated;
    },

    get(artifactId) {
      return byId.get(artifactId);
    },

    verifyChain(tenantId) {
      return deps.worm.verify(tenantId);
    },
  };
}

/** MIME for a format — local map so the archive stays self-contained. */
function contentTypeFor(format: DocFormat): string {
  switch (format) {
    case 'pdf':
      return 'application/pdf';
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'html':
      return 'text/html; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

/** In-memory storage port for dev/tests — content-addressed, immutable. */
export function createInMemoryArchiveStorage(): ArchiveStoragePort & {
  readonly read: (key: string) => Uint8Array | undefined;
} {
  const blobs = new Map<string, Uint8Array>();
  return {
    async put(input) {
      const fullKey = `${input.bucket}/${input.key}`;
      // Content-addressed → re-put of identical bytes is a no-op.
      blobs.set(fullKey, input.bytes);
      return { key: input.key };
    },
    read(key) {
      // Accept both bucketed and bare keys for test convenience.
      for (const [k, v] of blobs.entries()) {
        if (k === key || k.endsWith(`/${key}`)) return v;
      }
      return undefined;
    },
  };
}
