/**
 * GePG real adapter — Tanzania's Government e-Payment Gateway.
 *
 * GePG is the TZ Ministry of Finance's central billing rail. Every TZ
 * statutory levy, council rate, and licence fee a property manager
 * collects is settled through a GePG **control number** (CN). The
 * sequence is: (a) we POST a bill request, (b) GePG returns a control
 * number, (c) the payer settles at any GePG-affiliated bank/MNO, (d)
 * we poll for settlement OR receive the GePG callback, (e) reconcile
 * the day's CNs against the GePG daily report.
 *
 * GePG historically uses XML-over-HTTPS with detached XMLDSig
 * signatures. The 2024 GePG-v3.5 spec adds a JSON-over-HTTPS surface
 * for partners that opt in; we default to JSON which composes cleanly
 * with the base-connector discipline. The XML serializer
 * {@link toGepgBillXml} is exported so callers that must use the
 * legacy XML rail can sign + transport it through their own
 * connector composition.
 *
 * Endpoints covered:
 *   - `POST /api/control-numbers/generate`  — request a CN for a bill.
 *   - `GET  /api/control-numbers/{id}/status` — inquire CN settlement.
 *   - `POST /api/reconciliation/daily`       — daily settlement reconciliation.
 *   - `POST /api/control-numbers/{id}/cancel` — cancel CN before settlement.
 *
 * Sandbox vs production env: `GEPG_ENV=sandbox|production` toggles
 * default base URL (`https://gepg-sandbox.go.tz` vs `https://gepg.go.tz`).
 *
 * NOTE: This adapter does NOT compute XMLDSig signatures. The caller
 * is expected to pass `signXmlPayload(xml) => Promise<string>` from the
 * @borjie/enterprise-hardening signing facility. If signing is
 * absent we emit the XML unsigned — production GePG rejects unsigned
 * payloads, sandbox tolerates them.
 */

import { z } from 'zod';
import {
  createBaseConnector,
  type AuditSink,
  type BaseConnector,
  type ConnectorEventSink,
  type ConnectorOutcome,
} from '../base-connector.js';

export type GepgEnv = 'sandbox' | 'production';
/**
 * Transport format. The base-connector serializes JSON, so production
 * wiring through `createGepgRealAdapter` always uses 'json'. 'xml' is
 * exposed for `toGepgBillXml` consumers but the adapter currently
 * routes through the JSON rail.
 */
export type GepgFormat = 'xml' | 'json';

// CRITICAL #6 — Tanzania government top-level domain is `.go.tz` (e.g.
// kra.go.tz, tra.go.tz, gepg.go.tz). The previous `tz.go` was a typo
// and DNS resolution failed on every call. Official GePG production
// host: https://gepg.go.tz; sandbox: https://gepg-sandbox.go.tz.
const BASE_URLS: Readonly<Record<GepgEnv, string>> = Object.freeze({
  sandbox: 'https://gepg-sandbox.go.tz',
  production: 'https://gepg.go.tz',
});

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

export const GenerateControlNumberInputSchema = z.object({
  /** Caller-side bill reference (idempotency key). */
  billRef: z.string().min(1).max(64),
  payerName: z.string().min(1).max(120),
  /** TZ MSISDN or NIDA — used by GePG only for callback routing. */
  payerContact: z.string().min(1).max(64),
  /** Bill amount in TZS minor (cents). GePG works in major TZS; we / 100. */
  amountCents: z.number().int().positive(),
  /** SP code — assigned by GePG to each MDA/SP onboarding. */
  spCode: z.string().min(1).max(24),
  /** Service / bill code per the GePG service catalogue. */
  serviceCode: z.string().min(1).max(24),
  description: z.string().min(1).max(255),
  /** Bill expiry — ISO date. */
  expiresAt: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
});
export type GenerateControlNumberInput = z.infer<typeof GenerateControlNumberInputSchema>;

export const GenerateControlNumberOutputSchema = z.object({
  controlNumber: z.string().min(8).max(20),
  billRef: z.string(),
  status: z.enum(['issued', 'pending']),
  issuedAt: z.string(),
});
export type GenerateControlNumberOutput = z.infer<typeof GenerateControlNumberOutputSchema>;

