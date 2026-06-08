/**
 * @borjie/document-studio — e-signature PORT (interface only).
 *
 * NO VENDOR LOCK. This is a transport-agnostic contract every e-sign
 * provider (Dropbox Sign / HelloSign, DocuSign, Adobe Sign, a national
 * EUDI-wallet QES endpoint) can satisfy. The studio depends only on this
 * port; the concrete adapter is injected at the composition root behind
 * its own config so swapping providers is a one-line wiring change and
 * never a code change here.
 *
 * Jurisdiction note (CLAUDE.md): Tanzania (launch) is NOT an eIDAS
 * jurisdiction. The signature `tier` defaults to SES and escalates to
 * AES/QES only where the counterparty jurisdiction requires it. The tier
 * is chosen PER-REQUEST by the caller — never hard-coded here.
 */

import { z } from 'zod';

/**
 * eIDAS-style assurance tiers (also meaningful outside the EU as a
 * relative strength ordering):
 *   - `ses` Simple Electronic Signature (default; TZ launch).
 *   - `aes` Advanced Electronic Signature.
 *   - `qes` Qualified Electronic Signature (hardware/EUDI-wallet backed).
 */
export const SIGNATURE_TIERS = ['ses', 'aes', 'qes'] as const;
export type SignatureTier = (typeof SIGNATURE_TIERS)[number];

export const SignerSchema = z.object({
  /** Stable signer id within the request (e.g. `buyer`, `producer`). */
  role: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  /** Signing order; lower signs first. Same order ⇒ parallel. */
  order: z.number().int().nonnegative().default(0),
});
export type Signer = z.infer<typeof SignerSchema>;

export const ESignRequestSchema = z.object({
  /** Tenant the envelope belongs to — threaded into the audit linkage. */
  tenantId: z.string().min(1),
  /** Human title shown to signers. */
  title: z.string().min(1),
  /** Subject/message body shown to signers. */
  message: z.string().default(''),
  /** The exact rendered bytes to be signed (the archived artifact). */
  document: z.object({
    fileName: z.string().min(1),
    mimeType: z.string().min(1),
    bytes: z.instanceof(Uint8Array),
    /** sha256 of `bytes` — the adapter MUST bind the signature to this. */
    sha256: z.string().min(1),
  }),
  signers: z.array(SignerSchema).min(1),
  /** Assurance tier required for THIS request (per jurisdiction). */
  tier: z.enum(SIGNATURE_TIERS).default('ses'),
  /** Optional idempotency key — at-least-once safe re-submits. */
  idempotencyKey: z.string().optional(),
});
export type ESignRequest = z.infer<typeof ESignRequestSchema>;

export const ENVELOPE_STATES = [
  'created',
  'sent',
  'partially_signed',
  'completed',
  'declined',
  'voided',
  'errored',
] as const;
export type EnvelopeState = (typeof ENVELOPE_STATES)[number];

export interface ESignEnvelope {
  /** Provider-assigned envelope id. */
  readonly envelopeId: string;
  readonly state: EnvelopeState;
  /** Provider name (e.g. `dropbox-sign`, `mock`) — for the audit trail. */
  readonly provider: string;
  /** Tier actually applied. */
  readonly tier: SignatureTier;
  /** sha256 the signature is bound to (echoes the request). */
  readonly documentSha256: string;
  /** Per-signer status snapshot. */
  readonly signers: ReadonlyArray<{
    readonly role: string;
    readonly email: string;
    readonly signed: boolean;
    readonly signedAtIso?: string;
  }>;
  /** Set once `state === 'completed'`. */
  readonly completedAtIso?: string;
}

/**
 * The signed artifact, fetched once the envelope completes. Its sha256
 * differs from the unsigned doc (the provider stamps signature blocks),
 * so the archive links BOTH hashes.
 */
export interface SignedArtifact {
  readonly envelopeId: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

/**
 * The injected e-signature port. Every method is async + side-effecting
 * against an external provider; the studio calls it ONLY behind a HITL /
 * capability gate (hard rail: send-class actions stay human-in-the-loop).
 */
export interface ESignPort {
  /** Provider identity, surfaced in the audit chain. */
  readonly provider: string;
  /** Create + send an envelope. Idempotent on `idempotencyKey`. */
  createEnvelope(request: ESignRequest): Promise<ESignEnvelope>;
  /** Poll the current envelope state. */
  getEnvelope(envelopeId: string): Promise<ESignEnvelope>;
  /** Download the signed artifact; rejects unless the envelope completed. */
  downloadSigned(envelopeId: string): Promise<SignedArtifact>;
  /** Void an in-flight envelope (e.g. on supersede). */
  voidEnvelope(envelopeId: string, reason: string): Promise<ESignEnvelope>;
}
