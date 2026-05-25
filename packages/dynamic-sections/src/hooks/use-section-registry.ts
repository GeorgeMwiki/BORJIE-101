/**
 * `useSectionRegistry()` — the primary hook portals call.
 *
 * Returns the filtered + sorted list of sections for the current
 * tenant + org + scope. Under the hood it pulls the section context
 * (entity counts, roles, feature flags) via TanStack Query against
 * the loader configured on `SectionContextProvider`.
 *
 * The hook stays minimal: filtering itself lives in the pure
 * `filterSections` function so it can be unit-tested without React.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  Section,
  SectionContext,
  SectionScope,
} from '../contracts/section.js';
import { filterSections } from '../registry/filter.js';
import { sectionQueryKeys } from './query-keys.js';
import { useSectionProvider } from './section-context-provider.js';

export interface UseSectionRegistryArgs {
  readonly tenantId: string;
  readonly orgId?: string | undefined;
  readonly scope: SectionScope;
}

export interface UseSectionRegistryResult {
  /** Filtered + sorted sections, or [] while loading. */
  readonly sections: readonly Section[];
  /** True while the context snapshot is loading for the first time. */
  readonly isLoading: boolean;
  /** True if the context fetch failed. Sections will be []. */
  readonly isError: boolean;
  /** Error instance if `isError` is true. */
  readonly error: unknown;
  /** The raw context snapshot — useful for diagnostics + storybook. */
  readonly context: SectionContext | undefined;
  /** Force-refetch the context snapshot. */
  readonly refetch: () => void;
}

const DEFAULT_STALE_TIME_MS = 30_000;

export function useSectionRegistry(
  args: UseSectionRegistryArgs,
): UseSectionRegistryResult {
  const provider = useSectionProvider();
  const { tenantId, orgId, scope } = args;

  const query = useQuery({
    queryKey: sectionQueryKeys.context({ tenantId, orgId, scope }),
    queryFn: async (): Promise<SectionContext> => {
      const snapshot = await provider.loadContext({ tenantId, orgId, scope });
      return {
        tenantId,
        orgId,
        scope,
        ...snapshot,
      };
    },
    staleTime: provider.staleTimeMs ?? DEFAULT_STALE_TIME_MS,
    retry: 1,
  });

  const sections = useMemo<readonly Section[]>(() => {
    if (!query.data) return [];
    return filterSections(provider.registry.all, query.data);
  }, [provider.registry, query.data]);

  return {
    sections,
    isLoading: query.isPending,
    isError: query.isError,
    error: query.error,
    context: query.data,
    refetch: () => {
      void query.refetch();
    },
  };
}
