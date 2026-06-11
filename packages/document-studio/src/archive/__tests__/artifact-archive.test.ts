/**
 * Unit tests for the immutable artifact archive + audit-hash linkage.
 * Verifies seal → WORM chain → content-addressed storage → signature
 * linkage, and the append-only invariant (no signature overwrite).
 */

import { describe, expect, it } from 'vitest';
import {
  createArtifactArchive,
  createInMemoryArchiveStorage,
  archiveStorageKey,
} from '../artifact-archive.js';
import { createInMemoryWormAuditStore } from '../../signing/worm-audit.js';
import type { Citation } from '../../types.js';

const citations: ReadonlyArray<Citation> = [
  {
    id: 'C1',
    claim: 'TZS 142,500',
    source: { kind: 'ledger_entry', ref: 'ledger:001' },
  },
];

function build() {
  const storage = createInMemoryArchiveStorage();
  const worm = createInMemoryWormAuditStore();
  const archive = createArtifactArchive({ worm, storage });
  return { storage, worm, archive };
}

const sealInput = (bytes: Uint8Array) => ({
  tenantId: 'tenant-1',
  actorId: 'actor-1',
  documentKind: 'royalty_statement',
  format: 'pdf' as const,
  language: 'en' as const,
  currencyCode: 'TZS',
  bytes,
  citations,
  bucket: 'documents',
  generatedAt: new Date('2026-06-08T00:00:00.000Z'),
});

describe('artifact archive — seal', () => {
  it('uploads bytes, appends a WORM entry, and records the artifact', async () => {
    const { storage, archive } = build();
    const bytes = new TextEncoder().encode('rendered-pdf-bytes');
    const artifact = await archive.seal(sealInput(bytes));

    expect(artifact.renderedSha256).toBeTruthy();
    expect(artifact.auditChainHash).toBeTruthy();
    expect(artifact.previousChainHash).toBeNull();
    expect(artifact.storageKey).toBe(
      archiveStorageKey('tenant-1', 'royalty_statement', artifact.renderedSha256, 'pdf'),
    );
    // Bytes are actually in storage (non-zero).
    const stored = storage.read(artifact.storageKey);
    expect(stored).toBeDefined();
    expect(stored!.byteLength).toBeGreaterThan(0);
  });

  it('chains successive seals (append-only audit hash linkage)', async () => {
    const { archive } = build();
    const a = await archive.seal(sealInput(new TextEncoder().encode('doc-a')));
    const b = await archive.seal(sealInput(new TextEncoder().encode('doc-b')));
    expect(b.previousChainHash).toBe(a.auditChainHash);
    const verify = await archive.verifyChain('tenant-1');
    expect(verify.ok).toBe(true);
  });

  it('threads language + currency into the immutable record', async () => {
    const { archive } = build();
    const artifact = await archive.seal({
      ...sealInput(new TextEncoder().encode('sw-doc')),
      language: 'sw',
      currencyCode: 'KES',
    });
    expect(artifact.language).toBe('sw');
    expect(artifact.currencyCode).toBe('KES');
  });
});

describe('artifact archive — signature linkage', () => {
  it('links a signed artifact with a distinct signed sha256', async () => {
    const { archive } = build();
    const artifact = await archive.seal(
      sealInput(new TextEncoder().encode('unsigned')),
    );
    const signedBytes = new TextEncoder().encode('unsigned[SIGNED]');
    const linked = await archive.linkSignature({
      artifactId: artifact.artifactId,
      provider: 'mock',
      envelopeId: 'env-1',
      tier: 'ses',
      signedBytes,
      bucket: 'documents',
    });
    expect(linked.signature?.envelopeId).toBe('env-1');
    expect(linked.signature?.provider).toBe('mock');
    expect(linked.signature?.signedSha256).not.toBe(artifact.renderedSha256);
  });

  it('refuses to overwrite an existing signature (append-only)', async () => {
    const { archive } = build();
    const artifact = await archive.seal(
      sealInput(new TextEncoder().encode('doc')),
    );
    await archive.linkSignature({
      artifactId: artifact.artifactId,
      provider: 'mock',
      envelopeId: 'env-1',
      tier: 'ses',
      signedBytes: new TextEncoder().encode('s1'),
      bucket: 'documents',
    });
    await expect(
      archive.linkSignature({
        artifactId: artifact.artifactId,
        provider: 'mock',
        envelopeId: 'env-2',
        tier: 'ses',
        signedBytes: new TextEncoder().encode('s2'),
        bucket: 'documents',
      }),
    ).rejects.toThrow(/already signed/);
  });

  it('rejects linking to an unknown artifact', async () => {
    const { archive } = build();
    await expect(
      archive.linkSignature({
        artifactId: 'nope',
        provider: 'mock',
        envelopeId: 'e',
        tier: 'ses',
        signedBytes: new Uint8Array(1),
        bucket: 'documents',
      }),
    ).rejects.toThrow(/unknown artifact/);
  });
});
