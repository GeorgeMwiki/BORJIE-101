/**
 * e-Ardhi adapter — TZ Ministry of Lands "e-Ardhi" online title-search
 * gateway. Wraps the base-connector pattern around the title-search
 * endpoint (`POST /v1/title/verify`) to confirm that a title-deed
 * number is registered, fetch the current owner's name, the
 * registration date, and any encumbrances (mortgages, caveats, leasehold
 * notices) before Borjie accepts a property listing.
 *
 * Phase D D10 — second of six East-Africa PropTech moats.
 *
 * Why this matters: TZ has had multiple high-profile cases where rental
 * platforms listed properties owned by someone other than the lister.
 * Verifying the title against e-Ardhi before a unit goes live closes
 * that fraud vector. US competitors do not integrate with e-Ardhi.
 *
 * Production wiring: the real e-Ardhi base URL (`https://api.ardhi.go.tz`)
 * + the partner API-key. In tests we point at the stub URL and inject
 * fetch.
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
 * TZ title-deed number — three letters (region code), slash, four digits
 * (district code), slash, six digits (parcel serial). Example:
 * `DSM/0014/000123`.
 */
export const TitleNumberSchema = z
  .string()
  .regex(
    /^[A-Z]{3}\/[0-9]{4}\/[0-9]{6}$/,
    'titleNumber must match the e-Ardhi format AAA/0000/000000',
  );

export const VerifyTitleInputSchema = z.object({
  titleNumber: TitleNumberSchema,
});

export type VerifyTitleInput = z.infer<typeof VerifyTitleInputSchema>;

export const EncumbranceSchema = z.object({
  kind: z.enum(['mortgage', 'caveat', 'lease', 'court-order', 'other']),
  noteRef: z.string().min(1).max(120),
  registeredAt: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  /** Free-text per the Lands Act §35. */
  notes: z.string().max(500).optional(),
});

export type Encumbrance = z.infer<typeof EncumbranceSchema>;

export const VerifyTitleOutputSchema = z.object({
  valid: z.boolean(),
  owner_name: z.string().min(1).max(200),
  /** ISO date — yyyy-mm-dd. */
  registered_at: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  encumbrances: z.array(EncumbranceSchema),
});

export type VerifyTitleOutput = z.infer<typeof VerifyTitleOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────

export interface EardhiAdapterDeps {
  readonly baseUrl?: string;
  readonly auth?: ConnectorAuth;
  readonly fetch?: typeof fetch;
  readonly events?: ConnectorEventSink;
  readonly audit?: AuditSink;
  readonly clock?: () => number;
}

export interface EardhiAdapter {
  readonly connector: BaseConnector;
  verifyTitle(
    args: VerifyTitleInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<VerifyTitleOutput>>;
}

export function createEardhiAdapter(deps: EardhiAdapterDeps = {}): EardhiAdapter {
  const connector = createBaseConnector({
    config: {
      id: 'eardhi',
      displayName: 'e-Ardhi Land Services (TZ)',
      baseUrl: deps.baseUrl ?? 'https://stub.eardhi.local',
      ...(deps.auth ? { auth: deps.auth } : {}),
      // e-Ardhi published cap is 120 req/min/partner.
      rateLimit: { rpm: 120, burst: 15 },
      circuitBreaker: { errorThreshold: 4, halfOpenAfterMs: 60_000 },
      retry: { maxAttempts: 2, initialDelayMs: 500 },
      timeoutMs: 20_000,
    },
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });

  async function verifyTitle(
    args: VerifyTitleInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<VerifyTitleOutput>> {
    return connector.call<VerifyTitleInput, VerifyTitleOutput>({
      path: '/v1/title/verify',
      method: 'POST',
      body: args,
      inputSchema: VerifyTitleInputSchema,
      outputSchema: VerifyTitleOutputSchema,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
  }

  return { connector, verifyTitle };
}
