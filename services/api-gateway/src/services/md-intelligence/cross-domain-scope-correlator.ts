/**
 * Cross-domain × scope correlator — Wave SCOPE-SEGMENTATION.
 *
 * For a fixed scope set, computes per-scope status across multiple
 * domains so the MD can render a "matrix view" (rows = scopes,
 * columns = domains, cells = status tone).
 */

import type { DomainId } from '../domain-depth/types';

export interface CrossDomainScopeInput {
  readonly scopeNodeIds: ReadonlyArray<string>;
  readonly domains: ReadonlyArray<DomainId>;
  readonly fetchDomainStatus: (
    scopeNodeId: string,
    domainId: DomainId,
  ) => Promise<{
    readonly status: 'green' | 'amber' | 'red' | 'unknown';
    readonly note?: string;
  }>;
}

export interface CrossDomainScopeCell {
  readonly scopeNodeId: string;
  readonly domainId: DomainId;
  readonly status: 'green' | 'amber' | 'red' | 'unknown';
  readonly note?: string;
}

export interface CrossDomainScopeMatrix {
  readonly scopeNodeIds: ReadonlyArray<string>;
  readonly domains: ReadonlyArray<DomainId>;
  readonly cells: ReadonlyArray<CrossDomainScopeCell>;
}

export async function buildMatrix(
  input: CrossDomainScopeInput,
): Promise<CrossDomainScopeMatrix> {
  const cells: CrossDomainScopeCell[] = [];
  for (const scopeNodeId of input.scopeNodeIds) {
    for (const domainId of input.domains) {
      const st = await input.fetchDomainStatus(scopeNodeId, domainId);
      cells.push({
        scopeNodeId,
        domainId,
        status: st.status,
        ...(st.note !== undefined ? { note: st.note } : {}),
      });
    }
  }
  return {
    scopeNodeIds: input.scopeNodeIds,
    domains: input.domains,
    cells,
  };
}
