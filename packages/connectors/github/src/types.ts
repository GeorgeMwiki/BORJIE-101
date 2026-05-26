/**
 * GitHub connector — shared types.
 *
 * Wave OMNI-P1. See Docs/DESIGN/OMNI_P1_CONNECTORS_SPEC.md §3.5.
 *
 * Distinct from junior-spawner's GitHub touchpoints — this connector
 * carries the OMNI-P1 audit-hash chain.
 */

export type GitHubEntityKind = 'repo' | 'pull_request' | 'issue' | 'release';

export interface GitHubEntityPayload {
  readonly entityKind: GitHubEntityKind;
  readonly entityId: string;
  readonly number: number | null;
  readonly title: string | null;
  readonly state: string | null;
  readonly authorLogin: string | null;
  readonly authorEmailHashed: string | null;
  readonly updatedAt: string;
}

export interface GitHubInstall {
  readonly tenantId: string;
  /** GitHub org / user login. */
  readonly account: string;
  /** OAuth client id (or App id). */
  readonly clientId: string;
  /** OAuth client secret (or App private key for JWT). */
  readonly clientSecret: string;
  readonly baseUrl?: string; // GitHub Enterprise Server support
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
