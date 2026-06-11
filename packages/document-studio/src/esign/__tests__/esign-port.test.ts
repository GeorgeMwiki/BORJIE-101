/**
 * E-signature PORT contract tests.
 *
 * Both the in-memory mock and the Dropbox-Sign-style adapter satisfy the
 * SAME `ESignPort` contract — these tests prove the lifecycle (create →
 * poll → complete → download), idempotency, the config secret-guard, and
 * the tier/sha256 binding. No real network: the adapter's `fetchImpl` is
 * injected.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createMockESignAdapter } from '../mock-adapter.js';
import { createDropboxSignAdapter } from '../dropbox-sign-adapter.js';
import type { ESignPort, ESignRequest } from '../port.js';

function sampleRequest(overrides?: Partial<ESignRequest>): ESignRequest {
  const bytes = new TextEncoder().encode('%PDF-1.7 offtake agreement');
  return {
    tenantId: 'tenant-1',
    title: 'Off-take Agreement',
    message: 'Please sign',
    document: {
      fileName: 'offtake.pdf',
      mimeType: 'application/pdf',
      bytes,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    signers: [
      { role: 'buyer', name: 'Acme Buyer', email: 'buyer@example.com', order: 0 },
      { role: 'producer', name: 'Tz Producer', email: 'prod@example.com', order: 1 },
    ],
    tier: 'ses',
    ...overrides,
  } as ESignRequest;
}

/** Generic contract assertions any ESignPort must satisfy. */
async function assertLifecycle(port: ESignPort): Promise<void> {
  const req = sampleRequest();
  const env = await port.createEnvelope(req);
  expect(env.envelopeId).toBeTruthy();
  expect(env.documentSha256).toBe(req.document.sha256);
  expect(env.tier).toBe('ses');
  expect(['created', 'sent']).toContain(env.state);

  // Poll to completion.
  let polled = await port.getEnvelope(env.envelopeId);
  for (let i = 0; i < 5 && polled.state !== 'completed'; i++) {
    polled = await port.getEnvelope(env.envelopeId);
  }
  expect(polled.state).toBe('completed');

  const signed = await port.downloadSigned(env.envelopeId);
  expect(signed.bytes.byteLength).toBeGreaterThan(0);
  // The signed sha256 differs from the unsigned one (provider stamps it).
  expect(signed.sha256).not.toBe(req.document.sha256);
}

describe('mock e-sign adapter — contract', () => {
  it('runs the full create → poll → complete → download lifecycle', async () => {
    await assertLifecycle(createMockESignAdapter());
  });

  it('is idempotent on idempotencyKey (at-least-once safe re-submit)', async () => {
    const port = createMockESignAdapter();
    const req = sampleRequest({ idempotencyKey: 'idem-123' });
    const a = await port.createEnvelope(req);
    const b = await port.createEnvelope(req);
    expect(b.envelopeId).toBe(a.envelopeId);
  });

  it('refuses download before completion', async () => {
    const port = createMockESignAdapter({ completeAfterPolls: 99 });
    const env = await port.createEnvelope(sampleRequest());
    await expect(port.downloadSigned(env.envelopeId)).rejects.toThrow(
      /not completed/,
    );
  });

  it('echoes the requested tier (AES for a cross-border counterparty)', async () => {
    const port = createMockESignAdapter();
    const env = await port.createEnvelope(sampleRequest({ tier: 'aes' }));
    expect(env.tier).toBe('aes');
  });

  it('voids an in-flight envelope', async () => {
    const port = createMockESignAdapter({ completeAfterPolls: 99 });
    const env = await port.createEnvelope(sampleRequest());
    const voided = await port.voidEnvelope(env.envelopeId, 'superseded');
    expect(voided.state).toBe('voided');
  });

  it('rejects an invalid request (zod gate)', async () => {
    const port = createMockESignAdapter();
    await expect(
      port.createEnvelope({ ...sampleRequest(), signers: [] }),
    ).rejects.toThrow();
  });
});

describe('dropbox-sign adapter — config + wire shape', () => {
  it('throws when apiKey is blank (no secret = fail fast, never env-read)', () => {
    expect(() => createDropboxSignAdapter({ apiKey: '' })).toThrow(/apiKey/);
    expect(() => createDropboxSignAdapter({ apiKey: '   ' })).toThrow(/apiKey/);
  });

  it('POSTs a multipart signature request with Basic auth from the injected key', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          signature_request: {
            signature_request_id: 'sig-req-1',
            is_complete: false,
            status_code: 'awaiting_signature',
            signatures: [
              { signer_email_address: 'buyer@example.com', status_code: 'awaiting_signature' },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const port = createDropboxSignAdapter({
      apiKey: 'test-key-abc',
      testMode: true,
      fetchImpl,
    });
    const env = await port.createEnvelope(sampleRequest());
    expect(env.envelopeId).toBe('sig-req-1');
    expect(env.provider).toBe('dropbox-sign');
    expect(env.state).toBe('sent');

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toContain('/signature_request/send');
    const headers = (init as RequestInit).headers as Record<string, string>;
    // Basic auth = base64('test-key-abc:').
    expect(headers.authorization).toBe(
      `Basic ${Buffer.from('test-key-abc:').toString('base64')}`,
    );
  });

  it('maps provider completion → completed envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          signature_request: {
            signature_request_id: 'sig-req-2',
            is_complete: true,
            signatures: [
              {
                signer_email_address: 'buyer@example.com',
                status_code: 'signed',
                signed_at: 1_700_000_000,
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const port = createDropboxSignAdapter({ apiKey: 'k', fetchImpl });
    const env = await port.getEnvelope('sig-req-2');
    expect(env.state).toBe('completed');
    expect(env.signers[0]?.signed).toBe(true);
  });

  it('forwards the idempotency-key header on create', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          signature_request: { signature_request_id: 'x', is_complete: false },
        }),
        { status: 200 },
      ),
    );
    const port = createDropboxSignAdapter({ apiKey: 'k', fetchImpl });
    await port.createEnvelope(sampleRequest({ idempotencyKey: 'idem-9' }));
    const init = fetchImpl.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe(
      'idem-9',
    );
  });

  it('downloads the signed PDF and re-hashes it', async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 1, 2, 3]);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(pdfBytes, {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      }),
    );
    const port = createDropboxSignAdapter({ apiKey: 'k', fetchImpl });
    const signed = await port.downloadSigned('env-7');
    expect(signed.envelopeId).toBe('env-7');
    expect(signed.mimeType).toBe('application/pdf');
    expect(signed.sha256).toHaveLength(64);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(
      '/signature_request/files/env-7',
    );
  });

  it('voids an envelope', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const port = createDropboxSignAdapter({ apiKey: 'k', fetchImpl });
    const voided = await port.voidEnvelope('env-8', 'superseded');
    expect(voided.state).toBe('voided');
    expect(String(fetchImpl.mock.calls[0]![0])).toContain(
      '/signature_request/cancel/env-8',
    );
  });

  it('surfaces a non-2xx as a thrown error (never swallows)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('nope', { status: 401, statusText: 'Unauthorized' }),
    );
    const port = createDropboxSignAdapter({ apiKey: 'k', fetchImpl });
    await expect(port.getEnvelope('env-9')).rejects.toThrow(/401/);
  });

  it('throws on a failed signed-file download', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('nope', { status: 404, statusText: 'Not Found' }),
    );
    const port = createDropboxSignAdapter({ apiKey: 'k', fetchImpl });
    await expect(port.downloadSigned('env-10')).rejects.toThrow(/404/);
  });
});
