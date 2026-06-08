/**
 * @borjie/document-studio — in-memory mock e-signature adapter.
 *
 * Deterministic, no-network `ESignPort` for dev + tests. It models the
 * full envelope lifecycle (create → poll → auto-complete → download)
 * without any provider, so the pipeline's e-sign contract is testable
 * offline. Production wires `createDropboxSignAdapter` (or any other real
 * port impl) instead.
 *
 * Behaviour:
 *   - `createEnvelope` returns a `sent` envelope; `idempotencyKey`
 *     re-submits return the SAME envelope (at-least-once safe).
 *   - `getEnvelope` advances the envelope to `completed` after
 *     `completeAfterPolls` polls (default 1) so tests can drive the
 *     poll→download flow without sleeping.
 *   - `downloadSigned` stamps a deterministic `[SIGNED:<tier>]` marker
 *     onto the original bytes and re-hashes — proving the signed sha256
 *     differs from the unsigned one (the archive links both).
 */

import { createHash } from 'node:crypto';
import type {
  ESignEnvelope,
  ESignPort,
  ESignRequest,
  SignedArtifact,
} from './port.js';
import { ESignRequestSchema } from './port.js';

interface StoredEnvelope {
  envelope: ESignEnvelope;
  originalBytes: Uint8Array;
  fileName: string;
  polls: number;
}

export interface MockESignOptions {
  /** How many `getEnvelope` polls before auto-completing. Default 1. */
  readonly completeAfterPolls?: number;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createMockESignAdapter(
  options: MockESignOptions = {},
): ESignPort {
  const completeAfter = options.completeAfterPolls ?? 1;
  const byId = new Map<string, StoredEnvelope>();
  const byIdempotency = new Map<string, string>();
  let counter = 0;

  function snapshot(stored: StoredEnvelope): ESignEnvelope {
    return stored.envelope;
  }

  return {
    provider: 'mock',

    async createEnvelope(rawRequest): Promise<ESignEnvelope> {
      const request: ESignRequest = ESignRequestSchema.parse(rawRequest);
      if (request.idempotencyKey) {
        const existing = byIdempotency.get(request.idempotencyKey);
        if (existing) return snapshot(byId.get(existing)!);
      }
      counter += 1;
      const envelopeId = `mock-env-${counter}`;
      const envelope: ESignEnvelope = {
        envelopeId,
        state: 'sent',
        provider: 'mock',
        tier: request.tier,
        documentSha256: request.document.sha256,
        signers: request.signers.map((s) => ({
          role: s.role,
          email: s.email,
          signed: false,
        })),
      };
      byId.set(envelopeId, {
        envelope,
        originalBytes: request.document.bytes,
        fileName: request.document.fileName,
        polls: 0,
      });
      if (request.idempotencyKey) {
        byIdempotency.set(request.idempotencyKey, envelopeId);
      }
      return envelope;
    },

    async getEnvelope(envelopeId): Promise<ESignEnvelope> {
      const stored = byId.get(envelopeId);
      if (!stored) {
        throw new Error(`mock-esign: unknown envelope '${envelopeId}'`);
      }
      stored.polls += 1;
      if (stored.envelope.state !== 'completed' && stored.polls >= completeAfter) {
        stored.envelope = {
          ...stored.envelope,
          state: 'completed',
          completedAtIso: new Date(0).toISOString(),
          signers: stored.envelope.signers.map((s) => ({
            ...s,
            signed: true,
            signedAtIso: new Date(0).toISOString(),
          })),
        };
      }
      return stored.envelope;
    },

    async downloadSigned(envelopeId): Promise<SignedArtifact> {
      const stored = byId.get(envelopeId);
      if (!stored) {
        throw new Error(`mock-esign: unknown envelope '${envelopeId}'`);
      }
      if (stored.envelope.state !== 'completed') {
        throw new Error(
          `mock-esign: envelope '${envelopeId}' not completed (state=${stored.envelope.state})`,
        );
      }
      const marker = new TextEncoder().encode(
        `\n[SIGNED:${stored.envelope.tier}]`,
      );
      const signed = new Uint8Array(
        stored.originalBytes.length + marker.length,
      );
      signed.set(stored.originalBytes, 0);
      signed.set(marker, stored.originalBytes.length);
      return {
        envelopeId,
        fileName: `signed-${stored.fileName}`,
        mimeType: 'application/pdf',
        bytes: signed,
        sha256: sha256(signed),
      };
    },

    async voidEnvelope(envelopeId, _reason): Promise<ESignEnvelope> {
      const stored = byId.get(envelopeId);
      if (!stored) {
        throw new Error(`mock-esign: unknown envelope '${envelopeId}'`);
      }
      stored.envelope = { ...stored.envelope, state: 'voided' };
      return stored.envelope;
    },
  };
}
