/**
 * KRA eRITS real adapter — Kenya Revenue Authority's Electronic Rental
 * Income Tax System (a.k.a. iTax — MRI returns submodule). Used by
 * Borjie's KRA MRI filing workflow to submit, poll, and cancel
 * monthly rental-income returns for property owners.
 *
 * Endpoint coverage:
 *   - `POST /erits/login` — session-token issuance (KRA's iTax bridge
 *     issues short-lived bearer sessions; we cache for `sessionTtlSec`).
 *   - `POST /erits/submitMri` — submit batch (taxpayers + owners + units).
 *   - `GET  /erits/getReceipt?submissionId=...` — poll submission status:
 *     `pending | accepted | partial | rejected`.
 *   - `POST /erits/cancelFiling` — withdraw before lockdown.
 *   - Tax-period validation pre-flight (helper; pure).
 *
 * KRA's iTax public API spec is partially undocumented in places. We
 * gate the production wiring with `KRA_API_SCHEMA_VERSION` so the
 * adapter version-checks at runtime via `/erits/version`. If the
 * upstream version differs the adapter returns `unconfigured` rather
 * than silently breaking a tenant's submission.
 *
 * Sandbox vs production: `KRA_ENV=sandbox|production` selects the
 * default base URL (`https://itax-sandbox.kra.go.ke` vs
 * `https://itax.kra.go.ke`).
 */

import { z } from 'zod';
import {
  createBaseConnector,
  type AuditSink,
  type BaseConnector,
  type ConnectorEventSink,
  type ConnectorOutcome,
} from '../base-connector.js';

export type KraEnv = 'sandbox' | 'production';

const BASE_URLS: Readonly<Record<KraEnv, string>> = Object.freeze({
  sandbox: 'https://itax-sandbox.kra.go.ke',
  production: 'https://itax.kra.go.ke',
});

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

/** Tax period — `YYYY-MM` (KRA MRI is monthly). */
export const TaxPeriodSchema = z
  .string()
  .regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, 'taxPeriod must be YYYY-MM');

/** Kenyan PIN — A or P prefix, 9 digits, terminating letter. */
export const KraPinSchema = z
  .string()
  .regex(/^[AP][0-9]{9}[A-Z]$/, 'kraPin must match KRA PIN format A123456789Z');

export const OwnerEntrySchema = z.object({
  kraPin: KraPinSchema,
  fullName: z.string().min(1).max(200),
  /** Gross rental income in KES (whole shillings). */
  grossKes: z.number().int().nonnegative(),
  /** Allowable deductions in KES. */
  deductionsKes: z.number().int().nonnegative(),
  /** Property reference (Borjie unit id, opaque to KRA). */
  propertyRef: z.string().min(1).max(64),
});
export type OwnerEntry = z.infer<typeof OwnerEntrySchema>;

export const SubmitMriInputSchema = z.object({
  taxPeriod: TaxPeriodSchema,
  /** Filing entity PIN (the property-manager or the owner themselves). */
  entityPin: KraPinSchema,
  owners: z.array(OwnerEntrySchema).min(1).max(500),
  /** Caller-supplied idempotency key — KRA dedupes by submission ref. */
  submissionRef: z.string().min(1).max(64),
});
export type SubmitMriInput = z.infer<typeof SubmitMriInputSchema>;

export const SubmitMriOutputSchema = z.object({
  submissionId: z.string().min(1),
  status: z.enum(['queued', 'pending']),
  acceptedAt: z.string().optional(),
});
export type SubmitMriOutput = z.infer<typeof SubmitMriOutputSchema>;

export const GetReceiptInputSchema = z.object({
  submissionId: z.string().min(1),
});
export type GetReceiptInput = z.infer<typeof GetReceiptInputSchema>;

export const ReceiptStatusSchema = z.enum([
  'pending',
  'accepted',
  'partial',
  'rejected',
]);
export type ReceiptStatus = z.infer<typeof ReceiptStatusSchema>;

export const RejectionDetailSchema = z.object({
  ownerKraPin: KraPinSchema,
  code: z.string(),
  message: z.string(),
});
export type RejectionDetail = z.infer<typeof RejectionDetailSchema>;

export const GetReceiptOutputSchema = z.object({
  submissionId: z.string(),
  status: ReceiptStatusSchema,
  receiptNumber: z.string().optional(),
  rejections: z.array(RejectionDetailSchema).optional(),
  finalisedAt: z.string().optional(),
});
export type GetReceiptOutput = z.infer<typeof GetReceiptOutputSchema>;

export const CancelFilingInputSchema = z.object({
  submissionId: z.string().min(1),
  reason: z.string().min(1).max(500),
});
export type CancelFilingInput = z.infer<typeof CancelFilingInputSchema>;

export const CancelFilingOutputSchema = z.object({
  submissionId: z.string(),
  cancelled: z.boolean(),
  cancelledAt: z.string().optional(),
});
export type CancelFilingOutput = z.infer<typeof CancelFilingOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Tax-period validator (pure)
// ─────────────────────────────────────────────────────────────────────

