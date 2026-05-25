/**
 * createHelloSignAdapter — Dropbox Sign (HelloSign) REST v3 port.
 *
 * Reference: https://developers.hellosign.com/api/reference/operation/signatureRequestSend/
 *
 * Treats the signature request as a single "signature_request" with
 * the doc as a base64 file. We accept the same SignaturePortConfig as
 * every other e-sig adapter so consumers can swap providers without
 * changing call sites.
 */

import type {
  ESignaturePort,
  ESignJurisdiction,
  SignatureRequest,
  SignaturePortConfig,
  SignatureStatus,
  SignatureStatusCode,
} from '../types.js';

export interface HelloSignAdapterConfig {
  readonly apiKey: string;
  readonly clientId?: string;
  readonly baseUrl?: string;
  readonly fetcher?: typeof fetch;
}

const STATUS_MAP: Readonly<Record<string, SignatureStatusCode>> = Object.freeze({
  awaiting_signature: 'pending',
  signature_request_sent: 'pending',
  signed: 'partially_signed',
  all_signed: 'completed',
  declined: 'declined',
  canceled: 'declined',
  expired: 'expired',
});

const SUPPORTED: ReadonlyArray<ESignJurisdiction> = [
  'US_ESIGN',
  'EU_eIDAS_SES',
  'EU_eIDAS_AES',
  'AfCFTA',
];

export function createHelloSignAdapter(config: HelloSignAdapterConfig): ESignaturePort {
  const baseUrl = config.baseUrl ?? 'https://api.hellosign.com/v3';
  return {
    id: 'hellosign',
    supportedJurisdictions: SUPPORTED,
    async requestSignature(input: SignaturePortConfig): Promise<SignatureRequest> {
      const fetcher = config.fetcher ?? (typeof fetch !== 'undefined' ? fetch : null);
      if (!fetcher) throw new Error('hellosign: fetch is not available');
      const form = new FormData();
      form.append('title', input.subject ?? 'Signature Request');
      form.append('message', input.message ?? '');
      form.append(
        'file[0]',
        new Blob([new Uint8Array(input.doc.bytes)], { type: input.doc.mime }),
        `${input.doc.id}.pdf`
      );
      input.signers.forEach((signer, idx) => {
        form.append(`signers[${idx}][email_address]`, signer.email);
        form.append(`signers[${idx}][name]`, signer.name);
        form.append(`signers[${idx}][order]`, String(signer.order));
      });
      form.append('test_mode', '1');
      if (config.clientId) form.append('client_id', config.clientId);

      const response = await fetcher(`${baseUrl}/signature_request/send`, {
        method: 'POST',
        headers: { authorization: `Basic ${basicAuth(config.apiKey)}` },
        body: form,
      });
      if (!response.ok) throw new Error(`hellosign: HTTP ${response.status}`);
      const json = (await response.json()) as {
        signature_request: { signature_request_id: string; created_at: number };
      };
      return {
        requestId: json.signature_request.signature_request_id,
        docId: input.doc.id,
        signers: input.signers,
        jurisdiction: input.jurisdiction,
        expiresAt: input.expiresAt,
        providerRef: json.signature_request.signature_request_id,
        createdAt: new Date(json.signature_request.created_at * 1000),
      };
    },
    async pollStatus(requestId: string): Promise<SignatureStatus> {
      const fetcher = config.fetcher ?? (typeof fetch !== 'undefined' ? fetch : null);
      if (!fetcher) throw new Error('hellosign: fetch is not available');
      const response = await fetcher(`${baseUrl}/signature_request/${requestId}`, {
        headers: { authorization: `Basic ${basicAuth(config.apiKey)}` },
      });
      if (!response.ok) return errorStatus(requestId);
      const json = (await response.json()) as {
        signature_request: {
          is_complete: boolean;
          is_declined: boolean;
          signatures: ReadonlyArray<{ signer_email_address: string; status_code: string }>;
        };
      };
      const sigs = json.signature_request.signatures;
      const signedBy = sigs.filter((s) => s.status_code === 'signed').map((s) => s.signer_email_address);
      const declinedBy = sigs.filter((s) => s.status_code === 'declined').map((s) => s.signer_email_address);
      const status: SignatureStatusCode = json.signature_request.is_complete
        ? 'completed'
        : json.signature_request.is_declined
          ? 'declined'
          : signedBy.length === 0
            ? 'pending'
            : 'partially_signed';
      return {
        requestId,
        status,
        signedBy,
        declinedBy,
        lastEventAt: new Date(),
      };
    },
    async downloadSigned(requestId: string): Promise<Uint8Array> {
      const fetcher = config.fetcher ?? (typeof fetch !== 'undefined' ? fetch : null);
      if (!fetcher) throw new Error('hellosign: fetch is not available');
      const response = await fetcher(
        `${baseUrl}/signature_request/files/${requestId}?file_type=pdf`,
        { headers: { authorization: `Basic ${basicAuth(config.apiKey)}` } }
      );
      if (!response.ok) return new Uint8Array(0);
      const buf = await response.arrayBuffer();
      return new Uint8Array(buf);
    },
  };
}

function basicAuth(apiKey: string): string {
  const encoded = typeof Buffer !== 'undefined'
    ? Buffer.from(`${apiKey}:`).toString('base64')
    : // eslint-disable-next-line no-undef
      btoa(`${apiKey}:`);
  return encoded;
}

function errorStatus(requestId: string): SignatureStatus {
  return {
    requestId,
    status: 'error',
    signedBy: [],
    declinedBy: [],
    lastEventAt: new Date(),
  };
}

export const _STATUS_MAP_INTERNAL = STATUS_MAP;
