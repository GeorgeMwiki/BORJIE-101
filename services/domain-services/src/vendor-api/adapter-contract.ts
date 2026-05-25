/**
 * Vendor API Adapter contract — WAVE 28.
 *
 * Port interface for pluggable vendor integrations. Any concrete adapter
 * (ServiceChannel, UpKeep, generic webhook, manual-queue fallback) MUST
 * implement this shape. The orchestrator depends only on this contract —
 * no concrete adapter types leak into domain logic.
 *
 * All methods are immutable in spirit: adapters SHOULD NOT mutate their
 * input arguments. State (if any) lives in the vendor system itself or in
 * the orchestrator's domain events.
 */

export type VendorCapability =
  | 'scheduling'
  | 'on-site-confirmation'
  | 'invoice-submission'
  | 'availability-query';

export type VendorAdapterId =
  | 'servicechannel'
  | 'upkeep'
  | 'generic-webhook'
  | 'manual-queue';

export type DispatchStatus =
  | 'pending'
  | 'scheduled'
  | 'dispatched'
  | 'on_site'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DispatchInput {
  /** Upstream work order identifier (correlation key across systems). */
  readonly workOrderId: string;
  /** Vendor account identifier within the remote system. */
  readonly vendorId: string;
  /** Tenant scoping — passed through for audit. */
  readonly tenantId: string;
  /** ISO-8601 preferred slot (best effort — vendor may reschedule). */
  readonly preferredWindowStart: string;
  readonly preferredWindowEnd: string;
  /** Free-text task summary the vendor technician sees. */
  readonly description: string;
  /** Property/unit location context. */
  readonly locationHint: string;
  /** Priority — propagated so vendors can triage. */
  readonly priority: 'low' | 'normal' | 'high' | 'emergency';
  /** Optional opaque metadata forwarded to the vendor (e.g. unit#). */
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface DispatchResult {
  /** Adapter that handled the call (observability). */
  readonly adapterId: VendorAdapterId;
  /** Remote dispatch identifier — opaque to us. */
  readonly dispatchId: string;
  /** Normalized status. */
  readonly status: DispatchStatus;
  /** Scheduled window confirmed by the vendor (if any). */
  readonly scheduledWindowStart: string | null;
  readonly scheduledWindowEnd: string | null;
  /** When we dispatched (client clock). */
  readonly dispatchedAt: string;
  /** Vendor-provided follow-up URL (portal deep-link, if any). */
  readonly trackingUrl: string | null;
  /** Human-readable note (e.g. "queued for manual outreach"). */
  readonly note: string | null;
}

export interface OnSiteConfirmation {
  readonly dispatchId: string;
  readonly confirmedAt: string;
  readonly confirmedBy: 'vendor-api' | 'iot-sensor' | 'manual' | 'webhook';
  readonly technicianName: string | null;
  readonly notes: string | null;
}

export interface VendorInvoice {
  readonly invoiceNumber: string;
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly lineItems: readonly {
    readonly description: string;
    readonly amountMinorUnits: number;
  }[];
  readonly issuedAt: string;
}

export interface InvoiceResult {
  readonly dispatchId: string;
  readonly invoiceId: string;
  readonly status: 'received' | 'pending' | 'rejected';
  readonly amountMinorUnits: number;
  readonly currency: string;
  readonly receivedAt: string;
}

export interface AvailabilityWindow {
  readonly start: string;
  readonly end: string;
  readonly technicianId: string | null;
  readonly capacityUnits: number;
}

export interface HealthStatus {
  readonly adapterId: VendorAdapterId;
  readonly healthy: boolean;
  readonly latencyMs: number;
  readonly checkedAt: string;
  readonly message: string | null;
}

export interface DateRange {
  readonly start: string;
  readonly end: string;
}

export interface VendorApiAdapter {
  readonly id: VendorAdapterId;
  readonly capabilities: readonly VendorCapability[];
  scheduleDispatch(input: DispatchInput): Promise<DispatchResult>;
  confirmOnSite(dispatchId: string): Promise<OnSiteConfirmation>;
  submitInvoice(dispatchId: string, invoice: VendorInvoice): Promise<InvoiceResult>;
  getAvailability(vendorId: string, dateRange: DateRange): Promise<AvailabilityWindow[]>;
  healthCheck(): Promise<HealthStatus>;
}

/**
 * Narrow error thrown when an adapter operation fails in a way the
 * orchestrator can compensate for (retry, fall back, escalate).
 */
export class VendorAdapterError extends Error {
  readonly adapterId: VendorAdapterId;
  readonly retryable: boolean;
  override readonly cause: unknown;

  constructor(
    message: string,
    opts: { adapterId: VendorAdapterId; retryable: boolean; cause?: unknown }
  ) {
    super(message);
    this.name = 'VendorAdapterError';
    this.adapterId = opts.adapterId;
    this.retryable = opts.retryable;
    this.cause = opts.cause;
  }
}

/**
 * Injectable fetch shape — matches the Web Fetch API but lets tests
 * supply a deterministic fake without hitting the network. Adapters
 * accept this via constructor so we never call the real fetch in tests.
 */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;
