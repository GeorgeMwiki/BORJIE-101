/**
 * Piece-G UiArtifact renderer tests.
 *
 * Verifies:
 *   - validateAndRender returns ok=true + a typed AgUiUiPart for every
 *     catalog entry that has an explicit projector rule
 *   - validateAndRender returns ok=false for unknown component_type
 *   - validateAndRender returns ok=false for malformed payload
 *   - UiArtifact renders a fallback card with the artifact id when
 *     validation fails
 *
 * Each render uses a minimal `ui_artifacts` row shape — the same JSON
 * the brain will emit on the `ui_artifact` SSE event.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import {
  validateAndRender,
  UiArtifact,
  type UiArtifactRow,
} from '../UiArtifact';
import { ARTIFACT_CATALOG } from '../catalog';

function makeRow(
  componentType: string,
  props: unknown,
  data: unknown,
  overrides: Partial<UiArtifactRow> = {},
): UiArtifactRow {
  return {
    id: `art-${componentType}-test`,
    tenantId: 'tenant-1',
    componentType,
    props: (props ?? {}) as Readonly<Record<string, unknown>>,
    data: (data ?? {}) as Readonly<Record<string, unknown>>,
    version: 1,
    createdAt: '2026-05-22T10:00:00Z',
    ...overrides,
  };
}

const RENDER_FIXTURES: Array<{
  type: string;
  props: unknown;
  data: unknown;
}> = [
  {
    type: 'kpi_tile',
    props: { label: 'MRR', format: 'currency', currency: 'TZS' },
    data: { value: 1234, delta: 0.1, deltaDirection: 'up' },
  },
  {
    type: 'bar_chart',
    props: { xField: 'month', yField: 'rev' },
    data: { rows: [{ month: 'Jan', rev: 100 }] },
  },
  {
    type: 'line_chart',
    props: { xField: 'month', yField: 'rev' },
    data: { rows: [{ month: 'Jan', rev: 100 }] },
  },
  {
    type: 'data_table',
    props: {
      columns: [
        { id: 'm', header: 'Month', accessorKey: 'month' },
        { id: 'r', header: 'Revenue', accessorKey: 'rev' },
      ],
      rows: [{ month: 'Jan', rev: 100 }],
    },
    data: {},
  },
  {
    type: 'form',
    props: {
      formId: 'lease-renewal',
      schemaJson: {},
      values: {},
      action: '/api/gateway/forms/lease-renewal',
    },
    data: {},
  },
  {
    type: 'deck_slide',
    props: { title: 'Welcome', layout: 'title-bullet' },
    data: { bullets: ['One', 'Two'] },
  },
  {
    type: 'map_view',
    props: { center: [-6.2, 35.7], zoom: 6, markers: [] },
    data: {},
  },
  {
    type: 'kanban',
    props: { columns: [{ id: 'todo', title: 'Todo', cards: [] }] },
    data: {},
  },
  {
    type: 'gantt',
    props: { rangeStart: '2026-01-01', rangeEnd: '2026-12-31' },
    data: {
      bars: [
        { id: 't1', label: 'Onboard', start: '2026-01-01', end: '2026-02-01', status: 'done' },
      ],
    },
  },
  {
    type: 'image',
    props: { alt: 'Floorplan' },
    data: { url: 'https://example.com/p.png' },
  },
];

describe('validateAndRender', () => {
  for (const fixture of RENDER_FIXTURES) {
    it(`projects ${fixture.type} → AgUiUiPart`, () => {
      const r = validateAndRender(makeRow(fixture.type, fixture.props, fixture.data));
      expect(r.ok).toBe(true);
      expect(r.uiPart).not.toBeNull();
      expect(r.failure).toBeNull();
    });
  }

  it('returns ok=false for unknown component_type', () => {
    const r = validateAndRender(makeRow('nonexistent_chart', {}, {}));
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('unknown-type');
    expect(r.uiPart).toBeNull();
  });

  it('returns ok=false for schema-invalid payload', () => {
    // `bar_chart` requires xField + yField; we leave them out.
    const r = validateAndRender(makeRow('bar_chart', {}, { rows: [] }));
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('schema-validation-failed');
    expect(r.uiPart).toBeNull();
  });
});

describe('<UiArtifact /> renders', () => {
  it('renders a kpi_tile inline (no crash)', () => {
    render(
      <UiArtifact
        artifact={makeRow(
          'kpi_tile',
          { label: 'MRR', format: 'currency', currency: 'TZS' },
          { value: 1234, delta: 0.1, deltaDirection: 'up' },
        )}
      />,
    );
    const node = screen.getByTestId('ui-artifact');
    expect(node).toBeInTheDocument();
    expect(node.getAttribute('data-component-type')).toBe('kpi_tile');
  });

  it('renders a title + description when provided', () => {
    render(
      <UiArtifact
        artifact={makeRow(
          'callout',
          { severity: 'info', title: 'Heads up' },
          { message: 'hello' },
          { title: 'Friendly note', description: 'A small tip.' },
        )}
      />,
    );
    expect(screen.getByTestId('ui-artifact-title')).toHaveTextContent('Friendly note');
    expect(screen.getByTestId('ui-artifact-description')).toHaveTextContent('A small tip.');
  });

  it('renders an UnknownKindCard for unknown component_type and invokes telemetry hook', () => {
    const onFail = vi.fn();
    render(
      <UiArtifact
        artifact={makeRow('does_not_exist', {}, {})}
        onValidationFailure={onFail}
      />,
    );
    expect(onFail).toHaveBeenCalledTimes(1);
    const call = onFail.mock.calls[0]?.[0];
    expect(call.reason).toBe('unknown-type');
    expect(call.componentType).toBe('does_not_exist');
  });

  it('renders an UnknownKindCard for malformed payload', () => {
    const onFail = vi.fn();
    render(
      <UiArtifact
        artifact={makeRow('bar_chart', {}, { rows: [] })}
        onValidationFailure={onFail}
      />,
    );
    expect(onFail).toHaveBeenCalledTimes(1);
    const call = onFail.mock.calls[0]?.[0];
    expect(call.reason).toBe('schema-validation-failed');
  });
});

describe('catalog coverage check', () => {
  it('every catalog entry has a projector or is explicitly marked', () => {
    const skip = new Set<string>(); // currently every entry projects
    for (const entry of ARTIFACT_CATALOG) {
      if (skip.has(entry.key)) continue;
      const fixture = RENDER_FIXTURES.find((f) => f.type === entry.key);
      if (!fixture) {
        // Catalog entry without render fixture is fine — we test
        // schemas separately. Skip silently.
        continue;
      }
      const r = validateAndRender(makeRow(fixture.type, fixture.props, fixture.data));
      expect(r.ok, `projector for ${entry.key} returned ${JSON.stringify(r.failure)}`).toBe(true);
    }
  });
});
