/**
 * `useSectionRegistry` hook tests.
 */

import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useSectionRegistry } from '../hooks/use-section-registry.js';
import { sectionQueryKeys } from '../hooks/query-keys.js';
import { SectionRegistry } from '../registry/section-registry.js';
import { ProviderWrapper } from './test-utils.js';
import type { Section } from '../contracts/section.js';

function mk(key: string, sort_order = 10): Section {
  return {
    key,
    label: key,
    icon: 'circle',
    entity_type: key,
    sort_order,
    visibility_predicate: { kind: 'has-entities', entity_type: key },
    component_loader: () =>
      Promise.resolve({ default: () => null as unknown as JSX.Element }),
  };
}

describe('useSectionRegistry', () => {
  it('returns empty sections + isLoading=true while context is pending', async () => {
    let resolveLoad!: () => void;
    const loadContext = vi.fn(
      () =>
        new Promise<{ entityCounts: Record<string, number>; roles: string[]; featureFlags: string[] }>(
          (r) => {
            resolveLoad = () =>
              r({ entityCounts: { a: 1 }, roles: [], featureFlags: [] });
          },
        ),
    );
    const registry = new SectionRegistry([mk('a')]);

    const { result } = renderHook(
      () =>
        useSectionRegistry({
          tenantId: 't1',
          scope: 'owner-customer',
        }),
      {
        wrapper: ({ children }) => (
          <ProviderWrapper registry={registry} loadContext={loadContext}>
            {children}
          </ProviderWrapper>
        ),
      },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.sections).toEqual([]);

    resolveLoad();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sections.map((s) => s.key)).toEqual(['a']);
  });

  it('returns filtered + sorted sections after the context resolves', async () => {
    const loadContext = vi.fn(async () => ({
      entityCounts: { b: 1, a: 1 },
      roles: [],
      featureFlags: [],
    }));
    const registry = new SectionRegistry([mk('a', 20), mk('b', 10)]);

    const { result } = renderHook(
      () =>
        useSectionRegistry({
          tenantId: 't1',
          scope: 'owner-customer',
        }),
      {
        wrapper: ({ children }) => (
          <ProviderWrapper registry={registry} loadContext={loadContext}>
            {children}
          </ProviderWrapper>
        ),
      },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.sections.map((s) => s.key)).toEqual(['b', 'a']);
  });

  it('passes the tenant + scope to the loader', async () => {
    const loadContext = vi.fn(async () => ({
      entityCounts: {},
      roles: [],
      featureFlags: [],
    }));
    const registry = new SectionRegistry();

    renderHook(
      () =>
        useSectionRegistry({
          tenantId: 't1',
          orgId: 'o2',
          scope: 'internal-admin',
        }),
      {
        wrapper: ({ children }) => (
          <ProviderWrapper registry={registry} loadContext={loadContext}>
            {children}
          </ProviderWrapper>
        ),
      },
    );

    await waitFor(() => expect(loadContext).toHaveBeenCalled());
    expect(loadContext).toHaveBeenCalledWith({
      tenantId: 't1',
      orgId: 'o2',
      scope: 'internal-admin',
    });
  });

  it('throws when no provider is mounted', () => {
    expect(() =>
      renderHook(() =>
        useSectionRegistry({ tenantId: 't1', scope: 'owner-customer' }),
      ),
    ).toThrow(/must be wrapped in <SectionContextProvider>/);
  });

  it('surfaces errors from the loader via isError + error', async () => {
    const loadContext = vi.fn(async () => {
      throw new Error('boom');
    });
    const registry = new SectionRegistry([mk('a')]);
    // Use a fresh QueryClient with retry disabled so the error surfaces
    // immediately rather than going through the retry-1 delay default.
    const qc = new (await import('@tanstack/react-query')).QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0, staleTime: 0 },
      },
    });

    const { result } = renderHook(
      () =>
        useSectionRegistry({
          tenantId: 't1',
          scope: 'owner-customer',
        }),
      {
        wrapper: ({ children }) => (
          <ProviderWrapper
            registry={registry}
            loadContext={loadContext}
            queryClient={qc}
          >
            {children}
          </ProviderWrapper>
        ),
      },
    );

    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 5000,
    });
    expect(result.current.sections).toEqual([]);
    expect((result.current.error as Error).message).toBe('boom');
  });

  it('uses tenant-scoped query keys', () => {
    const key = sectionQueryKeys.context({
      tenantId: 't1',
      orgId: 'o1',
      scope: 'owner-customer',
    });
    expect(key).toEqual([
      'dynamic-sections',
      't1',
      'o1',
      'owner-customer',
      'context',
    ]);
  });

  it('omits orgId from the query key when not provided', () => {
    const key = sectionQueryKeys.context({
      tenantId: 't1',
      scope: 'owner-customer',
    });
    expect(key).toEqual(['dynamic-sections', 't1', 'owner-customer', 'context']);
  });
});