export interface PeriodValidationOk {
  readonly ok: true;
  readonly period: string;
}
export interface PeriodValidationError {
  readonly ok: false;
  readonly issue: string;
}

/**
 * KRA MRI rules: returns must be filed by the 20th of the month AFTER
 * the tax period. Submitting for the current month before it closes is
 * rejected; submitting for a period more than 12 months in the past
 * requires manual amendment workflow (we refuse and let the caller take
 * the manual path).
 */
export function validateTaxPeriod(
  taxPeriod: string,
  nowMs: number,
): PeriodValidationOk | PeriodValidationError {
  const parsed = TaxPeriodSchema.safeParse(taxPeriod);
  if (!parsed.success) {
    return { ok: false, issue: 'invalid tax period — expected YYYY-MM' };
  }
  const [yStr, mStr] = taxPeriod.split('-') as [string, string];
  const year = Number.parseInt(yStr, 10);
  const month = Number.parseInt(mStr, 10);
  // KRA's "current period" boundary — last day of period at 23:59 UTC+3.
  const periodEndUtcMs = Date.UTC(year, month, 0, 23, 59, 0) - 3 * 60 * 60 * 1000;
  if (nowMs < periodEndUtcMs) {
    return { ok: false, issue: 'tax period is still open — cannot file yet' };
  }
  const twelveMonthsMs = 365 * 24 * 60 * 60 * 1000;
  if (nowMs - periodEndUtcMs > twelveMonthsMs) {
    return { ok: false, issue: 'tax period >12 months old — use amendment workflow' };
  }
  return { ok: true, period: taxPeriod };
}

// ─────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────

export interface KraEritsCredentials {
  /** KRA portal username (typically the filing-agent PIN + suffix). */
  readonly username: string;
  readonly password: string;
  /** Filing entity PIN — defaults to credentials.username's PIN if omitted. */
  readonly entityPin?: string;
  /** Expected API schema version (for runtime checking). Empty disables. */
  readonly expectedSchemaVersion?: string;
}

export interface KraEritsRealAdapterDeps {
  readonly env?: KraEnv;
  readonly baseUrl?: string;
  readonly credentials: KraEritsCredentials;
  /** Session TTL — KRA's iTax sessions are typically ~30 minutes. */
  readonly sessionTtlSec?: number;
  readonly fetch?: typeof fetch;
  readonly events?: ConnectorEventSink;
  readonly audit?: AuditSink;
  readonly clock?: () => number;
}

export interface KraEritsRealAdapter {
  readonly connector: BaseConnector;
  readonly env: KraEnv;
  submitMri(args: SubmitMriInput, idempotencyKey?: string): Promise<ConnectorOutcome<SubmitMriOutput>>;
  getReceipt(args: GetReceiptInput): Promise<ConnectorOutcome<GetReceiptOutput>>;
  cancelFiling(args: CancelFilingInput, idempotencyKey?: string): Promise<ConnectorOutcome<CancelFilingOutput>>;
  validatePeriod(taxPeriod: string): PeriodValidationOk | PeriodValidationError;
  checkSchemaVersion(): Promise<ConnectorOutcome<{ version: string }>>;
}

interface SessionCache {
  token: string | null;
  expiresAtMs: number;
}

const VersionResponseSchema = z.object({ version: z.string().min(1) });

