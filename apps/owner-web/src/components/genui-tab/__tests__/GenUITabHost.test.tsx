/**
 * GenUITabHost render tests (FE seam #4).
 *
 * Direct-tab mode (no network): given a validated `PortalTab`, the host
 * renders the header, each section, every field via the registry-mapped
 * control, and each widget as a registry-labelled card. Covers the seam the
 * "infinite dynamic tabs" feature relies on — the MD-authored tab actually
 * paints in owner-web.
 *
 * The fixture is built through the package's own `parsePortalTab` so the test
 * can only run against a genuinely valid document (same gate the engine
 * applies before persist).
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { type ReactElement } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { parsePortalTab, type PortalTab } from '@borjie/portal-genui';

import { GenUITabHost } from '../GenUITabHost';

/**
 * The host now uses TanStack Query (record list + widget data + record
 * create) in BOTH modes, so every render is wrapped in a fresh QueryClient —
 * mirrors the app's `AppProviders`. Retries off so a disabled/failing query
 * never hangs the test.
 */
function renderHost(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

function buildTab(): PortalTab {
  const now = new Date().toISOString();
  return parsePortalTab({
    id: 'tab_demo_1',
    version: 1,
    tenantId: 'tenant_A',
    userId: 'user_1',
    tabKey: 'hr.payroll',
    title: 'Staff Payroll',
    description: 'Track monthly staff payroll.',
    icon: 'Users',
    domain: 'hr',
    sections: [
      {
        key: 'employee',
        title: 'Employee',
        description: 'Who is being paid.',
        fields: [
          { key: 'name', label: 'Full name', kind: 'text', required: true, span: 6 },
          { key: 'salary', label: 'Monthly salary', kind: 'currency', span: 4 },
          { key: 'start', label: 'Start date', kind: 'date', span: 4 },
          {
            key: 'role',
            label: 'Role',
            kind: 'dropdown',
            span: 4,
            options: [
              { value: 'geologist', label: 'Geologist' },
              { value: 'driver', label: 'Driver' },
            ],
          },
        ],
        widgets: [
          {
            key: 'roster',
            kind: 'table',
            title: 'Payroll roster',
            span: 12,
            config: null,
          },
        ],
      },
    ],
    permissions: { visibleToPersonas: ['owner'] },
    audit: {
      createdBy: 'user_1',
      updatedBy: 'user_1',
      history: [
        { actor: 'agent', actorId: 'user_1', action: 'created', at: now },
      ],
    },
    createdAt: now,
    updatedAt: now,
  });
}

describe('GenUITabHost — direct tab render', () => {
  it('renders the tab header (title + domain + description)', () => {
    renderHost(<GenUITabHost tab={buildTab()} locale="en" />);
    expect(screen.getByText('Staff Payroll')).toBeInTheDocument();
    expect(screen.getByText('Track monthly staff payroll.')).toBeInTheDocument();
    expect(screen.getByTestId('genui-tab-host')).toHaveAttribute(
      'data-tab-key',
      'hr.payroll',
    );
  });

  it('renders every section + its fields by kind', () => {
    renderHost(<GenUITabHost tab={buildTab()} locale="en" />);
    expect(screen.getByTestId('genui-section-employee')).toBeInTheDocument();
    // Each field renders with a kind-tagged wrapper.
    expect(screen.getByTestId('genui-field-name')).toHaveAttribute(
      'data-field-kind',
      'text',
    );
    expect(screen.getByTestId('genui-field-salary')).toHaveAttribute(
      'data-field-kind',
      'currency',
    );
    expect(screen.getByTestId('genui-field-start')).toHaveAttribute(
      'data-field-kind',
      'date',
    );
    // Dropdown options render from the field's option list.
    expect(screen.getByText('Geologist')).toBeInTheDocument();
    // Field labels paint.
    expect(screen.getByText('Full name')).toBeInTheDocument();
  });

  it('renders widgets as registry-labelled cards', () => {
    renderHost(<GenUITabHost tab={buildTab()} locale="en" />);
    const widget = screen.getByTestId('genui-widget-roster');
    expect(widget).toHaveAttribute('data-widget-kind', 'table');
    expect(screen.getByText('Payroll roster')).toBeInTheDocument();
  });

  it('shows a Swahili empty state when the tab has no sections (locale sw)', () => {
    const tab = buildTab();
    // Force a zero-section render path by stripping sections post-validation
    // (the host tolerates it with an empty-state note).
    const empty = { ...tab, sections: [] } as PortalTab;
    renderHost(<GenUITabHost tab={empty} locale="sw" />);
    expect(screen.getByText('Kichupo hiki bado hakina sehemu.')).toBeInTheDocument();
  });
});
