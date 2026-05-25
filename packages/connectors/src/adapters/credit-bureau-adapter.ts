/**
 * Credit-bureau adapter — illustrative wrapper around the base-connector.
 * Shows the same composition pattern as the M-Pesa adapter applied to a
 * different domain (tenant credit scoring).
 *
 * Stub URL — does NOT call any real bureau. Production wires the real
 * Creditinfo / TransUnion / Compuscan endpoint.
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

export const FetchScoreInputSchema = z.object({
  nationalId: z.string().min(4).max(64),
});

export type FetchScoreInput = z.infer<typeof FetchScoreInputSchema>;

export const CreditScoreReportSchema = z.object({
  nationalId: z.string(),
  score: z.number().int().min(0).max(1000),
  band: z.enum(['poor', 'fair', 'good', 'excellent']),
  asOf: z.string(),
  bureau: z.string(),
  delinquencies: z.number().int().min(0),
});

export type CreditScoreReport = z.infer<typeof CreditScoreReportSchema>;

export interface CreditBureauAdapterDeps {
  readonly bureauId?: string;
  readonly baseUrl?: string;
  readonly auth?: ConnectorAuth;
  readonly fetch?: typeof fetch;
  readonly events?: ConnectorEventSink;
  readonly audit?: AuditSink;
  readonly clock?: () => number;
}

export interface CreditBureauAdapter {
  readonly connector: BaseConnector;
  fetchScore(args: FetchScoreInput): Promise<ConnectorOutcome<CreditScoreReport>>;
}

export function createCreditBureauAdapter(deps: CreditBureauAdapterDeps = {}): CreditBureauAdapter {
  const connector = createBaseConnector({
    config: {
      id: deps.bureauId ?? 'credit-bureau',
      displayName: 'Credit Bureau',
      baseUrl: deps.baseUrl ?? 'https://stub.credit-bureau.local',
      ...(deps.auth ? { auth: deps.auth } : {}),
      rateLimit: { rpm: 120, burst: 12 },
      circuitBreaker: { errorThreshold: 3, halfOpenAfterMs: 60_000 },
      retry: { maxAttempts: 2, initialDelayMs: 500 },
      timeoutMs: 12_000,
    },
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });

  async function fetchScore(args: FetchScoreInput): Promise<ConnectorOutcome<CreditScoreReport>> {
    return connector.call<FetchScoreInput, CreditScoreReport>({
      path: '/v1/score',
      method: 'POST',
      body: args,
      inputSchema: FetchScoreInputSchema,
      outputSchema: CreditScoreReportSchema,
    });
  }

  return { connector, fetchScore };
}
