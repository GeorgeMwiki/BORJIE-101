/**
 * @borjie/omnidata — shared types.
 *
 * The connector contract every external-data integration in Borjie's
 * capability-boost wave (Slack, Gmail, Notion, WhatsApp, Drive, social,
 * etc.) must implement. The kernel sees a uniform `OmnidataConnector`;
 * downstream MCP clients see the per-source MCP tool surface. One source
 * of truth, two transports.
 *
 * No I/O, no global state, no implementation here — only types. The
 * scaffold under `connector-base/` provides the auth broker, sync
 * scheduler, PII redactor wrapper, and provenance stamper as
 * dependency-injectable primitives. Concrete connectors land per source.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Closed catalogue of source kinds Borjie supports. Adding a new source
 * is a typed change — every consumer (registry, audit, sync scheduler)
 * is forced to handle it.
 */
export type OmnidataSourceKind =
  | 'slack'
  | 'gmail'
  | 'outlook_mail'
  | 'google_calendar'
  | 'outlook_calendar'
  | 'whatsapp_business'
  | 'notion'
  | 'google_drive'
  | 'onedrive'
  | 'dropbox'
  | 'microsoft_teams'
  | 'salesforce'
  | 'hubspot'
  | 'linear'
  | 'jira'
  | 'asana'
  | 'github'
  | 'gitlab'
  | 'zoom_recording'
  | 'meet_recording'
  | 'vapi_call'
  | 'retell_call'
  | 'twilio_call'
  | 'instagram_business'
  | 'facebook_page'
  | 'tiktok_business'
  | 'twitter'
  | 'linkedin_page'
  | 'youtube_channel'
  | 'mpesa_statement'
  | 'nbc_statement'
  | 'crdb_statement'
  | 'quickbooks'
  | 'xero'
  | 'tumemadini_portal'
  | 'nemc_portal'
  | 'tra_portal'
  | 'bot_portal';

/**
 * Refresh cadence declaration. The sync scheduler reads this to decide
 * webhook subscription, cron registration, or on-demand only.
 */
export type RefreshPolicy =
  | { readonly kind: 'realtime'; readonly webhookSecret: string }
  | { readonly kind: 'pushed'; readonly subscriptionToken: string }
  | { readonly kind: 'cron'; readonly cron: string; readonly maxRowsPerRun: number }
  | { readonly kind: 'on-demand' };

/**
 * Auth context the orchestrator gives the connector at request time.
 * The connector should NEVER hold tokens in memory across sync runs;
 * the broker provides fresh credentials per invocation.
 */
export type OmnidataAuthContext =
  | { readonly kind: 'oauth2'; readonly accessToken: string; readonly refreshToken: string; readonly expiresAt: string }
  | { readonly kind: 'api-key'; readonly headerName: string; readonly key: string }
  | { readonly kind: 'webhook'; readonly secret: string }
  | { readonly kind: 'browser-session'; readonly cookieJar: string }
  | { readonly kind: 'unconfigured' };

/**
 * Consent scope for the ingest. DM-level / mailbox-level / etc. sources
 * require per-user consent records before any ingest happens.
 */
export type ConsentScope =
  | { readonly kind: 'workspace'; readonly workspaceId: string }
  | { readonly kind: 'channel'; readonly channelIds: ReadonlyArray<string> }
  | { readonly kind: 'mailbox'; readonly mailboxOwnerId: string }
  | { readonly kind: 'folder'; readonly folderIds: ReadonlyArray<string> }
  | { readonly kind: 'per-user-dm'; readonly userIds: ReadonlyArray<string> };

/**
 * Volume class governs scheduler back-pressure + storage tier.
 */
export type VolumeClass = 'light' | 'medium' | 'heavy';

/**
 * Phase classification (per OMNIDATA_CONNECTOR_INVENTORY.md).
 */
export type ConnectorPhase = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * Static metadata about a connector. Shape is read by the registry and
 * the owner-facing install UI.
 */
export interface OmnidataConnectorMetadata {
  readonly id: string; // e.g. 'slack:T01ABC'
  readonly sourceKind: OmnidataSourceKind;
  readonly displayName: string;
  readonly description: string;
  readonly phase: ConnectorPhase;
  readonly volumeClass: VolumeClass;
  readonly refreshPolicy: RefreshPolicy;
  readonly requiresConsentScope: ConsentScope['kind'];
  readonly mcpServerOpportunity: 'yes' | 'no' | 'already_shipped';
  readonly authKind: OmnidataAuthContext['kind'];
}

/**
 * Per-sync invocation request. The orchestrator computes `since`
 * from the connector's last successful sync.
 */
