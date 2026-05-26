/**
 * Linear connector — shared types.
 *
 * Wave OMNI-P1. See Docs/DESIGN/OMNI_P1_CONNECTORS_SPEC.md §3.3.
 */

export type LinearEntityKind = 'issue' | 'project' | 'cycle' | 'comment';

export interface LinearEntityPayload {
  readonly entityKind: LinearEntityKind;
  readonly entityId: string;
  readonly title: string | null;
  readonly state: string | null;
  readonly assigneeEmailHashed: string | null;
  readonly description: string | null;
  readonly updatedAt: string;
}

export interface LinearInstall {
  readonly tenantId: string;
  /** Linear team key (workspace scope). */
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
