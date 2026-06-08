/**
 * @borjie/document-studio — Dropbox-Sign-style e-signature adapter.
 *
 * A thin, SDK-free adapter that satisfies `ESignPort` against a
 * Dropbox-Sign-style REST API. NO VENDOR LOCK: the wire shape modelled
 * here (signature requests, signature ids, file download) is the common
 * denominator of Dropbox Sign / HelloSign — but the studio only ever
 * sees `ESignPort`, so a different provider is a different adapter file.
 *
 * SECRETS (hard rail): the API key is INJECTED via `config`, never read
 * from `process.env` inside this package. The composition root reads the
 * key at bootstrap and passes it in. A missing key throws at construction
 * so misconfiguration fails fast, not at first signature.
 *
 * Vendor ref: https://sign.dropbox.com/products/dropbox-sign-api
 */

import type {
  ESignEnvelope,
  ESignPort,
  ESignRequest,
  EnvelopeState,
  SignedArtifact,
} from './port.js';
import { ESignRequestSchema } from './port.js';

export interface DropboxSignConfig {
  /** API key — injected, never read from env here. */
  readonly apiKey: string;
  /** Base URL. Default: `https://api.hellosign.com/v3`. */
  readonly baseUrl?: string;
  /** Optional test-mode flag (no legally-binding signature, no charge). */
  readonly testMode?: boolean;
  /** Per-request timeout (ms). Default: 30000. */
  readonly timeoutMs?: number;
  /** Injection seam — defaults to global `fetch`. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://api.hellosign.com/v3';
const DEFAULT_TIMEOUT_MS = 30_000;

/** Map a provider status string → our `EnvelopeState` (provider-agnostic). */
function mapState(raw: string): EnvelopeState {
  switch (raw) {
    case 'signed':
    case 'complete':
    case 'completed':
      return 'completed';
    case 'awaiting_signature':
    case 'sent':
      return 'sent';
    case 'on_hold':
    case 'partially_signed':
      return 'partially_signed';
    case 'declined':
      return 'declined';
    case 'canceled':
    case 'voided':
      return 'voided';
    case 'error':
      return 'errored';
    default:
      return 'created';
  }
}

interface ProviderSignatureRequest {
  readonly signature_request_id: string;
  readonly is_complete?: boolean;
  readonly is_declined?: boolean;
  readonly status_code?: string;
  readonly signatures?: ReadonlyArray<{
    readonly signer_role?: string;
    readonly signer_email_address: string;
    readonly status_code?: string;
    readonly signed_at?: number | null;
  }>;
}

/**
 * Construct a Dropbox-Sign-style adapter. Throws when `apiKey` is blank.
 */
export function createDropboxSignAdapter(
  config: DropboxSignConfig,
): ESignPort {
  if (typeof config.apiKey !== 'string' || config.apiKey.trim().length === 0) {
    throw new Error(
      'dropbox-sign-adapter: `apiKey` is required (inject at bootstrap; ' +
        'never read process.env inside this package).',
    );
  }
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = config.fetchImpl ?? fetch;
  // Dropbox Sign uses HTTP Basic with the API key as the username.
  const authHeader = `Basic ${Buffer.from(`${config.apiKey}:`).toString('base64')}`;

  async function call<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: authHeader },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `dropbox-sign: ${init.method ?? 'GET'} ${path} → ${response.status} ${response.statusText}`,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  function toEnvelope(
    pr: ProviderSignatureRequest,
    request: ESignRequest | undefined,
    documentSha256: string,
  ): ESignEnvelope {
    const state: EnvelopeState = pr.is_declined
      ? 'declined'
      : pr.is_complete
        ? 'completed'
        : mapState(pr.status_code ?? 'sent');
    const signers = (pr.signatures ?? []).map((s) => {
      const signed = (s.status_code ?? '') === 'signed' || s.signed_at != null;
      return {
        role: s.signer_role ?? s.signer_email_address,
        email: s.signer_email_address,
        signed,
        ...(s.signed_at != null
          ? { signedAtIso: new Date(s.signed_at * 1000).toISOString() }
          : {}),
      };
    });
    return {
      envelopeId: pr.signature_request_id,
      state,
      provider: 'dropbox-sign',
      tier: request?.tier ?? 'ses',
      documentSha256,
      signers,
      ...(state === 'completed'
        ? { completedAtIso: new Date().toISOString() }
        : {}),
    };
  }

  return {
    provider: 'dropbox-sign',

    async createEnvelope(rawRequest) {
      const request = ESignRequestSchema.parse(rawRequest);
      const form = new FormData();
      form.append('title', request.title);
      form.append('subject', request.title);
      if (request.message.length > 0) form.append('message', request.message);
      if (config.testMode) form.append('test_mode', '1');
      request.signers.forEach((signer, i) => {
        form.append(`signers[${i}][name]`, signer.name);
        form.append(`signers[${i}][email_address]`, signer.email);
        form.append(`signers[${i}][order]`, String(signer.order));
      });
      form.append(
        'file[0]',
        new Blob([request.document.bytes as BlobPart], {
          type: request.document.mimeType,
        }),
        request.document.fileName,
      );
      const init: RequestInit = { method: 'POST', body: form };
      if (request.idempotencyKey !== undefined) {
        init.headers = { 'idempotency-key': request.idempotencyKey };
      }
      const result = await call<{ signature_request: ProviderSignatureRequest }>(
        '/signature_request/send',
        init,
      );
      return toEnvelope(
        result.signature_request,
        request,
        request.document.sha256,
      );
    },

    async getEnvelope(envelopeId) {
      const result = await call<{ signature_request: ProviderSignatureRequest }>(
        `/signature_request/${encodeURIComponent(envelopeId)}`,
        { method: 'GET' },
      );
      // sha256 is re-derived by the caller from the stored artifact; the
      // poll path does not re-transmit it, so we surface an empty marker.
      return toEnvelope(result.signature_request, undefined, '');
    },

    async downloadSigned(envelopeId) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(
          `${baseUrl}/signature_request/files/${encodeURIComponent(envelopeId)}?file_type=pdf`,
          {
            method: 'GET',
            headers: { authorization: authHeader, accept: 'application/pdf' },
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          throw new Error(
            `dropbox-sign: download ${envelopeId} → ${response.status} ${response.statusText}`,
          );
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        const { createHash } = await import('node:crypto');
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        return {
          envelopeId,
          fileName: `${envelopeId}.pdf`,
          mimeType: 'application/pdf',
          bytes,
          sha256,
        } satisfies SignedArtifact;
      } finally {
        clearTimeout(timer);
      }
    },

    async voidEnvelope(envelopeId, reason) {
      const form = new FormData();
      form.append('message', reason);
      await call<unknown>(
        `/signature_request/cancel/${encodeURIComponent(envelopeId)}`,
        { method: 'POST', body: form },
      );
      return {
        envelopeId,
        state: 'voided',
        provider: 'dropbox-sign',
        tier: 'ses',
        documentSha256: '',
        signers: [],
      };
    },
  };
}
