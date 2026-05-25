/**
 * Generative-UI client-side schema validation tests.
 *
 * Three tests per primitive (3 × 10 = 30 tests, plus shared
 * registry/integration cases). The schemas are the render boundary
 * guard — every primitive `safeParse`s its own props before render.
 */

import { describe, it, expect } from 'vitest';

import {
  ChartVegaPartSchema,
  DataTablePartSchema,
  TimelinePartSchema,
  KpiGridPartSchema,
  PrefillFormPartSchema,
  ApprovalPartSchema,
  WorkflowPartSchema,
  MapPartSchema,
  CalendarPartSchema,
  FilePreviewPartSchema,
  // ProdFix-7
  KanbanPartSchema,
  DashboardGridPartSchema,
  HeatmapPartSchema,
  MarkdownCardPartSchema,
  PromptSuggestionsPartSchema,
  EvidenceCardPartSchema,
  TreePartSchema,
  DiffViewPartSchema,
  GaugePartSchema,
  MetricSparklinePartSchema,
  ImageAnnotationPartSchema,
  SignaturePadPartSchema,
  // Phase E.7
  PdfViewerPartSchema,
  SliderInputPartSchema,
  MultistepWizardPartSchema,
  MediaGridPartSchema,
  ChatEmbedPartSchema,
  LiveCounterPartSchema,
  OrgChartPartSchema,
  ComparisonTablePartSchema,
  GeoFencePartSchema,
  NotificationToastPartSchema,
  DecisionTracePartSchema,
  CodeBlockPartSchema,
  DataflowDiagramPartSchema,
  PART_SCHEMAS,
} from '../schemas';
import { quickVegaShapeCheck } from '../validate';
// NOTE: importing from '../registry' would transitively pull in
// react-vega / react-leaflet / @fullcalendar/react / react-pdf which
// are peer dependencies of the consuming app. We test the registry
// shape lightly by enumerating PART_SCHEMAS keys instead.

// ─────────────────────────────────────────────────────────────────────
// 1. chart-vega
// ─────────────────────────────────────────────────────────────────────

