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
  PART_SCHEMAS,
} from '../schemas';
import { quickVegaShapeCheck } from '../validate';
// NOTE: importing from '../registry' would transitively pull in
// react-vega / react-leaflet / @fullcalendar/react / react-pdf which
// are not installed until integration runs `pnpm install`. We test the
// registry shape lightly by enumerating PART_SCHEMAS keys instead.

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
  it('rejects column with malformed currency (lowercase / wrong length / digits)', () => {
    // Post-G-H13: currency contract is z.string().length(3).regex(/^[A-Z]{3}$/) —
    // accepts any ISO-4217 code (KES/TZS/USD/EUR/NGN/UGX/...) but rejects
    // lowercase, wrong-length, or numeric codes.
    for (const bad of ['kes', 'TZ', 'TZSS', '123', '']) {
      const r = DataTablePartSchema.safeParse({
        kind: 'data-table',
        columns: [
          { id: 'r', header: 'R', accessorKey: 'r', format: 'currency', currency: bad },
        ],
        rows: [],
      });
      expect(r.success, `currency '${bad}' should be rejected`).toBe(false);
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
  it('accepts well-formed payload with allowlisted action', () => {
    // Post-G-C4: action must match /api/gateway/forms/<form-id>[/<sub-action>]
    // where <form-id> matches [a-zA-Z0-9_-]+ (relative path or https URL).
    // Bare /api/tenants is rejected; dots are disallowed in form-id segment.
    const r = PrefillFormPartSchema.safeParse({
      kind: 'prefill-form',
      formId: 'tenant-create',
      schemaJson: { type: 'object', properties: { name: { type: 'string' } } },
      values: { name: 'Otieno' },
      action: '/api/gateway/forms/tenant-create',
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
  it('covers at least the 10 base primitive kinds (Tier-1)', () => {
    // ProdFix-7 expanded the catalogue from 10 → 22 (added kanban,
    // dashboard-grid, heatmap, markdown-card, prompt-suggestions,
    // evidence-card, tree, diff-view, gauge, metric-sparkline,
    // image-annotation, signature-pad). The assertion is an at-least
    // lower-bound so future Tier-3 additions don't break it.
    expect(Object.keys(PART_SCHEMAS).length).toBeGreaterThanOrEqual(10);
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