export const InquireStatusInputSchema = z.object({
  controlNumber: z.string().min(8).max(20),
});
export type InquireStatusInput = z.infer<typeof InquireStatusInputSchema>;

export const ControlNumberStatusSchema = z.enum([
  'issued',
  'pending',
  'paid',
  'cancelled',
  'expired',
  'reversed',
]);
export type ControlNumberStatus = z.infer<typeof ControlNumberStatusSchema>;

export const InquireStatusOutputSchema = z.object({
  controlNumber: z.string(),
  status: ControlNumberStatusSchema,
  paidAt: z.string().optional(),
  amountTzs: z.number().int().nonnegative().optional(),
  payerChannel: z.string().optional(),
});
export type InquireStatusOutput = z.infer<typeof InquireStatusOutputSchema>;

export const CancelInputSchema = z.object({
  controlNumber: z.string().min(8).max(20),
  reason: z.string().min(1).max(255),
});
export type CancelInput = z.infer<typeof CancelInputSchema>;

export const CancelOutputSchema = z.object({
  controlNumber: z.string(),
  cancelled: z.boolean(),
  cancelledAt: z.string().optional(),
});
export type CancelOutput = z.infer<typeof CancelOutputSchema>;

export const DailyReconciliationInputSchema = z.object({
  /** `YYYY-MM-DD` — settlement business-day. */
  businessDay: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  spCode: z.string().min(1).max(24),
});
export type DailyReconciliationInput = z.infer<typeof DailyReconciliationInputSchema>;

export const ReconciliationEntrySchema = z.object({
  controlNumber: z.string(),
  amountTzs: z.number().int().nonnegative(),
  paidAt: z.string(),
  channel: z.string(),
});
export type ReconciliationEntry = z.infer<typeof ReconciliationEntrySchema>;

export const DailyReconciliationOutputSchema = z.object({
  businessDay: z.string(),
  spCode: z.string(),
  totalAmountTzs: z.number().int().nonnegative(),
  entries: z.array(ReconciliationEntrySchema),
});
export type DailyReconciliationOutput = z.infer<typeof DailyReconciliationOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────

export interface GepgCredentials {
  readonly spCode: string;
  readonly apiKey: string;
  /** Optional XMLDSig signer for XML transport. */
  readonly signXmlPayload?: (xml: string) => Promise<string>;
}

export interface GepgRealAdapterDeps {
  readonly env?: GepgEnv;
  readonly baseUrl?: string;
  readonly format?: GepgFormat;
  readonly credentials: GepgCredentials;
  readonly fetch?: typeof fetch;
  readonly events?: ConnectorEventSink;
  readonly audit?: AuditSink;
  readonly clock?: () => number;
}

