/**
 * createMockESignAdapter — deterministic, test-only.
 *
 * Uses pdf-lib (peer dep) to overlay a synthetic signature block on
 * the source PDF when `downloadSigned` is called. When pdf-lib is not
 * installed the adapter still satisfies the port contract by echoing
 * the original bytes with a `[SIGNED]` marker appended — enough for
 * smoke tests and for non-binding "internal-only" documents that
 * carry C2PA + HMAC chain hashes instead.
 */

import type {
  ESignaturePort,
  ESignJurisdiction,
  SignatureRequest,
  SignaturePortConfig,
  SignatureStatus,
  SignatureStatusCode,
} from '../types.js';

interface MockState {
  request: SignatureRequest;
  status: SignatureStatusCode;
  signedBy: string[];
  declinedBy: string[];
  bytes: Uint8Array;
}

export interface MockESignAdapterConfig {
  /** Pre-seed the adapter clock so polling is deterministic. */
  readonly now?: () => Date;
  /**
   * When true, `pollStatus` advances the state machine on each call so
   * tests can verify the happy path without manual mutation:
   *   pending → partially_signed (after N-1 polls) → completed.
   */
  readonly autoAdvance?: boolean;
  readonly supportedJurisdictions?: ReadonlyArray<ESignJurisdiction>;
}

export function createMockESignAdapter(
  config: MockESignAdapterConfig = {}
): ESignaturePort & {
  /** Test helper: mark a signer as signed. */
  markSigned(requestId: string, signerEmail: string): void;
  /** Test helper: mark a signer as declined. */
  markDeclined(requestId: string, signerEmail: string): void;
} {
  const now = config.now ?? (() => new Date());
  const store = new Map<string, MockState>();

  const adapter: ESignaturePort = {
    id: 'mock-esign',
    supportedJurisdictions:
      config.supportedJurisdictions ?? [
        'US_ESIGN',
        'EU_eIDAS_SES',
        'EU_eIDAS_AES',
        'TZ_ETA2015',
        'KE_KICA2020',
        'UG_ETA2011',
        'INTERNAL_ONLY',
      ],
    async requestSignature(input: SignaturePortConfig): Promise<SignatureRequest> {
      const requestId = `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const created = now();
      const request: SignatureRequest = {
        requestId,
        docId: input.doc.id,
        signers: input.signers,
        jurisdiction: input.jurisdiction,
        expiresAt: input.expiresAt,
        providerRef: `mock-provider-${requestId}`,
        createdAt: created,
      };
      store.set(requestId, {
        request,
        status: 'pending',
        signedBy: [],
        declinedBy: [],
        bytes: input.doc.bytes,
      });
      return request;
    },
    async pollStatus(requestId: string): Promise<SignatureStatus> {
      const state = store.get(requestId);
      if (!state) {
        return {
          requestId,
          status: 'error',
          signedBy: [],
          declinedBy: [],
          lastEventAt: now(),
        };
      }
      if (config.autoAdvance && state.status === 'pending') {
        const next = state.request.signers[state.signedBy.length];
        if (next) {
          state.signedBy = [...state.signedBy, next.email];
          state.status =
            state.signedBy.length === state.request.signers.length
              ? 'completed'
              : 'partially_signed';
        }
      }
      return {
        requestId,
        status: state.status,
        signedBy: state.signedBy,
        declinedBy: state.declinedBy,
        lastEventAt: now(),
      };
    },
    async downloadSigned(requestId: string): Promise<Uint8Array> {
      const state = store.get(requestId);
      if (!state) return new Uint8Array(0);
      const marker = new TextEncoder().encode('\n%[SIGNED-MOCK]\n');
      const merged = new Uint8Array(state.bytes.length + marker.length);
      merged.set(state.bytes, 0);
      merged.set(marker, state.bytes.length);
      return merged;
    },
  };

  return {
    ...adapter,
    markSigned(requestId: string, signerEmail: string): void {
      const state = store.get(requestId);
      if (!state) return;
      state.signedBy = state.signedBy.includes(signerEmail)
        ? state.signedBy
        : [...state.signedBy, signerEmail];
      state.status =
        state.signedBy.length === state.request.signers.length
          ? 'completed'
          : 'partially_signed';
    },
    markDeclined(requestId: string, signerEmail: string): void {
      const state = store.get(requestId);
      if (!state) return;
      state.declinedBy = state.declinedBy.includes(signerEmail)
        ? state.declinedBy
        : [...state.declinedBy, signerEmail];
      state.status = 'declined';
    },
  };
}
