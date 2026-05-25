/**
 * Render-block tools — payload validation + emission tests.
 *
 * Three assertions per primitive (3 × 10 = 30 tests, plus shared cases):
 *   1. happy path → outcome.kind === 'ok' with the validated UiPart
 *   2. invalid payload → outcome.kind === 'error' (Zod-rejected)
 *   3. primitive-specific guard (ajv for chart-vega, action URL for
 *      prefill-form, currency-when-format for kpi-grid, etc.)
 */

import { describe, it, expect } from 'vitest';

import type { ScopeContext, Tool, ToolOutcome } from '../../../../types.js';
import {
  createRenderBlockTools,
  renderChartVegaTool,
  renderDataTableTool,
  renderTimelineTool,
  renderKpiGridTool,
  renderPrefillFormTool,
  renderApprovalTool,
  renderWorkflowTool,
  renderMapTool,
  renderCalendarTool,
  renderFilePreviewTool,
  renderKanbanTool,
  renderDashboardGridTool,
  renderHeatmapTool,
  renderMarkdownCardTool,
  renderPromptSuggestionsTool,
  renderEvidenceCardTool,
  renderTreeTool,
  renderDiffViewTool,
  renderGaugeTool,
  renderMetricSparklineTool,
  renderImageAnnotationTool,
  renderSignaturePadTool,
} from '../tools.js';
import { validateVegaSpec } from '../validate.js';

const CTX: ScopeContext = {
  kind: 'platform',
  actorUserId: 'u_admin',
  roles: ['platform-sovereign'],
  personaId: 'platform-sovereign',
};

function call<I, O>(tool: Tool<I, O>, input: unknown): Promise<ToolOutcome<O>> {
  return tool.invoke({ toolName: tool.name, input: input as I, ctx: CTX });
}

function expectOk<O>(outcome: ToolOutcome<O>): asserts outcome is Extract<
  ToolOutcome<O>,
  { kind: 'ok' }
