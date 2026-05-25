/**
 * Story utilities — a fixed TanStack QueryClient + a one-shot loader
 * that returns the supplied entity counts. Keeps each story file
 * narrow and the storybook deck snappy.
 */

import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { SectionContextProvider } from '../hooks/section-context-provider.js';
import { SectionRegistry } from '../registry/section-registry.js';
import type {
  Section,
  SectionContext,
  SectionScope,
} from '../contracts/section.js';

export function storyClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });
}

export function makeStoryContextLoader(
  partial: Partial<Omit<SectionContext, 'tenantId' | 'orgId' | 'scope'>>,
  options: { readonly delayMs?: number } = {},
) {
  return async () => {
    if (options.delayMs) {
      await new Promise((r) => setTimeout(r, options.delayMs));
    }
    return {
      entityCounts: partial.entityCounts ?? {},
      roles: partial.roles ?? [],
      featureFlags: partial.featureFlags ?? [],
    };
  };
}

export interface StoryShellProps {
  readonly children: ReactNode;
  readonly sections: readonly Section[];
  readonly loader: () => Promise<
    Omit<SectionContext, 'tenantId' | 'orgId' | 'scope'>
  >;
}

export function StoryShell({
  sections,
  loader,
  children,
}: StoryShellProps): JSX.Element {
  const registry = new SectionRegistry().registerAll(sections);
  return (
    <QueryClientProvider client={storyClient()}>
      <SectionContextProvider registry={registry} loadContext={loader}>
        <div className="min-h-screen bg-white p-4">{children}</div>
      </SectionContextProvider>
    </QueryClientProvider>
  );
}

export const DEMO_TENANT_ID = 'demo-tenant-tz-01';
export const DEMO_ORG_ID = 'demo-org-cbd';
export const DEMO_SCOPE_OWNER: SectionScope = 'owner-customer';
export const DEMO_SCOPE_ADMIN: SectionScope = 'internal-admin';
