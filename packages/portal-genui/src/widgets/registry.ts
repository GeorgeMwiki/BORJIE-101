/**
 * Widget catalog — the 14 supported widget kinds (10 native + 4
 * mapped to existing PortalLayout AG-UI parts).
 *
 * Each entry describes:
 *   - rendererName — string the React side maps to a component
 *   - configSchema — Zod schema validating the widget's `config`
 *                    payload. Generators are free to omit fields;
 *                    the renderer fills sensible defaults.
 *   - defaultConfig — what to render when the config is null
 *   - sampleConfig — used by the tab-builder preview UI
 */

import { z } from 'zod';
import {
  PORTAL_TAB_WIDGET_KINDS,
  type PortalTabWidget,
  type PortalTabWidgetKind,
} from '../types.js';

export interface WidgetKindMetadata {
  readonly kind: PortalTabWidgetKind;
  readonly rendererName: string;
  readonly displayLabel: string;
  readonly description: string;
  /** Zod schema for `widget.config` for this kind. */
  readonly configSchema: z.ZodTypeAny;
  readonly defaultConfig: Readonly<Record<string, unknown>>;
  readonly sampleConfig: Readonly<Record<string, unknown>>;
}

// ────────────────────────────────────────────────────────────────────
// Per-kind configs.
// ────────────────────────────────────────────────────────────────────

const KpiCardConfig = z
  .object({
    label: z.string().min(1).max(120),
    value: z.union([z.string(), z.number()]),
    delta: z.number().optional(),
    unit: z.string().max(20).optional(),
    trend: z.enum(['up', 'down', 'flat']).optional(),
  })
  .strict();

