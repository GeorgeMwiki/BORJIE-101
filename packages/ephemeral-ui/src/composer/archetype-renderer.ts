/**
 * `archetype-renderer.ts` — maps a `DashboardArchetype` to a concrete
 * structured payload the dynamic-ui rail can render.
 *
 * Each archetype renderer is a pure function from `(output, ui_hints)`
 * to a small structured shape. Phase 1 ships three renderers
 * (`list_with_filters`, `chart_with_table`, `kpi_grid`); the others
 * have placeholder dispatchers that return a deterministic minimal
 * shape so end-to-end composition works for any manifest.
 *
 * No I/O. No React. Pure.
 */
import type {
  DashboardArchetype,
  Emphasis,
  UIHints,
} from '../types.js';

/**
 * Structured payload an archetype renderer emits. Mirrors the shape the
 * dynamic-ui rail's UiParts accept (kind + fields). Kept JSON-safe.
 */
export interface ArchetypePayload {
  readonly archetype: DashboardArchetype;
  readonly kind: string;
  readonly title: string;
  readonly sections: ReadonlyArray<ArchetypeSection>;
}

export interface ArchetypeSection {
  readonly id: string;
  readonly kind:
    | 'filter_bar'
    | 'list'
    | 'chart'
    | 'table'
    | 'kpi'
    | 'map'
    | 'kanban'
    | 'calendar'
    | 'document'
    | 'compare'
    | 'wizard_step'
    | 'detail_chain'
    | 'fallback';
  readonly payload: Record<string, unknown>;
}

const TITLE_BY_ARCHETYPE: Record<DashboardArchetype, string> = {
  list_with_filters: 'Filtered list',
  chart_with_table: 'Chart with table',
  map_with_overlays: 'Map with overlays',
  kpi_grid: 'KPI grid',
  pipeline_kanban: 'Pipeline kanban',
  calendar_timeline: 'Calendar timeline',
  document_render: 'Document',
  split_compare: 'Split compare',
  wizard_form: 'Wizard',
  detail_with_chain: 'Detail',
  composite: 'Composite view',
};

function toArray(maybe: unknown): ReadonlyArray<unknown> {
  if (Array.isArray(maybe)) return maybe;
  return [];
}

function toRecord(maybe: unknown): Record<string, unknown> {
  if (maybe && typeof maybe === 'object' && !Array.isArray(maybe)) {
    return maybe as Record<string, unknown>;
  }
  return {};
}

function emphasisHint(e: Emphasis): string {
  return e;
}

// ---------------------------------------------------------------------------
// Phase 1 renderers
// ---------------------------------------------------------------------------

function renderListWithFilters(
  output: unknown,
  hints: UIHints,
): ArchetypePayload {
  const o = toRecord(output);
  const items = toArray(o['items'] ?? o['rows'] ?? []);
  const filters = toArray(o['filters'] ?? []);
  return {
    archetype: 'list_with_filters',
    kind: 'list_with_filters',
    title: TITLE_BY_ARCHETYPE.list_with_filters,
    sections: [
      {
        id: 'filters',
        kind: 'filter_bar',
        payload: { filters, layout: hints.preferred_layout },
      },
      {
        id: 'list',
        kind: 'list',
        payload: {
          items,
          emphasis: emphasisHint(hints.emphasis),
        },
      },
    ],
  };
}

function renderChartWithTable(
  output: unknown,
  hints: UIHints,
): ArchetypePayload {
  const o = toRecord(output);
  const series = toArray(o['series'] ?? o['chart'] ?? []);
  const rows = toArray(o['rows'] ?? o['table'] ?? []);
  return {
    archetype: 'chart_with_table',
    kind: 'chart_with_table',
    title: TITLE_BY_ARCHETYPE.chart_with_table,
    sections: [
      {
        id: 'chart',
        kind: 'chart',
        payload: { series, colors: hints.preferred_colors },
      },
      {
        id: 'table',
        kind: 'table',
        payload: { rows, emphasis: emphasisHint(hints.emphasis) },
      },
    ],
  };
}

function renderKpiGrid(output: unknown, hints: UIHints): ArchetypePayload {
  const o = toRecord(output);
  // Accept either a `kpis: [...]` field or pluck top-level number-shaped
  // fields off the output as deterministic fallback.
  const declared = toArray(o['kpis']);
  const kpis =
    declared.length > 0
      ? declared
      : Object.entries(o)
          .filter(([, v]) => typeof v === 'number')
          .map(([k, v]) => ({ id: k, value: v }));
  return {
    archetype: 'kpi_grid',
    kind: 'kpi_grid',
    title: TITLE_BY_ARCHETYPE.kpi_grid,
    sections: [
      {
        id: 'kpis',
        kind: 'kpi',
        payload: {
          kpis,
          layout: hints.preferred_layout,
          mobile_strategy: hints.mobile_strategy,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Placeholder renderers (Phase 2+) — return a minimal deterministic shape
// ---------------------------------------------------------------------------

function renderFallback(
  archetype: DashboardArchetype,
  output: unknown,
  hints: UIHints,
): ArchetypePayload {
  return {
    archetype,
    kind: archetype,
    title: TITLE_BY_ARCHETYPE[archetype],
    sections: [
      {
        id: 'fallback',
        kind: 'fallback',
        payload: {
          rawOutputKeys: Object.keys(toRecord(output)),
          layout: hints.preferred_layout,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function renderArchetype(
  archetype: DashboardArchetype,
  output: unknown,
  hints: UIHints,
): ArchetypePayload {
  switch (archetype) {
    case 'list_with_filters':
      return renderListWithFilters(output, hints);
    case 'chart_with_table':
      return renderChartWithTable(output, hints);
    case 'kpi_grid':
      return renderKpiGrid(output, hints);
    case 'map_with_overlays':
    case 'pipeline_kanban':
    case 'calendar_timeline':
    case 'document_render':
    case 'split_compare':
    case 'wizard_form':
    case 'detail_with_chain':
    case 'composite':
      return renderFallback(archetype, output, hints);
    default: {
      // Exhaustiveness check — `archetype` should be `never` here.
      const _exhaustive: never = archetype;
      void _exhaustive;
      return renderFallback('composite', output, hints);
    }
  }
}