export interface GepgRealAdapter {
  readonly connector: BaseConnector;
  readonly env: GepgEnv;
  readonly format: GepgFormat;
  generateControlNumber(
    args: GenerateControlNumberInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<GenerateControlNumberOutput>>;
  inquireStatus(args: InquireStatusInput): Promise<ConnectorOutcome<InquireStatusOutput>>;
  cancelControlNumber(
    args: CancelInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<CancelOutput>>;
  dailyReconciliation(
    args: DailyReconciliationInput,
  ): Promise<ConnectorOutcome<DailyReconciliationOutput>>;
}

// ─────────────────────────────────────────────────────────────────────
// XML serializer (minimal — GePG accepts the small subset we emit)
// ─────────────────────────────────────────────────────────────────────

function escapeXml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build a minimal GePG bill XML envelope for the legacy XMLDSig rail.
 * Callers that opt into XML transport sign + POST this themselves;
 * the JSON rail (default in `createGepgRealAdapter`) does not use it.
 */
export function toGepgBillXml(input: GenerateControlNumberInput, spCode: string): string {
  const amountTzs = Math.round(input.amountCents / 100);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Bill>` +
    `<SpCode>${escapeXml(spCode)}</SpCode>` +
    `<BillRef>${escapeXml(input.billRef)}</BillRef>` +
    `<ServiceCode>${escapeXml(input.serviceCode)}</ServiceCode>` +
    `<PayerName>${escapeXml(input.payerName)}</PayerName>` +
    `<PayerContact>${escapeXml(input.payerContact)}</PayerContact>` +
    `<AmountTzs>${escapeXml(amountTzs)}</AmountTzs>` +
    `<Description>${escapeXml(input.description)}</Description>` +
    `<ExpiresAt>${escapeXml(input.expiresAt)}</ExpiresAt>` +
    `</Bill>`
  );
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createGepgRealAdapter(deps: GepgRealAdapterDeps): GepgRealAdapter {
  const env: GepgEnv = deps.env ?? 'sandbox';
  const format: GepgFormat = deps.format ?? 'xml';
  const baseUrl = deps.baseUrl ?? BASE_URLS[env];
  const credentials = deps.credentials;
  const fetchImpl = deps.fetch ?? globalThis.fetch;

  if (!fetchImpl) throw new Error('createGepgRealAdapter: no fetch implementation');
  if (!credentials.apiKey || !credentials.spCode) {
    throw new Error('createGepgRealAdapter: apiKey + spCode required');
  }

  const connector = createBaseConnector({
    config: {
      id: 'gepg-real',
      displayName: `GePG (${env}, ${format})`,
      baseUrl,
      auth: { kind: 'api-key', headerName: 'x-gepg-api-key', key: credentials.apiKey },
      rateLimit: { rpm: 300, burst: 30 },
      circuitBreaker: { errorThreshold: 5, halfOpenAfterMs: 30_000 },
      retry: { maxAttempts: 3, initialDelayMs: 400 },
      timeoutMs: 15_000,
    },
    fetch: fetchImpl,
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });

  // ─────────────────────────────────────────────────────────────────
  // Public methods
  // ─────────────────────────────────────────────────────────────────

  async function generateControlNumber(
    args: GenerateControlNumberInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<GenerateControlNumberOutput>> {
    const parsed = GenerateControlNumberInputSchema.safeParse(args);
    if (!parsed.success) return { kind: 'validation-failed', issue: parsed.error.message };
    return connector.call<unknown, GenerateControlNumberOutput>({
      path: '/api/control-numbers/generate',
      method: 'POST',
      body: { ...parsed.data, spCode: credentials.spCode },
      outputSchema: GenerateControlNumberOutputSchema,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
  }

  async function inquireStatus(
    args: InquireStatusInput,
  ): Promise<ConnectorOutcome<InquireStatusOutput>> {
    const parsed = InquireStatusInputSchema.safeParse(args);
    if (!parsed.success) return { kind: 'validation-failed', issue: parsed.error.message };
    return connector.call<undefined, InquireStatusOutput>({
      path: `/api/control-numbers/${encodeURIComponent(parsed.data.controlNumber)}/status`,
      method: 'GET',
      outputSchema: InquireStatusOutputSchema,
    });
  }

  async function cancelControlNumber(
    args: CancelInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<CancelOutput>> {
    const parsed = CancelInputSchema.safeParse(args);
    if (!parsed.success) return { kind: 'validation-failed', issue: parsed.error.message };
    return connector.call<unknown, CancelOutput>({
      path: `/api/control-numbers/${encodeURIComponent(parsed.data.controlNumber)}/cancel`,
      method: 'POST',
      body: { reason: parsed.data.reason, spCode: credentials.spCode },
      outputSchema: CancelOutputSchema,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
  }

  async function dailyReconciliation(
    args: DailyReconciliationInput,
  ): Promise<ConnectorOutcome<DailyReconciliationOutput>> {
    const parsed = DailyReconciliationInputSchema.safeParse(args);
    if (!parsed.success) return { kind: 'validation-failed', issue: parsed.error.message };
    return connector.call<unknown, DailyReconciliationOutput>({
      path: '/api/reconciliation/daily',
      method: 'POST',
      body: parsed.data,
      outputSchema: DailyReconciliationOutputSchema,
    });
  }

  return {
    connector,
    env,
    format,
    generateControlNumber,
    inquireStatus,
    cancelControlNumber,
    dailyReconciliation,
  };
}

/**
 * Minimal XML tag extractor — exported for callers that ride the
 * legacy XML rail and parse responses out-of-band.
 */
export function extractXmlTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<]+)</${tag}>`);
  const m = xml.match(re);
  return m && m[1] ? m[1] : null;
}
