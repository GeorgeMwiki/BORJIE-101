/**
 * HubSpot connector — shared types.
 *
 * Wave OMNI-P1. See Docs/DESIGN/OMNI_P1_CONNECTORS_SPEC.md §3.2.
 */

export type HubSpotObjectType =
  | 'contacts'
  | 'deals'
  | 'tickets'
  | 'marketing_emails';

export interface HubSpotObjectPayload {
  readonly objectType: HubSpotObjectType;
  readonly objectId: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly company: string | null;
  readonly emailHashed: string | null;
  readonly phoneHashed: string | null;
  readonly dealName: string | null;
  readonly amount: number | null;
  readonly stage: string | null;
  readonly updatedAt: string;
}

export interface HubSpotInstall {
  readonly tenantId: string;
  /** HubSpot portal id (number-as-string in the API). */
  readonly account: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly baseUrl?: string; // default 'https://api.hubapi.com'
}

export interface SaltProvider {
  readonly forTenant: (tenantId: string) => Promise<string>;
}

export interface FetcherPort {
  readonly fetch: (
    url: string,
    init: {
      readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      readonly headers: Readonly<Record<string, string>>;
      readonly body?: string;
    },
  ) => Promise<{
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly text: () => Promise<string>;
  }>;
}
