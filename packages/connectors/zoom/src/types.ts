/**
 * Zoom connector — shared types.
 *
 * Wave OMNI-P1. See Docs/DESIGN/OMNI_P1_CONNECTORS_SPEC.md §3.8.
 */

export interface ZoomMeetingPayload {
  readonly meetingId: string;
  readonly topic: string | null;
  readonly startAt: string;
  readonly endAt: string | null;
  readonly participants: ReadonlyArray<{
    readonly name: string;
    readonly emailHashed: string | null;
    readonly joinedAt: string | null;
    readonly leftAt: string | null;
  }>;
  readonly recordingUri: string | null;
  readonly transcriptText: string | null;
}

export interface ZoomInstall {
  readonly tenantId: string;
  /** Zoom account id (S2S account_credentials accountId param). */
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
