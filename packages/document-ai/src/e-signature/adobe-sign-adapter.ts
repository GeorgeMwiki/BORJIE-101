/**
 * createAdobeSignAdapter — Adobe Acrobat Sign REST v6 port.
 *
 * Reference: https://opensource.adobe.com/acrobat-sign/developer_guide/index.html
 *
 * Adobe Sign supports US ESIGN, UETA, eIDAS (SES/AES/QES), and the
 * Adobe SignCare trust framework. We map jurisdictions to the
 * `securityOptions` object on the agreement payload.
 */

import type {
  ESignaturePort,
  ESignJurisdiction,
  SignatureRequest,
  SignaturePortConfig,
  SignatureStatus,
  SignatureStatusCode,
} from '../types.js';

export interface AdobeSignAdapterConfig {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly fetcher?: typeof fetch;
}

const SUPPORTED: ReadonlyArray<ESignJurisdiction> = [
  'US_ESIGN',
  'EU_eIDAS_SES',
  'EU_eIDAS_AES',
  'EU_eIDAS_QES',
  'UK_eIDAS',
  'AfCFTA',
];

const STATUS_MAP: Readonly<Record<string, SignatureStatusCode>> = Object.freeze({
  OUT_FOR_SIGNATURE: 'pending',
  WAITING_FOR_AUTHORING: 'pending',
  WAITING_FOR_FORM_FILLING: 'pending',
  WAITING_FOR_MY_SIGNATURE: 'partially_signed',
  WAITING_FOR_OTHER_PARTICIPANTS: 'partially_signed',
  SIGNED: 'completed',
  APPROVED: 'completed',
  CANCELLED: 'declined',
  DECLINED: 'declined',
  EXPIRED: 'expired',
});

export function createAdobeSignAdapter(config: AdobeSignAdapterConfig): ESignaturePort {
  const baseUrl = config.baseUrl ?? 'https://api.na1.adobesign.com/api/rest/v6';
  return {
    id: 'adobe-sign',
    supportedJurisdictions: SUPPORTED,
    async requestSignature(input: SignaturePortConfig): Promise<SignatureRequest> {
      const fetcher = config.fetcher ?? (typeof fetch !== 'undefined' ? fetch : null);
      if (!fetcher) throw new Error('adobe-sign: fetch is not available');

      // Step 1: upload the transient document.
      const uploadForm = new FormData();
      uploadForm.append(
        'File',
        new Blob([new Uint8Array(input.doc.bytes)], { type: input.doc.mime }),
        `${input.doc.id}.pdf`
      );
      uploadForm.append('Mime-Type', input.doc.mime);
      uploadForm.append('File-Name', `${input.doc.id}.pdf`);
      const upload = await fetcher(`${baseUrl}/transientDocuments`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: uploadForm,
      });
      if (!upload.ok) throw new Error(`adobe-sign: upload HTTP ${upload.status}`);
      const uploadJson = (await upload.json()) as { transientDocumentId: string };

      // Step 2: create the agreement.
      const agreement = {
        fileInfos: [{ transientDocumentId: uploadJson.transientDocumentId }],
        name: input.subject ?? 'Signature Request',
        message: input.message ?? '',
        participantSetsInfo: input.signers.map((s, idx) => ({
          memberInfos: [{ email: s.email, name: s.name }],
          order: s.order + 1,
          role: idx === 0 ? 'SIGNER' : 'SIGNER',
        })),
        signatureType: signatureTypeFor(input.jurisdiction),
        state: 'IN_PROCESS',
        expirationTime: input.expiresAt.toISOString(),
      };
      const create = await fetcher(`${baseUrl}/agreements`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(agreement),
      });
      if (!create.ok) throw new Error(`adobe-sign: create HTTP ${create.status}`);
      const createJson = (await create.json()) as { id: string };

      return {
        requestId: createJson.id,
        docId: input.doc.id,
        signers: input.signers,
        jurisdiction: input.jurisdiction,
        expiresAt: input.expiresAt,
        providerRef: createJson.id,
        createdAt: new Date(),
      };
    },
    async pollStatus(requestId: string): Promise<SignatureStatus> {
      const fetcher = config.fetcher ?? (typeof fetch !== 'undefined' ? fetch : null);
      if (!fetcher) throw new Error('adobe-sign: fetch is not available');
      const response = await fetcher(`${baseUrl}/agreements/${requestId}`, {
        headers: { authorization: `Bearer ${config.apiKey}` },
      });
      if (!response.ok) return errorStatus(requestId);
      const json = (await response.json()) as {
        status: keyof typeof STATUS_MAP;
        participantSetsInfo?: ReadonlyArray<{
          memberInfos: ReadonlyArray<{ email: string; status: string }>;
        }>;
      };
      const status = STATUS_MAP[json.status] ?? 'pending';
      const allMembers = (json.participantSetsInfo ?? []).flatMap((p) => p.memberInfos);
      const signedBy = allMembers.filter((m) => m.status === 'SIGNED').map((m) => m.email);
      const declinedBy = allMembers
        .filter((m) => m.status === 'DECLINED' || m.status === 'CANCELLED')
        .map((m) => m.email);
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
      if (!fetcher) throw new Error('adobe-sign: fetch is not available');
      const response = await fetcher(`${baseUrl}/agreements/${requestId}/combinedDocument`, {
        headers: { authorization: `Bearer ${config.apiKey}` },
      });
      if (!response.ok) return new Uint8Array(0);
      const buf = await response.arrayBuffer();
      return new Uint8Array(buf);
    },
  };
}

function signatureTypeFor(j: ESignJurisdiction): 'ESIGN' | 'WRITTEN' | 'AES' | 'QES' {
  switch (j) {
    case 'EU_eIDAS_QES':
      return 'QES';
    case 'EU_eIDAS_AES':
    case 'UK_eIDAS':
      return 'AES';
    default:
      return 'ESIGN';
  }
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
