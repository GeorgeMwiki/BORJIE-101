/**
 * Query-key factories for the section-registry hooks. Mirror the
 * FW-B1 convention (`[resource, tenantId, orgId?, …filters]`) so
 * invalidations from elsewhere in the app cascade correctly.
 */

import type { SectionScope } from '../contracts/section.js';

export interface SectionQueryScope {
  readonly tenantId: string;
  readonly orgId?: string | undefined;
  readonly scope: SectionScope;
}

function scopeKey(s: SectionQueryScope): readonly (string | undefined)[] {
  return s.orgId ? [s.tenantId, s.orgId, s.scope] : [s.tenantId, s.scope];
}

export const sectionQueryKeys = {
  /** Top-level key — invalidate to refetch all section state. */
  all: (s: SectionQueryScope) =>
    ['dynamic-sections', ...scopeKey(s)] as const,
  /** Context snapshot (entity counts + roles + feature flags). */
  context: (s: SectionQueryScope) =>
    ['dynamic-sections', ...scopeKey(s), 'context'] as const,
} as const;
