/**
 * Shared test utilities — React Query client wrapper + section
 * provider wrapper + deferred-loader helper that lets a test resolve
 * a component module on demand (so we can assert "still in
 * skeleton" → "now mounted" transitions).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ComponentType, type ReactElement, type ReactNode } from 'react';
import { SectionContextProvider } from '../hooks/section-context-provider.js';
import { SectionRegistry } from '../registry/section-registry.js';
import type {
  ComponentModule,
  Section,
  SectionContext,
  SectionScope,
} from '../contracts/section.js';

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        staleTime: 0,
      },
    },
  });
}

export interface ProviderWrapperArgs {
  readonly registry: SectionRegistry;
  readonly loadContext: (
    args: { tenantId: string; orgId?: string | undefined; scope: SectionScope },
  ) => Promise<Omit<SectionContext, 'tenantId' | 'orgId' | 'scope'>>;
  readonly queryClient?: QueryClient;
}

export function ProviderWrapper({
  registry,
  loadContext,
  queryClient,
  children,
}: ProviderWrapperArgs & { readonly children: ReactNode }): ReactElement {
  const qc = queryClient ?? makeQueryClient();
  return (
    <QueryClientProvider client={qc}>
      <SectionContextProvider registry={registry} loadContext={loadContext}>
        {children}
      </SectionContextProvider>
    </QueryClientProvider>
  );
}

/**
 * Build a Section whose `component_loader` is controlled by a
 * promise the test resolves on demand.
 */
export function deferredSection(
  key: string,
  Component: ComponentType<unknown>,
): {
  readonly section: Section;
  readonly resolve: () => void;
  readonly load: () => Promise<ComponentModule>;
} {
  let resolveFn!: (mod: ComponentModule) => void;
  const promise = new Promise<ComponentModule>((r) => {
    resolveFn = r;
  });
  const section: Section = {
    key,
    label: key,
    icon: 'circle',
    entity_type: key,
    sort_order: 10,
    visibility_predicate: { kind: 'has-entities', entity_type: key },
    component_loader: () => promise,
  };
  return {
    section,
    load: () => promise,
    resolve: () =>
      resolveFn({ default: Component as ComponentType<unknown> } as ComponentModule),
  };
}
