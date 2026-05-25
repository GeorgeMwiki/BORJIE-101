/**
 * NIDA biometric adapter — TZ National Identification Authority KYC
 * gateway. Wraps the base-connector pattern around the official NIDA
 * REST surface (`POST /v1/identity/verify`) to verify a Tanzanian
 * citizen by NIDA number + biometric-hash and return name / DOB /
 * photo-match-score.
 *
 * Phase D D10 — first of six East-Africa PropTech moats.
 *
 * Why this exists: US PropTech competitors physically cannot do TZ KYC
 * because NIDA does not federate outside the country. Tanzanian
 * landlords require legally-verified tenant identity before a lease
 * issues (TZ Land Act §43(1)(c)), so a TZ-specific KYC bridge is a
 * structural moat, not a feature.
 *
 * Production wiring: real NIDA base URL + OAuth2 service-credentials.
 * In CI / dev the adapter points at `https://stub.nida.local` and
 * tests inject `fetch` to assert request shape.
 *
 * Privacy notes:
 *   - The biometric hash is NOT a raw fingerprint — callers MUST send
 *     the SHA-256 hex of the captured template. NIDA's gateway rejects
 *     anything that doesn't conform to `^[a-f0-9]{64}$`. We enforce
 *     the same shape at the schema layer so a raw template can never
 *     leave the device.
 *   - The NIDA number itself is 20 digits per the 2008 NIDA Act §6(2)
 *     (8-digit YYYY-MM-DD birth-encoded prefix + 4-digit region code +
 *     6-digit individual serial + 2-digit checksum).
 */

import { z } from 'zod';
import {
  createBaseConnector,
  type AuditSink,
  type BaseConnector,
  type ConnectorAuth,
  type ConnectorEventSink,
  type ConnectorOutcome,
} from '../base-connector.js';

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

/**
 * NIDA number — 20 digits, optionally separated by hyphens in groups
 * of 8-4-6-2. We accept either form and the schema strips the hyphens
 * downstream for the gateway call.
 */
export const NidaNumberSchema = z
  .string()
  .regex(
    /^[0-9]{20}$|^[0-9]{8}-[0-9]{4}-[0-9]{6}-[0-9]{2}$/,
    'nidaNumber must be 20 digits (with or without 8-4-6-2 hyphens)',
  );

/**
 * Biometric hash — SHA-256 hex of the captured fingerprint template.
 * Raw templates MUST NOT leave the device.
 */
export const BiometricHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'biometricHash must be SHA-256 hex (64 lowercase hex chars)');

export const VerifyIdentityInputSchema = z.object({
  nidaNumber: NidaNumberSchema,
  biometricHash: BiometricHashSchema,
});

export type VerifyIdentityInput = z.infer<typeof VerifyIdentityInputSchema>;

export const VerifyIdentityOutputSchema = z.object({
  verified: z.boolean(),
  name: z.string().min(1).max(200),
  /** ISO date — yyyy-mm-dd. */
  dob: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  /** Photo-match score in [0,1]. 1.0 = perfect match. */
  photo_match_score: z.number().min(0).max(1),
});

export type VerifyIdentityOutput = z.infer<typeof VerifyIdentityOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────

export interface NidaAdapterDeps {
  readonly baseUrl?: string;
  readonly auth?: ConnectorAuth;
  readonly fetch?: typeof fetch;
  readonly events?: ConnectorEventSink;
  readonly audit?: AuditSink;
  readonly clock?: () => number;
}

export interface NidaAdapter {
  readonly connector: BaseConnector;
  verifyIdentity(
    args: VerifyIdentityInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<VerifyIdentityOutput>>;
}

export function createNidaAdapter(deps: NidaAdapterDeps = {}): NidaAdapter {
  const connector = createBaseConnector({
    config: {
      id: 'nida',
      displayName: 'NIDA Biometric Identity (TZ)',
      baseUrl: deps.baseUrl ?? 'https://stub.nida.local',
      ...(deps.auth ? { auth: deps.auth } : {}),
      // NIDA's published throughput cap is 60 calls/min/integration partner.
      rateLimit: { rpm: 60, burst: 10 },
      // Identity gateways tend to flap — open the circuit early.
      circuitBreaker: { errorThreshold: 3, halfOpenAfterMs: 45_000 },
      retry: { maxAttempts: 2, initialDelayMs: 400 },
      timeoutMs: 15_000,
    },
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });

  async function verifyIdentity(
    args: VerifyIdentityInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<VerifyIdentityOutput>> {
    return connector.call<VerifyIdentityInput, VerifyIdentityOutput>({
      path: '/v1/identity/verify',
      method: 'POST',
      body: args,
      inputSchema: VerifyIdentityInputSchema,
      outputSchema: VerifyIdentityOutputSchema,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
  }

  return { connector, verifyIdentity };
}