export function createKraEritsRealAdapter(
  deps: KraEritsRealAdapterDeps,
): KraEritsRealAdapter {
  const env: KraEnv = deps.env ?? 'sandbox';
  const baseUrl = deps.baseUrl ?? BASE_URLS[env];
  const credentials = deps.credentials;
  const sessionTtlSec = deps.sessionTtlSec ?? 1800;
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const clock = deps.clock ?? Date.now;

  if (!fetchImpl) throw new Error('createKraEritsRealAdapter: no fetch implementation');
  if (!credentials.username || !credentials.password) {
    throw new Error('createKraEritsRealAdapter: username + password required');
  }

  const session: SessionCache = { token: null, expiresAtMs: 0 };

  // HIGH-2 (audit .audit/post-pr90-api-mcp-bug-sweep.md): The login
  // endpoint used to bypass connector.call() — no rate-limit, no
  // circuit-breaker, no audit, no SSRF guard. A bad-auth storm against
  // KRA opened nothing locally. Route /erits/login through a dedicated
  // no-auth connector with stricter limits than the data plane so a
  // credential-stuffing burst is contained.
  const loginConnector = createBaseConnector({
    config: {
      id: 'kra-erits-login',
      displayName: `KRA eRITS login (${env})`,
      baseUrl,
      // No auth on the login endpoint itself (this IS the auth).
      // KRA caps the login surface much tighter than the data plane.
      rateLimit: { rpm: 6, burst: 2 },
      circuitBreaker: { errorThreshold: 3, halfOpenAfterMs: 120_000 },
      retry: { maxAttempts: 1, initialDelayMs: 500 },
      timeoutMs: 20_000,
    },
    fetch: fetchImpl,
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });

  async function fetchSession(): Promise<string> {
    const outcome = await loginConnector.call<
      { username: string; password: string },
      { token?: string; expires_in?: number }
    >({
      path: '/erits/login',
      method: 'POST',
      body: { username: credentials.username, password: credentials.password },
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    });
    if (outcome.kind !== 'ok') {
      throw new Error(`kra-erits: login ${outcome.kind}`);
    }
    const body = outcome.data;
    if (!body.token) throw new Error('kra-erits: login response missing token');
    session.token = body.token;
    const ttl = Number(body.expires_in ?? sessionTtlSec);
    session.expiresAtMs = clock() + Math.max(60, ttl - 60) * 1000;
    return body.token;
  }

  async function getSession(): Promise<string> {
    if (session.token && clock() < session.expiresAtMs) return session.token;
    return fetchSession();
  }

  const connector = createBaseConnector({
    config: {
      id: 'kra-erits',
      displayName: `KRA eRITS (${env})`,
      baseUrl,
      auth: {
        kind: 'oauth2',
        accessTokenProvider: getSession,
        refresh: async () => {
          session.token = null;
          session.expiresAtMs = 0;
          await fetchSession();
        },
      },
      // KRA's published cap is ~30 req/min/integrator.
      rateLimit: { rpm: 30, burst: 6 },
      circuitBreaker: { errorThreshold: 4, halfOpenAfterMs: 60_000 },
      retry: { maxAttempts: 3, initialDelayMs: 500 },
      timeoutMs: 20_000,
    },
    fetch: fetchImpl,
    ...(deps.events ? { events: deps.events } : {}),
    ...(deps.audit ? { audit: deps.audit } : {}),
    ...(deps.clock ? { clock: deps.clock } : {}),
  });

  async function checkSchemaVersion(): Promise<ConnectorOutcome<{ version: string }>> {
    return connector.call<undefined, { version: string }>({
      path: '/erits/version',
      method: 'GET',
      outputSchema: VersionResponseSchema,
    });
  }

  async function ensureSchemaVersion(): Promise<{ ok: true } | { ok: false; issue: string }> {
    const expected = credentials.expectedSchemaVersion?.trim();
    if (!expected) return { ok: true };
    const outcome = await checkSchemaVersion();
    if (outcome.kind !== 'ok') {
      return { ok: false, issue: `schema-version probe failed: ${outcome.kind}` };
    }
    if (outcome.data.version !== expected) {
      return {
        ok: false,
        issue: `schema mismatch — upstream ${outcome.data.version} expected ${expected}`,
      };
    }
    return { ok: true };
  }

  async function submitMri(
    args: SubmitMriInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<SubmitMriOutput>> {
    const parsed = SubmitMriInputSchema.safeParse(args);
    if (!parsed.success) {
      return { kind: 'validation-failed', issue: parsed.error.message };
    }
    const periodCheck = validateTaxPeriod(parsed.data.taxPeriod, clock());
    if (!periodCheck.ok) {
      return { kind: 'validation-failed', issue: periodCheck.issue };
    }
    const schemaCheck = await ensureSchemaVersion();
    if (!schemaCheck.ok) {
      return { kind: 'unconfigured', reason: schemaCheck.issue };
    }
    return connector.call<unknown, SubmitMriOutput>({
      path: '/erits/submitMri',
      method: 'POST',
      body: parsed.data,
      outputSchema: SubmitMriOutputSchema,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
  }

  async function getReceipt(
    args: GetReceiptInput,
  ): Promise<ConnectorOutcome<GetReceiptOutput>> {
    const parsed = GetReceiptInputSchema.safeParse(args);
    if (!parsed.success) {
      return { kind: 'validation-failed', issue: parsed.error.message };
    }
    return connector.call<undefined, GetReceiptOutput>({
      path: '/erits/getReceipt',
      method: 'GET',
      query: { submissionId: parsed.data.submissionId },
      outputSchema: GetReceiptOutputSchema,
    });
  }

  async function cancelFiling(
    args: CancelFilingInput,
    idempotencyKey?: string,
  ): Promise<ConnectorOutcome<CancelFilingOutput>> {
    const parsed = CancelFilingInputSchema.safeParse(args);
    if (!parsed.success) {
      return { kind: 'validation-failed', issue: parsed.error.message };
    }
    return connector.call<unknown, CancelFilingOutput>({
      path: '/erits/cancelFiling',
      method: 'POST',
      body: parsed.data,
      outputSchema: CancelFilingOutputSchema,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
  }

  return {
    connector,
    env,
    submitMri,
    getReceipt,
    cancelFiling,
    validatePeriod: (period: string) => validateTaxPeriod(period, clock()),
    checkSchemaVersion,
  };
}
