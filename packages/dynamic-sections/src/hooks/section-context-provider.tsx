/**
 * SectionContextProvider — supplies the SectionRegistry + the context
 * loader used by `useSectionRegistry()`.
 *
 * The portal wraps its dynamic-tabs subtree in this provider. The
 * `loadContext` callback returns the data needed to evaluate
 * predicates (entity counts, roles, feature flags). It runs through
 * TanStack Query under the hood so it benefits from cache + retries.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { SectionContext, SectionScope } from '../contracts/section.js';
import { SectionRegistry } from '../registry/section-registry.js';

/**
 * Loader contract. Implementations typically hit `/api/sections/context`
 * (or equivalent) and return a snapshot for the current tenant/org.
 *
 * The loader receives the tenant + scope keys so the same provider
 * can serve multiple sub-trees without manual prop drilling.
 */
export type SectionContextLoader = (args: {
  readonly tenantId: string;
  readonly orgId?: string | undefined;
  readonly scope: SectionScope;
}) => Promise<Omit<SectionContext, 'tenantId' | 'orgId' | 'scope'>>;

export interface SectionProviderConfig {
  readonly registry: SectionRegistry;
  readonly loadContext: SectionContextLoader;
  /**
   * Query cache TTL in milliseconds. Defaults to 30s — same default
   * as FW-B1 hooks. Sections appearing/disappearing should be
   * snappy without hammering the API.
   */
  readonly staleTimeMs?: number;
}

const Ctx = createContext<SectionProviderConfig | null>(null);

export interface SectionContextProviderProps extends SectionProviderConfig {
  readonly children: ReactNode;
}

export function SectionContextProvider({
  children,
  registry,
  loadContext,
  staleTimeMs,
}: SectionContextProviderProps): JSX.Element {
  const value: SectionProviderConfig = staleTimeMs !== undefined
    ? { registry, loadContext, staleTimeMs }
    : { registry, loadContext };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Internal accessor — not exported from the package root. Hooks
 * inside the package use this to find the provider.
 */
export function useSectionProvider(): SectionProviderConfig {
  const value = useContext(Ctx);
  if (!value) {
    throw new Error(
      'useSectionProvider: must be wrapped in <SectionContextProvider>',
    );
  }
  return value;
}