export interface OmnidataSyncRequest {
  readonly tenantId: string;
  readonly connectorId: string;
  readonly auth: OmnidataAuthContext;
  readonly since: string | null; // ISO timestamp; null = first sync (backfill)
  readonly maxItems: number;
  readonly correlationId: string;
}

/**
 * Per-sync invocation result. The orchestrator records the audit row
 * regardless of outcome.
 */
export type OmnidataSyncResult<TPayload = unknown> =
  | {
      readonly kind: 'ok';
      readonly items: ReadonlyArray<OmnidataIngestedItem<TPayload>>;
      readonly nextSince: string;
      readonly hasMore: boolean;
      readonly latencyMs: number;
    }
  | { readonly kind: 'unconfigured'; readonly reason: string }
  | { readonly kind: 'auth-failed'; readonly message: string }
  | { readonly kind: 'rate-limited'; readonly retryAfterMs: number }
  | { readonly kind: 'consent-missing'; readonly missingScopes: ReadonlyArray<string> }
  | { readonly kind: 'upstream-error'; readonly status: number; readonly message: string }
  | { readonly kind: 'transport-error'; readonly message: string };

/**
 * Canonical envelope for every ingested record. This is the contract
 * downstream consumers (cognitive memory, capability catalogue,
 * tacit-knowledge follow-up, data-onboarding) all read from.
 *
 * Every field is immutable. `audit_hash` anchors in
 * @borjie/audit-hash-chain.
 */
export interface OmnidataIngestedItem<TPayload = unknown> {
  readonly id: string; // uuid
  readonly tenant_id: string;
  readonly connector_id: string;
  readonly source_kind: OmnidataSourceKind;
  readonly source_record_id: string; // exact upstream id, never reformatted
  readonly retrieved_at: string; // ISO timestamp
  readonly payload: TPayload;
  readonly redaction_applied: ReadonlyArray<string>; // PII fields scrubbed
  readonly consent_record_id: string | null;
  readonly audit_hash: string;
}

/**
 * The connector contract. Every external-source integration ships an
 * implementation. The shape is deliberately tiny so authors can focus
 * on the source-specific quirks (auth, pagination, webhook signature)
 * without re-implementing scheduling / PII / audit each time.
 */
export interface OmnidataConnector<TPayload = unknown> {
  readonly metadata: OmnidataConnectorMetadata;
  /**
   * Performs one sync invocation. Idempotent — replays produce the same
   * `source_record_id`s. Implementations SHOULD NOT redact PII themselves;
   * the orchestrator wraps the call with `boundaryRedact` before payload
   * persistence.
   */
  readonly sync: (req: OmnidataSyncRequest) => Promise<OmnidataSyncResult<TPayload>>;
  /**
   * Validates a webhook payload signature (HMAC). Returns `true` if the
   * payload is authentic. Connectors with `realtime` refresh-policy MUST
   * implement; on-demand / cron / pushed connectors can return `false`
   * (orchestrator will route those through `sync` instead).
   */
  readonly verifyWebhook: (rawBody: string, signature: string, secret: string) => boolean;
}

/**
 * PII redactor port. Wired in production to
 * `packages/observability/src/pii-redactor.ts`.
 *
 * Returns the redacted value and the list of field paths that were
 * redacted (for the `redaction_applied` audit field).
 */
export interface PIIRedactor {
  readonly redact: <T>(payload: T) => { readonly redacted: T; readonly redactedFields: ReadonlyArray<string> };
}

/**
 * Audit-chain port. Wired in production to `@borjie/audit-hash-chain`.
 */
export interface AuditChainPort {
  readonly append: (params: {
    readonly tenantId: string;
    readonly action: string;
    readonly resourceId: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  }) => Promise<{ readonly hash: string }>;
}

/**
 * Consent registry port. Wired to the `omnidata_consent_records` table
 * in production. The orchestrator checks consent before invoking
 * `sync` on consent-sensitive scopes.
 */
export interface ConsentRegistryPort {
  readonly hasConsent: (params: {
    readonly tenantId: string;
    readonly connectorId: string;
    readonly scope: ConsentScope;
  }) => Promise<{ readonly granted: boolean; readonly recordId: string | null }>;
}

/**
 * Clock port — required for deterministic tests of the scheduler.
 */
export interface ClockPort {
  readonly nowIso: () => string;
}

/**
 * UUID generator port — required for deterministic tests.
 */
export interface UuidPort {
  readonly v4: () => string;
}

/* eslint-enable @typescript-eslint/no-explicit-any */
