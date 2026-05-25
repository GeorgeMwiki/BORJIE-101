/**
 * `<SectionMount>` lazy-load orchestration tests.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SectionMount, __clearLazyCacheForTesting } from '../components/SectionMount.js';
import { deferredSection } from './test-utils.js';

beforeEach(() => {
  __clearLazyCacheForTesting();
});

describe('<SectionMount>', () => {
  it('renders the skeleton fallback before the loader resolves', () => {
    const { section } = deferredSection('a', () => <div data-testid="real">real</div>);
    render(
      <SectionMount section={section} tenantId="t1" scope="owner-customer" />,
    );
    expect(screen.getByTestId('dynamic-section-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('real')).not.toBeInTheDocument();
  });

  it('mounts the component after the loader resolves', async () => {
    const { section, resolve } = deferredSection('b', () => (
      <div data-testid="real-b">real-b</div>
    ));
    render(
      <SectionMount section={section} tenantId="t1" scope="owner-customer" />,
    );
    resolve();
    await waitFor(() =>
      expect(screen.getByTestId('real-b')).toBeInTheDocument(),
    );
  });

  it('forwards tenantId / orgId / entity_type / scope as component props', async () => {
    const { section, resolve } = deferredSection('props-c', (props) => (
      <div data-testid="props-c">{JSON.stringify(props)}</div>
    ));
    render(
      <SectionMount
        section={section}
        tenantId="t-2"
        orgId="org-9"
        scope="internal-admin"
      />,
    );
    resolve();
    await waitFor(() => screen.getByTestId('props-c'));
    const text = screen.getByTestId('props-c').textContent ?? '';
    expect(text).toContain('"tenantId":"t-2"');
    expect(text).toContain('"orgId":"org-9"');
    expect(text).toContain('"scope":"internal-admin"');
    expect(text).toContain('"entityType":"props-c"');
  });

  it('renders a custom fallback when one is supplied', () => {
    const { section } = deferredSection('d', () => <div>x</div>);
    render(
      <SectionMount
        section={section}
        tenantId="t1"
        scope="owner-customer"
        fallback={<div data-testid="custom-fallback">custom!</div>}
      />,
    );
    expect(screen.getByTestId('custom-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('dynamic-section-skeleton')).not.toBeInTheDocument();
  });

  it('memoises the lazy component per section key (re-render does not refetch)', async () => {
    let callCount = 0;
    const section = {
      key: 'memo',
      label: 'memo',
      icon: 'circle',
      entity_type: 'memo',
      sort_order: 10,
      visibility_predicate: {
        kind: 'has-entities' as const,
        entity_type: 'memo',
      },
      component_loader: async () => {
        callCount++;
        return { default: () => <div data-testid="memo-mount">memo</div> };
      },
    };
    const { rerender } = render(
      <SectionMount section={section} tenantId="t1" scope="owner-customer" />,
    );
    await waitFor(() => screen.getByTestId('memo-mount'));
    rerender(
      <SectionMount section={section} tenantId="t1" scope="owner-customer" />,
    );
    // The lazy cache means the loader is invoked only once even across renders.
    expect(callCount).toBe(1);
  });
});
