/**
 * GitLab connector — shared types.
 *
 * Wave OMNI-P1. See Docs/DESIGN/OMNI_P1_CONNECTORS_SPEC.md §3.6.
 */

export type GitLabEntityKind = 'project' | 'merge_request' | 'issue' | 'pipeline';

export interface GitLabEntityPayload {
  readonly entityKind: GitLabEntityKind;
  readonly entityId: string;
  readonly iid: number | null;
  readonly title: string | null;
  readonly state: string | null;
  readonly authorUsername: string | null;
  readonly authorEmailHashed: string | null;
  readonly updatedAt: string;
}

export interface GitLabInstall {
  readonly tenantId: string;
  /** GitLab group path (or self-hosted base URL). */
  readonly account: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** Defaults to https://gitlab.com — self-hosted instances pass their base. */
  readonly baseUrl?: string;
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