const TimelineConfig = z
  .object({
    items: z
      .array(
        z
          .object({
            at: z.string().min(1).max(40),
            label: z.string().min(1).max(200),
            kind: z.enum(['event', 'note', 'milestone']).optional(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

const TableConfig = z
  .object({
    columns: z
      .array(
        z
          .object({
            key: z.string().min(1).max(120),
            label: z.string().min(1).max(120),
            type: z.enum(['text', 'number', 'currency', 'date', 'badge']),
          })
          .strict(),
      )
      .max(20),
    rows: z.array(z.record(z.unknown())).max(500),
  })
  .strict();

const MapConfig = z
  .object({
    center: z
      .object({
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
      })
      .strict(),
    zoom: z.number().int().min(0).max(22),
    markers: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            lat: z.number().min(-90).max(90),
            lon: z.number().min(-180).max(180),
            label: z.string().max(200).optional(),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

const GalleryConfig = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            url: z.string().url().max(2048),
            caption: z.string().max(200).optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();

const FormConfig = z
  .object({
    fields: z
      .array(
        z
          .object({
            key: z.string().min(1).max(120),
            label: z.string().min(1).max(200),
            type: z.enum(['text', 'number', 'date', 'select']),
          })
          .strict(),
      )
      .max(40),
    submitLabel: z.string().min(1).max(40).default('Save'),
  })
  .strict();

const SeriesPointSchema = z
  .object({
    x: z.union([z.string(), z.number()]),
    y: z.number(),
  })
  .strict();

const ChartLineConfig = z
  .object({
    series: z
      .array(
        z
          .object({
            name: z.string().min(1).max(120),
            points: z.array(SeriesPointSchema).max(1000),
          })
          .strict(),
      )
      .max(10),
    xLabel: z.string().max(60).optional(),
    yLabel: z.string().max(60).optional(),
  })
  .strict();

const ChartBarConfig = z
  .object({
    categories: z.array(z.string().min(1).max(120)).max(50),
    series: z
      .array(
        z
          .object({
            name: z.string().min(1).max(120),
            values: z.array(z.number()).max(50),
          })
          .strict(),
      )
      .max(10),
  })
  .strict();

const ChartDonutConfig = z
  .object({
    slices: z
      .array(
        z
          .object({
            label: z.string().min(1).max(120),
            value: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

const GaugeConfig = z
  .object({
    value: z.number(),
    min: z.number(),
    max: z.number(),
    thresholds: z
      .array(
        z
          .object({
            at: z.number(),
            color: z.enum(['green', 'yellow', 'orange', 'red']),
          })
          .strict(),
      )
      .max(6)
      .optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    if (cfg.min >= cfg.max) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'gauge.min must be < gauge.max',
        path: ['min'],
      });
    }
  });

const CalendarConfig = z
  .object({
    events: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            start: z.string().min(1).max(40),
            end: z.string().max(40).optional(),
            title: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

const KanbanConfig = z
  .object({
    columns: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            title: z.string().min(1).max(120),
            cards: z
              .array(
                z
                  .object({
                    id: z.string().min(1).max(120),
                    title: z.string().min(1).max(200),
                    assignee: z.string().max(120).optional(),
                  })
                  .strict(),
              )
              .max(200),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

const ChatConfig = z
  .object({
    threadId: z.string().min(1).max(200),
    placeholder: z.string().max(200).optional(),
  })
  .strict();

const GenuiPartConfig = z
  .object({
    /** Initial props forwarded to the AG-UI primitive. */
    initialProps: z.record(z.unknown()).optional(),
  })
  .strict();

// ────────────────────────────────────────────────────────────────────
// Registry
// ────────────────────────────────────────────────────────────────────

const REGISTRY: Readonly<Record<PortalTabWidgetKind, WidgetKindMetadata>> = {
  kpi_card: {
    kind: 'kpi_card',
    rendererName: 'KPICardWidget',
    displayLabel: 'KPI card',
    description: 'A single headline number with optional delta + unit.',
    configSchema: KpiCardConfig,
    defaultConfig: { label: 'Metric', value: 0 },
    sampleConfig: {
      label: 'Occupancy',
      value: 92.4,
      unit: '%',
      delta: 1.2,
      trend: 'up',
    },
  },
  timeline: {
    kind: 'timeline',
    rendererName: 'TimelineWidget',
    displayLabel: 'Timeline',
    description: 'Chronological list of events.',
    configSchema: TimelineConfig,
    defaultConfig: { items: [] },
    sampleConfig: {
      items: [
        { at: '2026-05-20', label: 'Onboarded staff member', kind: 'event' },
        { at: '2026-05-22', label: 'First payroll run', kind: 'milestone' },
      ],
    },
  },
  table: {
    kind: 'table',
    rendererName: 'TableWidget',
    displayLabel: 'Table',
    description: 'Tabular grid of records.',
    configSchema: TableConfig,
    defaultConfig: { columns: [], rows: [] },
    sampleConfig: {
      columns: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'amount', label: 'Amount', type: 'currency' },
      ],
      rows: [
        { name: 'Acme Ltd', amount: 1200 },
        { name: 'Beta Co', amount: 980 },
      ],
    },
  },
  map: {
    kind: 'map',
    rendererName: 'MapWidget',
    displayLabel: 'Map',
    description: 'Geographic map with markers.',
    configSchema: MapConfig,
    defaultConfig: { center: { lat: 0, lon: 0 }, zoom: 2, markers: [] },
    sampleConfig: {
      center: { lat: -6.7924, lon: 39.2083 },
      zoom: 11,
      markers: [
        { id: 'p1', lat: -6.79, lon: 39.21, label: 'Property A' },
      ],
    },
  },
  gallery: {
    kind: 'gallery',
    rendererName: 'GalleryWidget',
    displayLabel: 'Image gallery',
    description: 'Grid of images with captions.',
    configSchema: GalleryConfig,
    defaultConfig: { items: [] },
    sampleConfig: {
      items: [
        {
          id: 'i1',
          url: 'https://files.example.com/1.png',
          caption: 'Front facade',
        },
      ],
    },
  },
  form: {
    kind: 'form',
    rendererName: 'FormWidget',
    displayLabel: 'Form',
    description: 'Standalone form to create new records.',
    configSchema: FormConfig,
    defaultConfig: { fields: [], submitLabel: 'Save' },
    sampleConfig: {
      fields: [
        { key: 'name', label: 'Name', type: 'text' },
        { key: 'hireDate', label: 'Hire date', type: 'date' },
      ],
      submitLabel: 'Create',
    },
  },
  chart_line: {
    kind: 'chart_line',
    rendererName: 'LineChartWidget',
    displayLabel: 'Line chart',
    description: 'One or more time-series lines.',
    configSchema: ChartLineConfig,
    defaultConfig: { series: [] },
    sampleConfig: {
      series: [
        {
          name: 'Headcount',
          points: [
            { x: '2026-01', y: 12 },
            { x: '2026-02', y: 14 },
            { x: '2026-03', y: 15 },
          ],
        },
      ],
    },
  },
  chart_bar: {
    kind: 'chart_bar',
    rendererName: 'BarChartWidget',
    displayLabel: 'Bar chart',
    description: 'Grouped or stacked bars by category.',
    configSchema: ChartBarConfig,
    defaultConfig: { categories: [], series: [] },
    sampleConfig: {
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [{ name: 'Revenue', values: [120, 140, 160, 180] }],
    },
  },
  chart_donut: {
    kind: 'chart_donut',
    rendererName: 'DonutChartWidget',
    displayLabel: 'Donut chart',
    description: 'Donut chart of categorical proportions.',
    configSchema: ChartDonutConfig,
    defaultConfig: { slices: [] },
    sampleConfig: {
      slices: [
        { label: 'Full time', value: 12 },
        { label: 'Part time', value: 4 },
        { label: 'Contractor', value: 3 },
      ],
    },
  },
  gauge: {
    kind: 'gauge',
    rendererName: 'GaugeWidget',
    displayLabel: 'Gauge',
    description: 'Half-circle gauge with thresholds.',
    configSchema: GaugeConfig,
    defaultConfig: { value: 0, min: 0, max: 100 },
    sampleConfig: {
      value: 78,
      min: 0,
      max: 100,
      thresholds: [
        { at: 50, color: 'yellow' },
        { at: 80, color: 'green' },
      ],
    },
  },
  calendar: {
    kind: 'calendar',
    rendererName: 'CalendarWidget',
    displayLabel: 'Calendar',
    description: 'Month / week view of events.',
    configSchema: CalendarConfig,
    defaultConfig: { events: [] },
    sampleConfig: {
      events: [
        {
          id: 'e1',
          start: '2026-05-25T09:00:00.000Z',
          end: '2026-05-25T10:00:00.000Z',
          title: 'Team standup',
        },
      ],
    },
  },
  kanban: {
    kind: 'kanban',
    rendererName: 'KanbanWidget',
    displayLabel: 'Kanban board',
    description: 'Columns of cards (todo / doing / done).',
    configSchema: KanbanConfig,
    defaultConfig: { columns: [] },
    sampleConfig: {
      columns: [
        {
          id: 'todo',
          title: 'To do',
          cards: [{ id: 'c1', title: 'Draft handbook' }],
        },
        {
          id: 'doing',
          title: 'Doing',
          cards: [{ id: 'c2', title: 'Run pay cycle' }],
        },
        { id: 'done', title: 'Done', cards: [] },
      ],
    },
  },
  chat: {
    kind: 'chat',
    rendererName: 'ChatWidget',
    displayLabel: 'Chat',
    description: 'Embedded conversation with the AI agent.',
    configSchema: ChatConfig,
    defaultConfig: { threadId: 'default' },
    sampleConfig: {
      threadId: 'hr-payroll-discussion',
      placeholder: 'Ask the HR assistant…',
    },
  },
  genui_part: {
    kind: 'genui_part',
    rendererName: 'GenUIPartWidget',
    displayLabel: 'AG-UI primitive',
    description:
      'Embed one of the 35 vetted AG-UI primitives from @borjie/genui.',
    configSchema: GenuiPartConfig,
    defaultConfig: {},
    sampleConfig: { initialProps: {} },
  },
};

// ────────────────────────────────────────────────────────────────────
// Public surface
// ────────────────────────────────────────────────────────────────────

export const WIDGET_KIND_REGISTRY = REGISTRY;

export const ALL_WIDGET_KINDS: ReadonlyArray<PortalTabWidgetKind> =
  PORTAL_TAB_WIDGET_KINDS;

export function getWidgetKindMetadata(
  kind: PortalTabWidgetKind,
): WidgetKindMetadata {
  const meta = REGISTRY[kind];
  if (!meta) {
    throw new Error(`[portal-genui] unknown widget kind '${kind}'`);
  }
  return meta;
}

/**
 * Returns a parsed widget config or throws — the renderer should
 * never receive raw user-typed config without going through this.
 */
export function parseWidgetConfig(widget: PortalTabWidget): unknown {
  const meta = getWidgetKindMetadata(widget.kind);
  if (widget.config === null) {
    return meta.defaultConfig;
  }
  return meta.configSchema.parse(widget.config);
}

/**
 * Construct a widget instance from the catalog's sample — useful in
 * the tab-builder preview before any user data exists.
 */
export function buildSampleWidget(
  kind: PortalTabWidgetKind,
  key: string,
  title: string,
): PortalTabWidget {
  const meta = getWidgetKindMetadata(kind);
  const base = {
    key,
    kind,
    title,
    span: 6,
    config: { ...meta.sampleConfig },
  } as PortalTabWidget;
  if (kind === 'genui_part') {
    return { ...base, genuiKind: 'kpi-grid' } as PortalTabWidget;
  }
  return base;
}
