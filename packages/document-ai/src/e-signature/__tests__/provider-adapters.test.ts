import { describe, expect, it, vi } from 'vitest';
import { createDocuSignAdapter } from '../docusign-adapter.js';
import { createHelloSignAdapter } from '../hellosign-adapter.js';
import { createAdobeSignAdapter } from '../adobe-sign-adapter.js';
import type { SignaturePortConfig } from '../../types.js';

const SAMPLE_PDF = new TextEncoder().encode('%PDF-1.7\n%trailer\n');

function cfg(jurisdiction: SignaturePortConfig['jurisdiction']): SignaturePortConfig {
  return {
    doc: { id: 'lease-99', bytes: SAMPLE_PDF, mime: 'application/pdf' },
    signers: [{ email: 'tenant@x.io', name: 'Asha', order: 0 }],
    expiresAt: new Date('2027-01-01T00:00:00Z'),
    jurisdiction,
  };
}

function fakeFetch(body: unknown, status = 200, isPdf = false): typeof fetch {
  return vi.fn(async () => {
    if (isPdf) {
      return new Response(SAMPLE_PDF, {
        status,
        headers: { 'content-type': 'application/pdf' },
      });
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('createDocuSignAdapter', () => {
  it('reports correct jurisdictions and id', () => {
    const adapter = createDocuSignAdapter({
      apiKey: 'k',
      accountId: 'a',
    });
    expect(adapter.id).toBe('docusign');
    expect(adapter.supportedJurisdictions).toContain('EU_eIDAS_QES');
  });

  it('creates an envelope and maps statuses', async () => {
    const fetcher = fakeFetch({ envelopeId: 'env-1', statusDateTime: '2026-05-01' });
    const adapter = createDocuSignAdapter({
      apiKey: 'k',
      accountId: 'a',
      fetcher,
    });
    const req = await adapter.requestSignature(cfg('EU_eIDAS_QES'));
    expect(req.requestId).toBe('env-1');
    expect(req.providerRef).toBe('env-1');
  });

  it('translates declined recipient to declined status', async () => {
    const fetcher = vi
      .fn(async (_url: string) =>
        new Response(
          JSON.stringify({
            signers: [
              { email: 'tenant@x.io', status: 'declined' },
            ],
          }),
          { status: 200 }
        )
      ) as unknown as typeof fetch;
    const adapter = createDocuSignAdapter({
      apiKey: 'k',
      accountId: 'a',
      fetcher,
    });
    const status = await adapter.pollStatus('env-1');
    expect(status.status).toBe('declined');
    expect(status.declinedBy).toContain('tenant@x.io');
  });

  it('downloads the combined PDF', async () => {
    const fetcher = fakeFetch(undefined, 200, true);
    const adapter = createDocuSignAdapter({
      apiKey: 'k',
      accountId: 'a',
      fetcher,
    });
    const bytes = await adapter.downloadSigned('env-1');
    expect(bytes.length).toBe(SAMPLE_PDF.length);
  });
});

describe('createHelloSignAdapter', () => {
  it('creates a signature request and returns the id', async () => {
    const fetcher = fakeFetch({
      signature_request: {
        signature_request_id: 'sr-7',
        created_at: 1717000000,
      },
    });
    const adapter = createHelloSignAdapter({ apiKey: 'k', fetcher });
    const req = await adapter.requestSignature(cfg('US_ESIGN'));
    expect(req.requestId).toBe('sr-7');
    expect(req.createdAt.getTime()).toBe(1717000000 * 1000);
  });

  it('polls and translates is_complete into completed', async () => {
    const fetcher = fakeFetch({
      signature_request: {
        is_complete: true,
        is_declined: false,
        signatures: [{ signer_email_address: 'tenant@x.io', status_code: 'signed' }],
      },
    });
    const adapter = createHelloSignAdapter({ apiKey: 'k', fetcher });
    const status = await adapter.pollStatus('sr-7');
    expect(status.status).toBe('completed');
    expect(status.signedBy).toContain('tenant@x.io');
  });
});

describe('createAdobeSignAdapter', () => {
  it('creates an agreement via two HTTP calls', async () => {
    let call = 0;
    const fetcher = vi.fn(async () => {
      call += 1;
      const body =
        call === 1
          ? { transientDocumentId: 'doc-1' }
          : { id: 'agree-1' };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const adapter = createAdobeSignAdapter({ apiKey: 'k', fetcher });
    const req = await adapter.requestSignature(cfg('EU_eIDAS_AES'));
    expect(req.requestId).toBe('agree-1');
    expect(call).toBe(2);
  });

  it('maps SIGNED status to completed', async () => {
    const fetcher = fakeFetch({
      status: 'SIGNED',
      participantSetsInfo: [
        { memberInfos: [{ email: 'tenant@x.io', status: 'SIGNED' }] },
      ],
    });
    const adapter = createAdobeSignAdapter({ apiKey: 'k', fetcher });
    const status = await adapter.pollStatus('agree-1');
    expect(status.status).toBe('completed');
    expect(status.signedBy).toContain('tenant@x.io');
  });
});