describe('client schemas — chart-vega', () => {
  it('accepts a valid bar-chart spec', () => {
    const r = ChartVegaPartSchema.safeParse({
      kind: 'chart-vega',
      spec: { mark: 'bar', encoding: {} },
      data: [{ x: 1 }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects payloads missing data', () => {
    const r = ChartVegaPartSchema.safeParse({
      kind: 'chart-vega',
      spec: { mark: 'bar' },
    });
    expect(r.success).toBe(false);
  });
  it('quickVegaShapeCheck flags specs missing mark+composition', () => {
    expect(quickVegaShapeCheck({})).toBe(false);
    expect(quickVegaShapeCheck({ mark: 'bar' })).toBe(true);
    expect(quickVegaShapeCheck({ layer: [] })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. data-table
// ─────────────────────────────────────────────────────────────────────

describe('client schemas — data-table', () => {
  it('accepts well-formed columns + rows', () => {
    const r = DataTablePartSchema.safeParse({
      kind: 'data-table',
      columns: [{ id: 'x', header: 'X', accessorKey: 'x' }],
      rows: [{ x: 1 }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects empty columns', () => {
    const r = DataTablePartSchema.safeParse({
      kind: 'data-table',
      columns: [],
      rows: [],
    });
    expect(r.success).toBe(false);
  });
  it('accepts any ISO-4217 currency code (H13 — no jurisdiction hardcoding)', () => {
    // EUR, NGN, UGX, RWF, ZAR, GHS used to be rejected by the old
    // `z.enum(['KES','TZS','USD'])`. The platform is built for the world
    // starting with TZ — currency must not be hardcoded.
    for (const currency of ['EUR', 'NGN', 'UGX', 'RWF', 'ZAR', 'GHS', 'KES', 'USD']) {
      const r = DataTablePartSchema.safeParse({
        kind: 'data-table',
        columns: [
          { id: 'r', header: 'R', accessorKey: 'r', format: 'currency', currency },
        ],
        rows: [],
      });
      expect(r.success).toBe(true);
    }
  });

  it('rejects malformed currency codes (lowercase, wrong length, digits)', () => {
    for (const currency of ['eur', 'EU', 'EURO', 'US1', '123']) {
      const r = DataTablePartSchema.safeParse({
        kind: 'data-table',
        columns: [
          { id: 'r', header: 'R', accessorKey: 'r', format: 'currency', currency },
        ],
        rows: [],
      });
      expect(r.success).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. timeline
// ─────────────────────────────────────────────────────────────────────

describe('client schemas — timeline', () => {
  it('accepts ISO-8601 timestamps', () => {
    const r = TimelinePartSchema.safeParse({
      kind: 'timeline',
      events: [{ timestamp: '2026-05-15T00:00:00Z', title: 'ok' }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects non-ISO timestamps', () => {
    const r = TimelinePartSchema.safeParse({
      kind: 'timeline',
      events: [{ timestamp: 'never', title: 'bad' }],
    });
    expect(r.success).toBe(false);
  });
  it('rejects empty events list', () => {
    const r = TimelinePartSchema.safeParse({ kind: 'timeline', events: [] });
    expect(r.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. kpi-grid
// ─────────────────────────────────────────────────────────────────────

describe('client schemas — kpi-grid', () => {
  it('accepts a percent tile without currency', () => {
    const r = KpiGridPartSchema.safeParse({
      kind: 'kpi-grid',
      tiles: [{ label: 'Occupancy', value: 0.94, format: 'percent' }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects unknown format', () => {
    const r = KpiGridPartSchema.safeParse({
      kind: 'kpi-grid',
      tiles: [{ label: 'X', value: 1, format: 'unicorn' }],
    });
    expect(r.success).toBe(false);
  });
  it('rejects empty tiles array', () => {
    const r = KpiGridPartSchema.safeParse({ kind: 'kpi-grid', tiles: [] });
    expect(r.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. prefill-form
// ─────────────────────────────────────────────────────────────────────

describe('client schemas — prefill-form', () => {
  it('accepts well-formed payload with allowed action path', () => {
    const r = PrefillFormPartSchema.safeParse({
      kind: 'prefill-form',
      formId: 'tenant-create',
      schemaJson: { type: 'object', properties: { name: { type: 'string' } } },
      values: { name: 'Otieno' },
      action: '/api/gateway/forms/tenant-create',
    });
    expect(r.success).toBe(true);
  });
  it('accepts a sub-action variant like /draft', () => {
    const r = PrefillFormPartSchema.safeParse({
      kind: 'prefill-form',
      formId: 'tenant-create',
      schemaJson: {},
      values: {},
      action: '/api/gateway/forms/tenant-create/draft',
    });
    expect(r.success).toBe(true);
  });
  it('accepts an absolute https form action on a same-origin host', () => {
    const r = PrefillFormPartSchema.safeParse({
      kind: 'prefill-form',
      formId: 'tenant-create',
      schemaJson: {},
      values: {},
      action: 'https://app.borjie.com/api/gateway/forms/tenant-create',
    });
    expect(r.success).toBe(true);
  });
  it('rejects missing schemaJson', () => {
    const r = PrefillFormPartSchema.safeParse({
      kind: 'prefill-form',
      formId: 'x',
      values: {},
      action: '/api/gateway/forms/x',
    });
    expect(r.success).toBe(false);
  });
  it('rejects missing action', () => {
    const r = PrefillFormPartSchema.safeParse({
      kind: 'prefill-form',
      formId: 'x',
      schemaJson: {},
      values: {},
    });
    expect(r.success).toBe(false);
  });
  it('rejects an arbitrary internal admin path (C4 CSRF guard)', () => {
    const r = PrefillFormPartSchema.safeParse({
      kind: 'prefill-form',
      formId: 'x',
      schemaJson: {},
      values: {},
      action: '/api/internal/admin-revoke-grant?u=ALL',
    });
    expect(r.success).toBe(false);
  });
  it('rejects javascript: / data: / file: schemes (C4)', () => {
    for (const action of [
      // eslint-disable-next-line no-script-url -- intentional: XSS regression test asserts schema REJECTS dangerous schemes
      'javascript:alert(1)',
      'data:text/html,<script>x</script>',
      'file:///etc/passwd',
    ]) {
      const r = PrefillFormPartSchema.safeParse({
        kind: 'prefill-form',
        formId: 'x',
        schemaJson: {},
        values: {},
        action,
      });
      expect(r.success).toBe(false);
    }
  });
  it('rejects path-traversal attempts (C4)', () => {
    for (const action of [
      '/api/gateway/forms/../internal/admin',
      '/api/gateway/forms/x?u=ALL',
      '/api/gateway/forms/x#fragment',
    ]) {
      const r = PrefillFormPartSchema.safeParse({
        kind: 'prefill-form',
        formId: 'x',
        schemaJson: {},
        values: {},
        action,
      });
      expect(r.success).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. approval
// ─────────────────────────────────────────────────────────────────────

describe('client schemas — approval', () => {
  const checklist = ['a', 'b', 'c', 'd', 'e'];
  it('accepts full 5-item checklist', () => {
    const r = ApprovalPartSchema.safeParse({
      kind: 'approval',
      action: 'x',
      payload: {},
      diff: {},
      checklist,
    });
    expect(r.success).toBe(true);
  });
  it('rejects 4-item checklist', () => {
    const r = ApprovalPartSchema.safeParse({
      kind: 'approval',
      action: 'x',
      payload: {},
      diff: {},
      checklist: ['a', 'b', 'c', 'd'],
    });
    expect(r.success).toBe(false);
  });
  it('rejects 6-item checklist', () => {
    const r = ApprovalPartSchema.safeParse({
      kind: 'approval',
      action: 'x',
      payload: {},
      diff: {},
      checklist: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(r.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. workflow
// ─────────────────────────────────────────────────────────────────────

describe('client schemas — workflow', () => {
  it('accepts valid steps', () => {
    const r = WorkflowPartSchema.safeParse({
      kind: 'workflow',
      steps: [{ label: 'A', status: 'done' }],
      currentIndex: 0,
    });
    expect(r.success).toBe(true);
  });
  it('rejects invalid status', () => {
    const r = WorkflowPartSchema.safeParse({
      kind: 'workflow',
      steps: [{ label: 'A', status: 'paused' }],
      currentIndex: 0,
    });
    expect(r.success).toBe(false);
  });
  it('rejects negative currentIndex', () => {
    const r = WorkflowPartSchema.safeParse({
      kind: 'workflow',
      steps: [{ label: 'A', status: 'done' }],
      currentIndex: -1,
    });
    expect(r.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. map
// ─────────────────────────────────────────────────────────────────────

describe('client schemas — map', () => {
  it('accepts coordinates in TZ', () => {
    const r = MapPartSchema.safeParse({
      kind: 'map',
      center: [-6.7924, 39.2083],
      zoom: 12,
      markers: [{ position: [-6.79, 39.2], popup: 'HQ' }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects out-of-range latitude', () => {
    const r = MapPartSchema.safeParse({
      kind: 'map',
      center: [91, 0],
      zoom: 10,
      markers: [],
    });
    expect(r.success).toBe(false);
  });
  it('rejects zoom > 20', () => {
    const r = MapPartSchema.safeParse({
      kind: 'map',
      center: [0, 0],
      zoom: 21,
      markers: [],
    });
    expect(r.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9. calendar
// ─────────────────────────────────────────────────────────────────────

describe('client schemas — calendar', () => {
  it('accepts a valid event', () => {
    const r = CalendarPartSchema.safeParse({
      kind: 'calendar',
      events: [{ id: 'e1', title: 'Lease renewal', start: '2026-06-01T09:00:00Z' }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects invalid start time', () => {
    const r = CalendarPartSchema.safeParse({
      kind: 'calendar',
      events: [{ id: 'e1', title: 'x', start: 'noon' }],
    });
    expect(r.success).toBe(false);
  });
  it('rejects non-hex colour', () => {
    const r = CalendarPartSchema.safeParse({
      kind: 'calendar',
      events: [
        { id: 'e', title: 'x', start: '2026-01-01T00:00:00Z', color: 'sky-blue' },
      ],
    });
    expect(r.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 10. file-preview
// ─────────────────────────────────────────────────────────────────────

describe('client schemas — file-preview', () => {
  it('accepts an http URL', () => {
    const r = FilePreviewPartSchema.safeParse({
      kind: 'file-preview',
      url: 'https://example.com/x.pdf',
      mimeType: 'application/pdf',
      name: 'x.pdf',
    });
    expect(r.success).toBe(true);
  });
  it('rejects file://', () => {
    const r = FilePreviewPartSchema.safeParse({
      kind: 'file-preview',
      url: 'file:///etc/passwd',
      mimeType: 'text/plain',
      name: 'p',
    });
    expect(r.success).toBe(false);
  });
  it('rejects missing mimeType', () => {
    const r = FilePreviewPartSchema.safeParse({
      kind: 'file-preview',
      url: '/x.pdf',
      name: 'x.pdf',
    });
    expect(r.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Registry / integration
// ─────────────────────────────────────────────────────────────────────

describe('genui PART_SCHEMAS surface', () => {
  it('covers exactly 35 primitive kinds (10 original + 12 ProdFix-7 + 13 Phase E.7)', () => {
    expect(Object.keys(PART_SCHEMAS)).toHaveLength(35);
  });

  it('covers every primitive the brain can emit', () => {
    const expected = [
      'chart-vega',
      'data-table',
      'timeline',
      'kpi-grid',
      'prefill-form',
      'approval',
      'workflow',
      'map',
      'calendar',
      'file-preview',
      // ProdFix-7
      'kanban',
      'dashboard-grid',
      'heatmap',
      'markdown-card',
      'prompt-suggestions',
      'evidence-card',
      'tree',
      'diff-view',
      'gauge',
      'metric-sparkline',
      'image-annotation',
      'signature-pad',
      // Phase E.7
      'pdf-viewer',
      'slider-input',
      'multistep-wizard',
      'media-grid',
      'chat-embed',
      'live-counter',
      'org-chart',
      'comparison-table',
      'geo-fence',
      'notification-toast',
      'decision-trace',
      'code-block',
      'dataflow-diagram',
    ];
    for (const k of expected) {
      expect(PART_SCHEMAS[k as keyof typeof PART_SCHEMAS]).toBeDefined();
    }
  });

  it('every schema is a Zod schema', () => {
    for (const k of Object.keys(PART_SCHEMAS)) {
      const s = PART_SCHEMAS[k as keyof typeof PART_SCHEMAS];
      expect(typeof (s as { safeParse?: unknown }).safeParse).toBe('function');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
// ProdFix-7 — 12 new client schemas
// ═════════════════════════════════════════════════════════════════════

describe('client schemas — kanban', () => {
  it('accepts a valid board', () => {
    const r = KanbanPartSchema.safeParse({
      kind: 'kanban',
      columns: [{ id: 'a', title: 'A', cards: [{ id: 'c1', title: 'X' }] }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects > 8 columns', () => {
    const cols = Array.from({ length: 9 }, (_, i) => ({
      id: `c${i}`,
      title: `${i}`,
      cards: [],
    }));
    const r = KanbanPartSchema.safeParse({ kind: 'kanban', columns: cols });
    expect(r.success).toBe(false);
  });
  it('rejects card missing title', () => {
    const r = KanbanPartSchema.safeParse({
      kind: 'kanban',
      columns: [{ id: 'a', title: 'A', cards: [{ id: 'c1' }] }],
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — dashboard-grid', () => {
  it('accepts well-formed cells', () => {
    const r = DashboardGridPartSchema.safeParse({
      kind: 'dashboard-grid',
      cells: [{ span: 6, part: { kind: 'kpi-grid' } }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects span > 12', () => {
    const r = DashboardGridPartSchema.safeParse({
      kind: 'dashboard-grid',
      cells: [{ span: 14, part: { kind: 'kpi-grid' } }],
    });
    expect(r.success).toBe(false);
  });
  it('rejects inner part missing kind', () => {
    const r = DashboardGridPartSchema.safeParse({
      kind: 'dashboard-grid',
      cells: [{ span: 6, part: {} }],
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — heatmap', () => {
  it('accepts a valid matrix', () => {
    const r = HeatmapPartSchema.safeParse({
      kind: 'heatmap',
      xAxis: ['x'],
      yAxis: ['a', 'b'],
      cells: [[1], [2]],
      colorScale: 'linear',
      format: 'count',
    });
    expect(r.success).toBe(true);
  });
  it('rejects mismatched cells/yAxis length', () => {
    const r = HeatmapPartSchema.safeParse({
      kind: 'heatmap',
      xAxis: ['x'],
      yAxis: ['a', 'b'],
      cells: [[1]],
      colorScale: 'linear',
      format: 'count',
    });
    expect(r.success).toBe(false);
  });
  it('rejects currency format without currency', () => {
    const r = HeatmapPartSchema.safeParse({
      kind: 'heatmap',
      xAxis: ['x'],
      yAxis: ['a'],
      cells: [[1]],
      colorScale: 'linear',
      format: 'currency',
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — markdown-card', () => {
  it('accepts a card with citations', () => {
    const r = MarkdownCardPartSchema.safeParse({
      kind: 'markdown-card',
      markdown: 'Hello [cite:a].',
      citations: [{ id: 'a', label: 'Source A' }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects empty markdown', () => {
    const r = MarkdownCardPartSchema.safeParse({
      kind: 'markdown-card',
      markdown: '',
    });
    expect(r.success).toBe(false);
  });
  it('rejects unknown severity', () => {
    const r = MarkdownCardPartSchema.safeParse({
      kind: 'markdown-card',
      markdown: 'x',
      severity: 'panic',
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — prompt-suggestions', () => {
  it('accepts valid suggestions', () => {
    const r = PromptSuggestionsPartSchema.safeParse({
      kind: 'prompt-suggestions',
      suggestions: [{ label: 'X', prompt: 'do x', kind: 'primary' }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects > 12 suggestions', () => {
    const sugg = Array.from({ length: 13 }, (_, i) => ({
      label: `L${i}`,
      prompt: `p${i}`,
      kind: 'secondary' as const,
    }));
    const r = PromptSuggestionsPartSchema.safeParse({
      kind: 'prompt-suggestions',
      suggestions: sugg,
    });
    expect(r.success).toBe(false);
  });
  it('rejects unknown kind', () => {
    const r = PromptSuggestionsPartSchema.safeParse({
      kind: 'prompt-suggestions',
      suggestions: [{ label: 'X', prompt: 'p', kind: 'fancy' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — evidence-card', () => {
  it('accepts a valid quote + source', () => {
    const r = EvidenceCardPartSchema.safeParse({
      kind: 'evidence-card',
      quote: 'Rent is due',
      sourceTitle: 'Lease',
    });
    expect(r.success).toBe(true);
  });
  it('rejects empty quote', () => {
    const r = EvidenceCardPartSchema.safeParse({
      kind: 'evidence-card',
      quote: '',
      sourceTitle: 'L',
    });
    expect(r.success).toBe(false);
  });
  it('rejects unknown confidence', () => {
    const r = EvidenceCardPartSchema.safeParse({
      kind: 'evidence-card',
      quote: 'q',
      sourceTitle: 's',
      confidence: 'absolute',
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — tree', () => {
  it('accepts a nested tree', () => {
    const r = TreePartSchema.safeParse({
      kind: 'tree',
      root: { id: 'p', label: 'Portfolio', children: [{ id: 'b', label: 'Bldg 1' }] },
    });
    expect(r.success).toBe(true);
  });
  it('rejects node missing id', () => {
    const r = TreePartSchema.safeParse({
      kind: 'tree',
      root: { label: 'P' },
    });
    expect(r.success).toBe(false);
  });
  it('rejects unknown action kind', () => {
    const r = TreePartSchema.safeParse({
      kind: 'tree',
      root: { id: 'p', label: 'P', onClickAction: { kind: 'jump', payload: {} } },
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — diff-view', () => {
  it('accepts a valid diff', () => {
    const r = DiffViewPartSchema.safeParse({
      kind: 'diff-view',
      left: 'a',
      right: 'b',
      leftLabel: 'L',
      rightLabel: 'R',
      mode: 'unified',
    });
    expect(r.success).toBe(true);
  });
  it('rejects missing rightLabel', () => {
    const r = DiffViewPartSchema.safeParse({
      kind: 'diff-view',
      left: 'a',
      right: 'b',
      leftLabel: 'L',
      mode: 'unified',
    });
    expect(r.success).toBe(false);
  });
  it('rejects unknown mode', () => {
    const r = DiffViewPartSchema.safeParse({
      kind: 'diff-view',
      left: 'a',
      right: 'b',
      leftLabel: 'L',
      rightLabel: 'R',
      mode: 'overlay',
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — gauge', () => {
  it('accepts a valid percent gauge', () => {
    const r = GaugePartSchema.safeParse({
      kind: 'gauge',
      value: 0.5,
      min: 0,
      max: 1,
      label: 'X',
      format: 'percent',
    });
    expect(r.success).toBe(true);
  });
  it('rejects min >= max', () => {
    const r = GaugePartSchema.safeParse({
      kind: 'gauge',
      value: 1,
      min: 10,
      max: 5,
      label: 'X',
    });
    expect(r.success).toBe(false);
  });
  it('rejects currency format without currency', () => {
    const r = GaugePartSchema.safeParse({
      kind: 'gauge',
      value: 100,
      min: 0,
      max: 1000,
      label: 'NOI',
      format: 'currency',
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — metric-sparkline', () => {
  it('accepts a valid metric', () => {
    const r = MetricSparklinePartSchema.safeParse({
      kind: 'metric-sparkline',
      label: 'MoM',
      value: 1,
      format: 'number',
      sparkline: [1, 2, 3],
    });
    expect(r.success).toBe(true);
  });
  it('rejects sparkline < 2 points', () => {
    const r = MetricSparklinePartSchema.safeParse({
      kind: 'metric-sparkline',
      label: 'x',
      value: 1,
      format: 'number',
      sparkline: [1],
    });
    expect(r.success).toBe(false);
  });
  it('rejects currency format without currency', () => {
    const r = MetricSparklinePartSchema.safeParse({
      kind: 'metric-sparkline',
      label: 'x',
      value: 1,
      format: 'currency',
      sparkline: [1, 2],
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — image-annotation', () => {
  it('accepts valid annotations', () => {
    const r = ImageAnnotationPartSchema.safeParse({
      kind: 'image-annotation',
      imageUrl: 'https://x/y.png',
      annotations: [{ x: 0.2, y: 0.3, label: 'crack', severity: 'warning' }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects file:// imageUrl', () => {
    const r = ImageAnnotationPartSchema.safeParse({
      kind: 'image-annotation',
      imageUrl: 'file:///etc/x.png',
      annotations: [],
    });
    expect(r.success).toBe(false);
  });
  it('rejects out-of-range coords', () => {
    const r = ImageAnnotationPartSchema.safeParse({
      kind: 'image-annotation',
      imageUrl: 'https://x/y.png',
      annotations: [{ x: 1.5, y: 0.3, label: 'oops', severity: 'info' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — signature-pad', () => {
  it('accepts valid signature config', () => {
    const r = SignaturePadPartSchema.safeParse({
      kind: 'signature-pad',
      prompt: 'sign here',
      requiredFor: 'lease renewal',
      onSubmitAction: { kind: 'tool', payload: { tool: 'lease.sign' } },
    });
    expect(r.success).toBe(true);
  });
  it('rejects empty prompt', () => {
    const r = SignaturePadPartSchema.safeParse({
      kind: 'signature-pad',
      prompt: '',
      requiredFor: 'x',
      onSubmitAction: { kind: 'tool', payload: {} },
    });
    expect(r.success).toBe(false);
  });
  it('rejects unknown action kind', () => {
    const r = SignaturePadPartSchema.safeParse({
      kind: 'signature-pad',
      prompt: 'p',
      requiredFor: 'x',
      onSubmitAction: { kind: 'submit', payload: {} },
    });
    expect(r.success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════
// Phase E.7 — 13 new client schemas (3 tests each)
// ═════════════════════════════════════════════════════════════════════

describe('client schemas — pdf-viewer', () => {
  it('accepts a valid http URL', () => {
    const r = PdfViewerPartSchema.safeParse({
      kind: 'pdf-viewer',
      url: 'https://example.com/x.pdf',
      name: 'x.pdf',
    });
    expect(r.success).toBe(true);
  });
  it('rejects file:// URL', () => {
    const r = PdfViewerPartSchema.safeParse({
      kind: 'pdf-viewer',
      url: 'file:///etc/passwd',
      name: 'x',
    });
    expect(r.success).toBe(false);
  });
  it('rejects missing name', () => {
    const r = PdfViewerPartSchema.safeParse({
      kind: 'pdf-viewer',
      url: '/lease.pdf',
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — slider-input', () => {
  it('accepts a valid slider config', () => {
    const r = SliderInputPartSchema.safeParse({
      kind: 'slider-input',
      label: 'Rent offer',
      min: 100,
      max: 1000,
      value: 500,
      onChangeAction: { kind: 'tool', payload: {} },
    });
    expect(r.success).toBe(true);
  });
  it('rejects min >= max', () => {
    const r = SliderInputPartSchema.safeParse({
      kind: 'slider-input',
      label: 'X',
      min: 1000,
      max: 100,
      value: 500,
      onChangeAction: { kind: 'tool', payload: {} },
    });
    expect(r.success).toBe(false);
  });
  it('rejects currency format without currency', () => {
    const r = SliderInputPartSchema.safeParse({
      kind: 'slider-input',
      label: 'X',
      min: 0,
      max: 100,
      value: 50,
      format: 'currency',
      onChangeAction: { kind: 'tool', payload: {} },
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — multistep-wizard', () => {
  it('accepts a valid wizard', () => {
    const r = MultistepWizardPartSchema.safeParse({
      kind: 'multistep-wizard',
      steps: [{ id: 's1', title: 'Step 1', fields: [] }],
      onSubmitAction: '/api/x',
    });
    expect(r.success).toBe(true);
  });
  it('rejects empty steps', () => {
    const r = MultistepWizardPartSchema.safeParse({
      kind: 'multistep-wizard',
      steps: [],
      onSubmitAction: '/api/x',
    });
    expect(r.success).toBe(false);
  });
  it('rejects missing onSubmitAction', () => {
    const r = MultistepWizardPartSchema.safeParse({
      kind: 'multistep-wizard',
      steps: [{ id: 's1', title: 'x', fields: [] }],
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — media-grid', () => {
  it('accepts a valid item list', () => {
    const r = MediaGridPartSchema.safeParse({
      kind: 'media-grid',
      items: [{ id: 'a', url: 'https://x/y.jpg' }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects empty items', () => {
    const r = MediaGridPartSchema.safeParse({ kind: 'media-grid', items: [] });
    expect(r.success).toBe(false);
  });
  it('rejects file:// url', () => {
    const r = MediaGridPartSchema.safeParse({
      kind: 'media-grid',
      items: [{ id: 'a', url: 'file:///etc/x.jpg' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — chat-embed', () => {
  it('accepts a valid scope', () => {
    const r = ChatEmbedPartSchema.safeParse({
      kind: 'chat-embed',
      scope: 'arrears.case.123',
    });
    expect(r.success).toBe(true);
  });
  it('rejects empty scope', () => {
    const r = ChatEmbedPartSchema.safeParse({ kind: 'chat-embed', scope: '' });
    expect(r.success).toBe(false);
  });
  it('rejects unknown message role', () => {
    const r = ChatEmbedPartSchema.safeParse({
      kind: 'chat-embed',
      scope: 'x',
      initialMessages: [{ role: 'mod', text: 'hi' }],
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — live-counter', () => {
  it('accepts a valid counter', () => {
    const r = LiveCounterPartSchema.safeParse({
      kind: 'live-counter',
      label: 'Queue depth',
      value: 42,
    });
    expect(r.success).toBe(true);
  });
  it('rejects unknown trend', () => {
    const r = LiveCounterPartSchema.safeParse({
      kind: 'live-counter',
      label: 'x',
      value: 1,
      trend: 'sideways',
    });
    expect(r.success).toBe(false);
  });
  it('rejects empty label', () => {
    const r = LiveCounterPartSchema.safeParse({
      kind: 'live-counter',
      label: '',
      value: 1,
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — org-chart', () => {
  it('accepts a nested chart', () => {
    const r = OrgChartPartSchema.safeParse({
      kind: 'org-chart',
      root: { id: 'r', label: 'Owner', children: [{ id: 'p', label: 'Property' }] },
    });
    expect(r.success).toBe(true);
  });
  it('rejects node missing id', () => {
    const r = OrgChartPartSchema.safeParse({
      kind: 'org-chart',
      root: { label: 'X' },
    });
    expect(r.success).toBe(false);
  });
  it('rejects unknown orientation', () => {
    const r = OrgChartPartSchema.safeParse({
      kind: 'org-chart',
      root: { id: 'r', label: 'X' },
      orientation: 'diagonal',
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — comparison-table', () => {
  it('accepts valid columns + rows', () => {
    const r = ComparisonTablePartSchema.safeParse({
      kind: 'comparison-table',
      columns: ['Unit A', 'Unit B'],
      rows: [{ key: 'rent', label: 'Rent', values: [1000, 1100] }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects fewer than 2 columns', () => {
    const r = ComparisonTablePartSchema.safeParse({
      kind: 'comparison-table',
      columns: ['Only'],
      rows: [{ key: 'r', label: 'R', values: [1] }],
    });
    expect(r.success).toBe(false);
  });
  it('rejects empty rows', () => {
    const r = ComparisonTablePartSchema.safeParse({
      kind: 'comparison-table',
      columns: ['A', 'B'],
      rows: [],
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — geo-fence', () => {
  it('accepts valid center + fence', () => {
    const r = GeoFencePartSchema.safeParse({
      kind: 'geo-fence',
      center: [-6.79, 39.2],
      zoom: 14,
      fence: [{ lat: -6.79, lng: 39.2 }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects out-of-range latitude in fence', () => {
    const r = GeoFencePartSchema.safeParse({
      kind: 'geo-fence',
      center: [0, 0],
      zoom: 14,
      fence: [{ lat: 91, lng: 0 }],
    });
    expect(r.success).toBe(false);
  });
  it('rejects invalid zoom', () => {
    const r = GeoFencePartSchema.safeParse({
      kind: 'geo-fence',
      center: [0, 0],
      zoom: 99,
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — notification-toast', () => {
  it('accepts valid toast', () => {
    const r = NotificationToastPartSchema.safeParse({
      kind: 'notification-toast',
      message: 'Saved',
      severity: 'success',
    });
    expect(r.success).toBe(true);
  });
  it('rejects unknown severity', () => {
    const r = NotificationToastPartSchema.safeParse({
      kind: 'notification-toast',
      message: 'x',
      severity: 'panic',
    });
    expect(r.success).toBe(false);
  });
  it('rejects empty message', () => {
    const r = NotificationToastPartSchema.safeParse({
      kind: 'notification-toast',
      message: '',
      severity: 'info',
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — decision-trace', () => {
  it('accepts a valid trace', () => {
    const r = DecisionTracePartSchema.safeParse({
      kind: 'decision-trace',
      steps: [
        { id: 's1', title: 'observed arrears', rationale: 'past due 30+', kind: 'observation' },
      ],
    });
    expect(r.success).toBe(true);
  });
  it('rejects unknown step kind', () => {
    const r = DecisionTracePartSchema.safeParse({
      kind: 'decision-trace',
      steps: [{ id: 's', title: 't', rationale: 'r', kind: 'hunch' }],
    });
    expect(r.success).toBe(false);
  });
  it('rejects empty steps', () => {
    const r = DecisionTracePartSchema.safeParse({
      kind: 'decision-trace',
      steps: [],
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — code-block', () => {
  it('accepts SQL code', () => {
    const r = CodeBlockPartSchema.safeParse({
      kind: 'code-block',
      code: 'SELECT 1',
      language: 'sql',
    });
    expect(r.success).toBe(true);
  });
  it('rejects unknown language', () => {
    const r = CodeBlockPartSchema.safeParse({
      kind: 'code-block',
      code: 'x',
      language: 'cobol',
    });
    expect(r.success).toBe(false);
  });
  it('rejects empty code', () => {
    const r = CodeBlockPartSchema.safeParse({
      kind: 'code-block',
      code: '',
      language: 'text',
    });
    expect(r.success).toBe(false);
  });
});

describe('client schemas — dataflow-diagram', () => {
  it('accepts valid nodes + edges', () => {
    const r = DataflowDiagramPartSchema.safeParse({
      kind: 'dataflow-diagram',
      nodes: [
        { id: 'src', label: 'Lease feed', kind: 'source' },
        { id: 'snk', label: 'Statements', kind: 'sink' },
      ],
      edges: [{ from: 'src', to: 'snk' }],
    });
    expect(r.success).toBe(true);
  });
  it('rejects unknown node kind', () => {
    const r = DataflowDiagramPartSchema.safeParse({
      kind: 'dataflow-diagram',
      nodes: [{ id: 'x', label: 'X', kind: 'cosmic' }],
      edges: [],
    });
    expect(r.success).toBe(false);
  });
  it('rejects empty nodes', () => {
    const r = DataflowDiagramPartSchema.safeParse({
      kind: 'dataflow-diagram',
      nodes: [],
      edges: [],
    });
    expect(r.success).toBe(false);
  });
});
