/**
 * Microsoft Teams connector — shared types.
 *
 * Wave OMNI-P1. See Docs/DESIGN/OMNI_P1_CONNECTORS_SPEC.md §3.7.
 */

export interface TeamsMessagePayload {
  readonly teamId: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly fromDisplayName: string;
  readonly fromEmailHashed: string | null;
  readonly content: string | null;
  readonly attachments: ReadonlyArray<{
    readonly id: string;
    readonly contentType: string;
    readonly name: string | null;
    readonly contentUrl: string | null;
  }>;
  readonly sentAt: string;
}

export interface TeamsInstall {
  readonly tenantId: string;
  /** Microsoft 365 tenant id (Azure AD tenant guid). */
  readonly account: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface SaltProvider {
  readonly forTenant: (tenantId: string) => Promise<string>;
}

export interface FetcherPort {
  readonly fetch: (
    url: string,
    init: {
      readonly method: 'GET' | 'POST';
      readonly headers: Readonly<Record<string, string>>;
      readonly body?: string;
    },
  ) => Promise<{
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly text: () => Promise<string>;
  }>;
}