> {
  if (outcome.kind !== 'ok') {
    throw new Error(`expected ok outcome, got error: ${outcome.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 1. chart-vega
// ─────────────────────────────────────────────────────────────────────

describe('render-blocks.chart-vega', () => {
  const validSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    mark: 'bar',
    encoding: {
      x: { field: 'month', type: 'ordinal' },
      y: { field: 'arrears', type: 'quantitative' },
    },
  };
  const rows = [
    { month: 'Jan', arrears: 1200 },
    { month: 'Feb', arrears: 980 },
  ];

  it('emits a valid UiPart for a well-formed spec', async () => {
    const outcome = await call(renderChartVegaTool, { spec: validSpec, data: rows });
    expectOk(outcome);
    expect(outcome.output.kind).toBe('chart-vega');
    expect(outcome.output.data).toHaveLength(2);
  });

  it('rejects payloads with missing required fields', async () => {
    const outcome = await call(renderChartVegaTool, { spec: validSpec });
    expect(outcome.kind).toBe('error');
  });

  it('rejects spec with no mark (ajv structural check)', async () => {
    const badSpec = { encoding: { x: { field: 'm', type: 'ordinal' } } };
    const outcome = await call(renderChartVegaTool, { spec: badSpec, data: rows });
    expect(outcome.kind).toBe('error');
    if (outcome.kind === 'error') {
      expect(outcome.message).toContain('chart-vega');
    }
  });

  it('rejects spec with non-enum mark string', async () => {
    const badSpec = { mark: 'sunburst', encoding: {} };
    const outcome = await call(renderChartVegaTool, { spec: badSpec, data: [] });
    expect(outcome.kind).toBe('error');
  });

  it('validateVegaSpec returns ok=true for layered specs without mark+encoding', () => {
    const layered = { layer: [{ mark: 'bar', encoding: {} }] };
    expect(validateVegaSpec(layered).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. data-table
// ─────────────────────────────────────────────────────────────────────

describe('render-blocks.data-table', () => {
  const cols = [
    { id: 'name', header: 'Name', accessorKey: 'name' },
    { id: 'rent', header: 'Rent', accessorKey: 'rent', format: 'currency' as const, currency: 'KES' as const },
  ];
  const rows = [{ name: 'Otieno', rent: 45000 }];

  it('emits a UiPart for valid columns+rows', async () => {
    const outcome = await call(renderDataTableTool, { columns: cols, rows });
    expectOk(outcome);
    expect(outcome.output.columns).toHaveLength(2);
  });

  it('rejects empty columns array', async () => {
    const outcome = await call(renderDataTableTool, { columns: [], rows });
    expect(outcome.kind).toBe('error');
  });

  it('rejects column with unknown format', async () => {
    const outcome = await call(renderDataTableTool, {
      columns: [{ id: 'x', header: 'X', accessorKey: 'x', format: 'jpeg' }],
      rows: [],
    });
    expect(outcome.kind).toBe('error');
  });

  it('accepts any ISO-4217 currency code (EUR, ZAR, NGN)', async () => {
    for (const code of ['EUR', 'ZAR', 'NGN'] as const) {
      const outcome = await call(renderDataTableTool, {
        columns: [
          { id: 'amt', header: 'Amount', accessorKey: 'amt', format: 'currency', currency: code },
        ],
        rows: [{ amt: 100 }],
      });
      expectOk(outcome);
    }
  });

  it('rejects currency that is not 3 upper-case letters', async () => {
    const outcome = await call(renderDataTableTool, {
      columns: [
        { id: 'amt', header: 'Amount', accessorKey: 'amt', format: 'currency', currency: 'kes' },
      ],
      rows: [],
    });
    expect(outcome.kind).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. timeline
// ─────────────────────────────────────────────────────────────────────

describe('render-blocks.timeline', () => {
  it('emits a UiPart for valid events', async () => {
    const outcome = await call(renderTimelineTool, {
      events: [
        { timestamp: '2026-01-01T00:00:00Z', title: 'Tenant onboarded' },
        { timestamp: '2026-02-01T00:00:00Z', title: 'Payment received', severity: 'success' },
      ],
    });
    expectOk(outcome);
    expect(outcome.output.events).toHaveLength(2);
  });

  it('rejects events with invalid ISO timestamp', async () => {
    const outcome = await call(renderTimelineTool, {
      events: [{ timestamp: 'last tuesday', title: 'oops' }],
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects empty events array', async () => {
    const outcome = await call(renderTimelineTool, { events: [] });
    expect(outcome.kind).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. kpi-grid
// ─────────────────────────────────────────────────────────────────────

describe('render-blocks.kpi-grid', () => {
  it('emits a UiPart for valid tiles', async () => {
    const outcome = await call(renderKpiGridTool, {
      tiles: [
        { label: 'Collected', value: 1_250_000, format: 'currency', currency: 'KES' },
        { label: 'Occupancy', value: 0.94, format: 'percent', deltaDirection: 'up', delta: 0.02 },
      ],
    });
    expectOk(outcome);
    expect(outcome.output.tiles).toHaveLength(2);
  });

  it('rejects currency tile missing currency code', async () => {
    const outcome = await call(renderKpiGridTool, {
      tiles: [{ label: 'X', value: 100, format: 'currency' }],
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects tile with bad format', async () => {
    const outcome = await call(renderKpiGridTool, {
      tiles: [{ label: 'X', value: 100, format: 'fancy' }],
    });
    expect(outcome.kind).toBe('error');
  });

  it('accepts any ISO-4217 currency code (EUR, ZAR)', async () => {
    for (const code of ['EUR', 'ZAR'] as const) {
      const outcome = await call(renderKpiGridTool, {
        tiles: [{ label: 'X', value: 100, format: 'currency', currency: code }],
      });
      expectOk(outcome);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 5. prefill-form
// ─────────────────────────────────────────────────────────────────────

describe('render-blocks.prefill-form', () => {
  const baseSchema = {
    type: 'object',
    required: ['name'],
    properties: { name: { type: 'string' } },
  };

  it('emits a UiPart for a valid relative action URL', async () => {
    const outcome = await call(renderPrefillFormTool, {
      formId: 'tenant.create',
      schemaJson: baseSchema,
      values: { name: 'Otieno' },
      action: '/api/tenants',
    });
    expectOk(outcome);
    expect(outcome.output.formId).toBe('tenant.create');
  });

  it('rejects action that is not relative or http(s)', async () => {
    const outcome = await call(renderPrefillFormTool, {
      formId: 'x',
      schemaJson: baseSchema,
      values: {},
      action: 'javascript:alert(1)',
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects missing schemaJson', async () => {
    const outcome = await call(renderPrefillFormTool, {
      formId: 'x',
      values: {},
      action: '/api/x',
    });
    expect(outcome.kind).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 6. approval
// ─────────────────────────────────────────────────────────────────────

describe('render-blocks.approval', () => {
  const checklist: readonly [string, string, string, string, string] = [
    'Intent matches user request',
    'Data lineage traced',
    'Permissions chain verified',
    'Blast radius scoped',
    'Rollback plan ready',
  ];

  it('emits a UiPart for a complete 5-item checklist', async () => {
    const outcome = await call(renderApprovalTool, {
      action: 'platform.update_fx_rate',
      payload: { code: 'KES', rate: 145.7 },
      diff: { rate: { from: 144.2, to: 145.7 } },
      checklist,
    });
    expectOk(outcome);
    expect(outcome.output.checklist).toHaveLength(5);
  });

  it('rejects checklist with fewer than 5 items', async () => {
    const outcome = await call(renderApprovalTool, {
      action: 'x',
      payload: {},
      diff: {},
      checklist: ['only', 'two'],
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects checklist with empty string', async () => {
    const bad = ['', 'b', 'c', 'd', 'e'];
    const outcome = await call(renderApprovalTool, {
      action: 'x',
      payload: {},
      diff: {},
      checklist: bad,
    });
    expect(outcome.kind).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 7. workflow
// ─────────────────────────────────────────────────────────────────────

describe('render-blocks.workflow', () => {
  it('emits a UiPart for valid steps + currentIndex', async () => {
    const outcome = await call(renderWorkflowTool, {
      steps: [
        { label: 'Verify ID', status: 'done' },
        { label: 'Sign lease', status: 'running' },
        { label: 'Collect deposit', status: 'pending' },
      ],
      currentIndex: 1,
    });
    expectOk(outcome);
    expect(outcome.output.steps).toHaveLength(3);
  });

  it('rejects currentIndex out of range', async () => {
    const outcome = await call(renderWorkflowTool, {
      steps: [{ label: 'a', status: 'done' }],
      currentIndex: 5,
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects step with invalid status', async () => {
    const outcome = await call(renderWorkflowTool, {
      steps: [{ label: 'a', status: 'paused' }],
      currentIndex: 0,
    });
    expect(outcome.kind).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8. map
// ─────────────────────────────────────────────────────────────────────

describe('render-blocks.map', () => {
  it('emits a UiPart for valid coords', async () => {
    const outcome = await call(renderMapTool, {
      center: [-6.7924, 39.2083], // Dar es Salaam
      zoom: 12,
      markers: [{ position: [-6.7924, 39.2083], popup: 'HQ' }],
    });
    expectOk(outcome);
    expect(outcome.output.markers).toHaveLength(1);
  });

  it('rejects coords outside lat/lng range', async () => {
    const outcome = await call(renderMapTool, {
      center: [91, 0],
      zoom: 10,
      markers: [],
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects zoom outside 0..20', async () => {
    const outcome = await call(renderMapTool, {
      center: [0, 0],
      zoom: 99,
      markers: [],
    });
    expect(outcome.kind).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 9. calendar
// ─────────────────────────────────────────────────────────────────────

describe('render-blocks.calendar', () => {
  it('emits a UiPart for valid events', async () => {
    const outcome = await call(renderCalendarTool, {
      events: [
        { id: 'evt-1', title: 'Lease renewal: 4B', start: '2026-06-01T09:00:00Z' },
      ],
      view: 'dayGrid',
    });
    expectOk(outcome);
    expect(outcome.output.events).toHaveLength(1);
  });

  it('rejects event with invalid start timestamp', async () => {
    const outcome = await call(renderCalendarTool, {
      events: [{ id: 'x', title: 'y', start: 'tomorrow' }],
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects invalid colour hex', async () => {
    const outcome = await call(renderCalendarTool, {
      events: [{ id: 'x', title: 'y', start: '2026-01-01T00:00:00Z', color: 'red' }],
    });
    expect(outcome.kind).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 10. file-preview
// ─────────────────────────────────────────────────────────────────────

describe('render-blocks.file-preview', () => {
  it('emits a UiPart for a valid PDF URL', async () => {
    const outcome = await call(renderFilePreviewTool, {
      url: 'https://docs.borjie.com/leases/lease-4b.pdf',
      mimeType: 'application/pdf',
      name: 'lease-4b.pdf',
      sizeBytes: 245678,
    });
    expectOk(outcome);
    expect(outcome.output.mimeType).toBe('application/pdf');
  });

  it('rejects url that is neither http(s) nor path-relative', async () => {
    const outcome = await call(renderFilePreviewTool, {
      url: 'file:///etc/passwd',
      mimeType: 'text/plain',
      name: 'secrets',
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects missing required fields', async () => {
    const outcome = await call(renderFilePreviewTool, {
      url: '/x.pdf',
      mimeType: 'application/pdf',
    });
    expect(outcome.kind).toBe('error');
  });
});

// ─────────────────────────────────────────────────────────────────────
// Bundle smoke test
// ─────────────────────────────────────────────────────────────────────

describe('createRenderBlockTools bundle', () => {
  it('returns all 35 tools registered under render-blocks.* (10 original + 12 ProdFix-7 + 13 Phase E.7)', () => {
    const bundle = createRenderBlockTools();
    expect(bundle.all).toHaveLength(35);
    for (const t of bundle.all) {
      expect(t.name.startsWith('render-blocks.')).toBe(true);
      expect(t.scopes).toContain('platform');
      expect(t.scopes).toContain('tenant');
    }
  });

  it('each tool has a JSON Schema for the LLM', () => {
    const bundle = createRenderBlockTools();
    for (const t of bundle.all) {
      expect(t.inputJsonSchema).toBeTruthy();
      expect((t.inputJsonSchema as { type?: string }).type).toBe('object');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════
// ProdFix-7 — 12 new tool kinds (Tier-1 + Tier-2)
// ═════════════════════════════════════════════════════════════════════

// ── 11. kanban ────────────────────────────────────────────────────────

describe('render-blocks.kanban', () => {
  it('emits a UiPart for valid columns + cards', async () => {
    const outcome = await call(renderKanbanTool, {
      columns: [
        {
          id: 'open',
          title: 'Open',
          cards: [{ id: 't1', title: 'Leak at 4B', subtitle: 'Plumbing' }],
        },
        { id: 'in-progress', title: 'In Progress', cards: [] },
      ],
    });
    expectOk(outcome);
    expect(outcome.output.columns).toHaveLength(2);
  });

  it('rejects more than 8 columns', async () => {
    const cols = Array.from({ length: 9 }, (_, i) => ({
      id: `c${i}`,
      title: `Col ${i}`,
      cards: [],
    }));
    const outcome = await call(renderKanbanTool, { columns: cols });
    expect(outcome.kind).toBe('error');
  });

  it('rejects empty columns array', async () => {
    const outcome = await call(renderKanbanTool, { columns: [] });
    expect(outcome.kind).toBe('error');
  });
});

// ── 12. dashboard-grid ────────────────────────────────────────────────

describe('render-blocks.dashboard-grid', () => {
  it('emits a UiPart for valid cells', async () => {
    const outcome = await call(renderDashboardGridTool, {
      cells: [
        { span: 6, part: { kind: 'kpi-grid', tiles: [] } },
        { span: 6, part: { kind: 'chart-vega', spec: {}, data: [] } },
      ],
    });
    expectOk(outcome);
    expect(outcome.output.cells).toHaveLength(2);
  });

  it('rejects cell with span > 12', async () => {
    const outcome = await call(renderDashboardGridTool, {
      cells: [{ span: 99, part: { kind: 'kpi-grid' } }],
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects cell missing inner kind discriminator', async () => {
    const outcome = await call(renderDashboardGridTool, {
      cells: [{ span: 6, part: {} }],
    });
    expect(outcome.kind).toBe('error');
  });
});

// ── 13. heatmap ───────────────────────────────────────────────────────

describe('render-blocks.heatmap', () => {
  it('emits a UiPart for valid matrix', async () => {
    const outcome = await call(renderHeatmapTool, {
      xAxis: ['Jan', 'Feb'],
      yAxis: ['Property A', 'Property B'],
      cells: [
        [10, 20],
        [30, 40],
      ],
      colorScale: 'linear',
      format: 'count',
    });
    expectOk(outcome);
    expect(outcome.output.cells).toHaveLength(2);
  });

  it('rejects mismatched row length', async () => {
    const outcome = await call(renderHeatmapTool, {
      xAxis: ['Jan', 'Feb'],
      yAxis: ['A', 'B'],
      cells: [
        [10, 20, 30],
        [40, 50],
      ],
      colorScale: 'linear',
      format: 'count',
    });
    expect(outcome.kind).toBe('error');
  });

  it('requires currency code when format=currency', async () => {
    const outcome = await call(renderHeatmapTool, {
      xAxis: ['J'],
      yAxis: ['A'],
      cells: [[1]],
      colorScale: 'linear',
      format: 'currency',
    });
    expect(outcome.kind).toBe('error');
  });
});

// ── 14. markdown-card ─────────────────────────────────────────────────

describe('render-blocks.markdown-card', () => {
  it('emits a UiPart for valid markdown + citations', async () => {
    const outcome = await call(renderMarkdownCardTool, {
      markdown: 'Briefing on **arrears** [cite:doc1].',
      citations: [{ id: 'doc1', label: 'Q1 statement', sourceUri: 'https://x/y.pdf' }],
      severity: 'warning',
    });
    expectOk(outcome);
    expect(outcome.output.citations).toHaveLength(1);
  });

  it('rejects empty markdown', async () => {
    const outcome = await call(renderMarkdownCardTool, { markdown: '' });
    expect(outcome.kind).toBe('error');
  });

  it('rejects unknown severity', async () => {
    const outcome = await call(renderMarkdownCardTool, {
      markdown: 'ok',
      severity: 'panic',
    });
    expect(outcome.kind).toBe('error');
  });
});

// ── 15. prompt-suggestions ────────────────────────────────────────────

describe('render-blocks.prompt-suggestions', () => {
  it('emits a UiPart for valid suggestions', async () => {
    const outcome = await call(renderPromptSuggestionsTool, {
      suggestions: [
        { label: 'View arrears', prompt: 'show arrears', kind: 'primary' },
        { label: 'Snooze', prompt: 'snooze ticket', kind: 'secondary' },
      ],
    });
    expectOk(outcome);
    expect(outcome.output.suggestions).toHaveLength(2);
  });

  it('rejects more than 12 suggestions', async () => {
    const sugg = Array.from({ length: 13 }, (_, i) => ({
      label: `L${i}`,
      prompt: `p${i}`,
      kind: 'secondary' as const,
    }));
    const outcome = await call(renderPromptSuggestionsTool, { suggestions: sugg });
    expect(outcome.kind).toBe('error');
  });

  it('rejects unknown kind', async () => {
    const outcome = await call(renderPromptSuggestionsTool, {
      suggestions: [{ label: 'X', prompt: 'y', kind: 'fancy' }],
    });
    expect(outcome.kind).toBe('error');
  });
});

// ── 16. evidence-card ─────────────────────────────────────────────────

describe('render-blocks.evidence-card', () => {
  it('emits a UiPart for valid quote', async () => {
    const outcome = await call(renderEvidenceCardTool, {
      quote: 'Rent is due on the 1st of the month.',
      sourceTitle: 'Lease 4B v2',
      sourcePageOrLocator: 'page 4',
      confidence: 'high',
    });
    expectOk(outcome);
    expect(outcome.output.quote).toContain('Rent is due');
  });

  it('rejects empty quote', async () => {
    const outcome = await call(renderEvidenceCardTool, {
      quote: '',
      sourceTitle: 'Lease',
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects unknown confidence', async () => {
    const outcome = await call(renderEvidenceCardTool, {
      quote: 'q',
      sourceTitle: 's',
      confidence: 'absolute',
    });
    expect(outcome.kind).toBe('error');
  });
});

// ── 17. tree ──────────────────────────────────────────────────────────

describe('render-blocks.tree', () => {
  it('emits a UiPart for nested tree', async () => {
    const outcome = await call(renderTreeTool, {
      root: {
        id: 'p',
        label: 'Portfolio',
        children: [
          { id: 'b1', label: 'Bldg 1', badge: '12 units' },
          { id: 'b2', label: 'Bldg 2' },
        ],
      },
    });
    expectOk(outcome);
    expect(outcome.output.root.children).toHaveLength(2);
  });

  it('rejects root missing label', async () => {
    const outcome = await call(renderTreeTool, {
      root: { id: 'p' },
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects action with unknown kind', async () => {
    const outcome = await call(renderTreeTool, {
      root: {
        id: 'p',
        label: 'P',
        onClickAction: { kind: 'jump', payload: {} },
      },
    });
    expect(outcome.kind).toBe('error');
  });
});

// ── 18. diff-view ─────────────────────────────────────────────────────

describe('render-blocks.diff-view', () => {
  it('emits a UiPart for valid diff', async () => {
    const outcome = await call(renderDiffViewTool, {
      left: 'rent: 45000',
      right: 'rent: 50000',
      leftLabel: 'Current',
      rightLabel: 'Proposed',
      mode: 'split',
    });
    expectOk(outcome);
    expect(outcome.output.mode).toBe('split');
  });

  it('rejects unknown mode', async () => {
    const outcome = await call(renderDiffViewTool, {
      left: 'a',
      right: 'b',
      leftLabel: 'l',
      rightLabel: 'r',
      mode: 'overlay',
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects missing labels', async () => {
    const outcome = await call(renderDiffViewTool, {
      left: 'a',
      right: 'b',
      mode: 'unified',
    });
    expect(outcome.kind).toBe('error');
  });
});

// ── 19. gauge ─────────────────────────────────────────────────────────

describe('render-blocks.gauge', () => {
  it('emits a UiPart for valid gauge', async () => {
    const outcome = await call(renderGaugeTool, {
      value: 0.85,
      min: 0,
      max: 1,
      label: 'Collection rate',
      format: 'percent',
    });
    expectOk(outcome);
    expect(outcome.output.label).toBe('Collection rate');
  });

  it('rejects min >= max', async () => {
    const outcome = await call(renderGaugeTool, {
      value: 5,
      min: 10,
      max: 5,
      label: 'x',
    });
    expect(outcome.kind).toBe('error');
  });

  it('requires currency when format=currency', async () => {
    const outcome = await call(renderGaugeTool, {
      value: 100,
      min: 0,
      max: 1000,
      label: 'NOI',
      format: 'currency',
    });
    expect(outcome.kind).toBe('error');
  });
});

// ── 20. metric-sparkline ──────────────────────────────────────────────

describe('render-blocks.metric-sparkline', () => {
  it('emits a UiPart for valid metric + sparkline', async () => {
    const outcome = await call(renderMetricSparklineTool, {
      label: 'MoM rent',
      value: 1250000,
      format: 'currency',
      currency: 'KES',
      sparkline: [1.1, 1.15, 1.2, 1.18, 1.25],
      delta: 0.05,
      deltaIsPositive: true,
    });
    expectOk(outcome);
    expect(outcome.output.sparkline).toHaveLength(5);
  });

  it('rejects sparkline with < 2 points', async () => {
    const outcome = await call(renderMetricSparklineTool, {
      label: 'x',
      value: 1,
      format: 'number',
      sparkline: [1],
    });
    expect(outcome.kind).toBe('error');
  });

  it('requires currency when format=currency', async () => {
    const outcome = await call(renderMetricSparklineTool, {
      label: 'x',
      value: 1,
      format: 'currency',
      sparkline: [1, 2],
    });
    expect(outcome.kind).toBe('error');
  });
});

// ── 21. image-annotation ──────────────────────────────────────────────

describe('render-blocks.image-annotation', () => {
  it('emits a UiPart for valid image + annotations', async () => {
    const outcome = await call(renderImageAnnotationTool, {
      imageUrl: 'https://docs.borjie.com/inspections/4b.jpg',
      annotations: [
        { x: 0.25, y: 0.4, label: 'Cracked tile', severity: 'warning' },
      ],
    });
    expectOk(outcome);
    expect(outcome.output.annotations).toHaveLength(1);
  });

  it('rejects out-of-range coordinates', async () => {
    const outcome = await call(renderImageAnnotationTool, {
      imageUrl: 'https://x/y.png',
      annotations: [{ x: 1.5, y: 0.5, label: 'oops', severity: 'info' }],
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects file:// imageUrl', async () => {
    const outcome = await call(renderImageAnnotationTool, {
      imageUrl: 'file:///etc/img.png',
      annotations: [],
    });
    expect(outcome.kind).toBe('error');
  });
});

// ── 22. signature-pad ─────────────────────────────────────────────────

describe('render-blocks.signature-pad', () => {
  it('emits a UiPart for valid signature config', async () => {
    const outcome = await call(renderSignaturePadTool, {
      prompt: 'Sign to accept the renewal',
      requiredFor: 'Lease 4B renewal',
      onSubmitAction: { kind: 'tool', payload: { tool: 'lease.sign' } },
    });
    expectOk(outcome);
    expect(outcome.output.requiredFor).toContain('Lease 4B');
  });

  it('rejects unknown action kind', async () => {
    const outcome = await call(renderSignaturePadTool, {
      prompt: 'sign',
      requiredFor: 'x',
      onSubmitAction: { kind: 'submit', payload: {} },
    });
    expect(outcome.kind).toBe('error');
  });

  it('rejects missing prompt', async () => {
    const outcome = await call(renderSignaturePadTool, {
      requiredFor: 'x',
      onSubmitAction: { kind: 'tool', payload: {} },
    });
    expect(outcome.kind).toBe('error');
  });
});

// ── ProdFix-7 bundle sanity ───────────────────────────────────────────

describe('createRenderBlockTools — ProdFix-7 surface', () => {
  it('exposes all 12 new kinds under render-blocks.*', () => {
    const bundle = createRenderBlockTools();
    const names = bundle.all.map((t) => t.name);
    const expected = [
      'render-blocks.kanban',
      'render-blocks.dashboard-grid',
      'render-blocks.heatmap',
      'render-blocks.markdown-card',
      'render-blocks.prompt-suggestions',
      'render-blocks.evidence-card',
      'render-blocks.tree',
      'render-blocks.diff-view',
      'render-blocks.gauge',
      'render-blocks.metric-sparkline',
      'render-blocks.image-annotation',
      'render-blocks.signature-pad',
    ];
    for (const name of expected) {
      expect(names).toContain(name);
    }
  });
});
