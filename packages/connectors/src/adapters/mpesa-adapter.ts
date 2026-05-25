/**
 * M-Pesa adapter — illustrative wrapper around the base-connector.
 * Shows how a domain-specific connector inherits rate-limit / circuit-breaker
 * / retry / audit / event-bus discipline by composition.
 *
 * Stub URL — does NOT actually call M-Pesa. Production wires the real
 * Daraja URL + bearer token provider.
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

export const InitiatePaymentInputSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.literal('TZS').or(z.literal('KES')),
  msisdn: z.string().regex(/^\+?[0-9]{10,15}$/),
  reference: z.string().min(1).max(64),
  callbackUrl: z.string().url(),
});

export type InitiatePaymentInput = z.infer<typeof InitiatePaymentInputSchema>;

export const InitiatePaymentOutputSchema = z.object({
  transactionId: z.string(),
  status: z.enum(['pending', 'accepted', 'failed']),
  receiptNumber: z.string().optional(),
});

export type InitiatePaymentOutput = z.infer<typeof InitiatePaymentOutputSchema>;

export interface MpesaAdapterDeps {
  readonly baseUrl?: string;
  readonly auth?: ConnectorAuth;
  readonly fetch?: typeof fetch;
  readonly events?: ConnectorEventSink;
  readonly audit?: AuditSink;
  readonly clock?: () => number;
}

export interface MpesaAdapter {
  readonly connector: BaseConnector;
  initiatePayment(args: InitiatePaymentInput, idempotencyKey?: string): Promise<ConnectorOutcome<InitiatePaymentOutput>>;
}

export function createMpesaAdapter(deps: MpesaAdapterDeps = {}): MpesaAdapter {
  const connector = createBaseConnector({
    config: {
      id: 'mpesa',
      displayName: 'M-Pesa (Daraja)',
      baseUrl: deps.baseUrl ?? 'https://stub.mpesa.local',
      ...(deps.auth ? { auth: deps.auth } : {}),
      rateLimit: { rpm: 600, burst: 60 },
      circuitBreaker: { errorThreshold: 5, halfOpenAfterMs: 30_000 },
      retry: { maxAttempts: 3, initialDelayMs: 250 },
      timeoutMs: 8_000,
    },
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });

  async function initiatePayment(
    args: InitiatePaymentInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<InitiatePaymentOutput>> {
    return connector.call<InitiatePaymentInput, InitiatePaymentOutput>({
      path: '/payments/initiate',
      method: 'POST',
      body: args,
      inputSchema: InitiatePaymentInputSchema,
      outputSchema: InitiatePaymentOutputSchema,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
  }

  return { connector, initiatePayment };
}
