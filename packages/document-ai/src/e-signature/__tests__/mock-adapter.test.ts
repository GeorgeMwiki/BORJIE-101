import { describe, expect, it } from 'vitest';
import { createMockESignAdapter } from '../mock-adapter.js';
import type { SignaturePortConfig } from '../../types.js';

const SAMPLE_PDF = new TextEncoder().encode('%PDF-1.7\n%trailer\n');

function sampleConfig(): SignaturePortConfig {
  return {
    doc: { id: 'offtake-001', bytes: SAMPLE_PDF, mime: 'application/pdf' },
    signers: [
      { email: 'buyer@example.com', name: 'Asha Mwangi', order: 0, role: 'buyer' },
      { email: 'owner@example.com', name: 'Borjie Mwema', order: 1, role: 'owner' },
    ],
    expiresAt: new Date('2026-12-31T00:00:00Z'),
    jurisdiction: 'TZ_ETA2015',
    subject: 'Sign your offtake agreement',
  };
}

describe('createMockESignAdapter', () => {
  it('creates a signature request and returns deterministic shape', async () => {
    const adapter = createMockESignAdapter();
    const req = await adapter.requestSignature(sampleConfig());
    expect(req.requestId).toMatch(/^mock-/);
    expect(req.docId).toBe('offtake-001');
    expect(req.signers).toHaveLength(2);
    expect(req.jurisdiction).toBe('TZ_ETA2015');
  });

  it('starts as pending and advances when markSigned is called', async () => {
    const adapter = createMockESignAdapter();
    const req = await adapter.requestSignature(sampleConfig());

    const first = await adapter.pollStatus(req.requestId);
    expect(first.status).toBe('pending');

    adapter.markSigned(req.requestId, 'buyer@example.com');
    const partial = await adapter.pollStatus(req.requestId);
    expect(partial.status).toBe('partially_signed');
    expect(partial.signedBy).toContain('buyer@example.com');

    adapter.markSigned(req.requestId, 'owner@example.com');
    const done = await adapter.pollStatus(req.requestId);
    expect(done.status).toBe('completed');
  });

  it('auto-advances when configured', async () => {
    const adapter = createMockESignAdapter({ autoAdvance: true });
    const req = await adapter.requestSignature(sampleConfig());
    const first = await adapter.pollStatus(req.requestId);
    expect(first.status).toBe('partially_signed');
    const second = await adapter.pollStatus(req.requestId);
    expect(['partially_signed', 'completed']).toContain(second.status);
  });

  it('marks declined when markDeclined is called', async () => {
    const adapter = createMockESignAdapter();
    const req = await adapter.requestSignature(sampleConfig());
    adapter.markDeclined(req.requestId, 'buyer@example.com');
    const status = await adapter.pollStatus(req.requestId);
    expect(status.status).toBe('declined');
    expect(status.declinedBy).toContain('buyer@example.com');
  });

  it('downloads signed PDF with marker appended', async () => {
    const adapter = createMockESignAdapter();
    const req = await adapter.requestSignature(sampleConfig());
    const bytes = await adapter.downloadSigned(req.requestId);
    expect(bytes.length).toBeGreaterThan(SAMPLE_PDF.length);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('SIGNED-MOCK');
  });

  it('returns error status for an unknown requestId', async () => {
    const adapter = createMockESignAdapter();
    const status = await adapter.pollStatus('nope');
    expect(status.status).toBe('error');
  });

  it('returns empty bytes for unknown requestId on download', async () => {
    const adapter = createMockESignAdapter();
    const bytes = await adapter.downloadSigned('nope');
    expect(bytes.length).toBe(0);
  });

  it('lists supported jurisdictions', async () => {
    const adapter = createMockESignAdapter();
    expect(adapter.supportedJurisdictions).toContain('TZ_ETA2015');
    expect(adapter.supportedJurisdictions).toContain('INTERNAL_ONLY');
  });
});
