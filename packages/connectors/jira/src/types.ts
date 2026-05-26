/**
 * Jira connector — shared types.
 *
 * Wave OMNI-P1. See Docs/DESIGN/OMNI_P1_CONNECTORS_SPEC.md §3.4.
 */

export type JiraEntityKind = 'issue' | 'epic' | 'sprint' | 'worklog';

export interface JiraEntityPayload {
  readonly entityKind: JiraEntityKind;
  readonly entityId: string;
  readonly key: string | null; // JIRA issue key like PROJ-123
  readonly summary: string | null;
  readonly status: string | null;
  readonly assigneeEmailHashed: string | null;
  readonly reporterEmailHashed: string | null;
  readonly updatedAt: string;
}

export interface JiraInstall {
  readonly tenantId: string;
  /** Atlassian site cloud-id or Server base URL. */
  readonly account: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly baseUrl?: string; // for Server/DC; cloud default api.atlassian.com
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
