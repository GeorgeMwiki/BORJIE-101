/**
 * Salesforce connector — shared types.
 *
 * Wave OMNI-P1. See Docs/DESIGN/OMNI_P1_CONNECTORS_SPEC.md §3.1.
 *
 * No I/O, no global state — only types and a connector-local config
 * interface. The Salesforce SObject schema is intentionally narrow:
 * we expose the four entity kinds Mr. Mwikila most needs at v1
 * (Account, Opportunity, Contact, Case) under a uniform envelope.
 */

export type SalesforceSObjectType =
  | 'Account'
  | 'Opportunity'
  | 'Contact'
  | 'Case';

/**
 * Canonical, post-redaction payload for one Salesforce SObject row.
 * Field set is the v1 minimum; richer fields land in `raw` (also
 * post-redaction).
 */
export interface SalesforceSObjectPayload {
  readonly sobjectType: SalesforceSObjectType;
  readonly sobjectId: string; // 18-char Salesforce id
  readonly name: string | null; // kept (operational context)
  readonly emailHashed: string | null; // salted-hash
  readonly phoneHashed: string | null; // salted-hash
  readonly stage: string | null; // Opportunity.StageName / Case.Status
  readonly amount: number | null; // Opportunity.Amount
  readonly closeDate: string | null; // ISO date
  readonly lastModifiedDate: string; // ISO datetime
}

/**
 * Per-tenant Salesforce install. The composition root constructs one
 * connector per install.
 */
export interface SalesforceInstall {
  readonly tenantId: string;
  /** Salesforce org id (per-tenant Borjie ↔ per-org Salesforce). */
  readonly account: string;
  /** API base — e.g. `https://my-org.my.salesforce.com`. */
  readonly instanceUrl: string;
  /** OAuth client id from the connected app. */
  readonly clientId: string;
  /** OAuth client secret (never logged). */
  readonly clientSecret: string;
}

/**
 * Inbound webhook envelope (Salesforce Platform Events / Streaming).
 * v1 polling-only, but the type is here for forward-compat.
 */
export interface SalesforcePushEvent {
  readonly schemaId: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Salt provider port — yields a per-tenant salt for the salted-hash
 * PII redactor. Production wires this to the KMS-backed
 * tenant-derived-secret service.
 */
export interface SaltProvider {
  readonly forTenant: (tenantId: string) => Promise<string>;
}

/**
 * Fetcher port — every HTTP call goes through this. Live tests inject
 * the real `globalThis.fetch`; unit tests inject deterministic fakes.
 */
export interface FetcherPort {
  readonly fetch: (
    url: string,
    init: { readonly method: 'GET' | 'POST'; readonly headers: Readonly<Record<string, string>>; readonly body?: string },
  ) => Promise<{ readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly text: () => Promise<string> }>;
}
