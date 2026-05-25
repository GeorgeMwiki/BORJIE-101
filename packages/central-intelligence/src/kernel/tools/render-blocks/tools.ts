/**
 * The 10 render-block tools the brain can call to emit generative UI.
 *
 * Each tool is a thin wrapper around `createRenderBlockTool` that
 * supplies the primitive-specific name, kind, description, Zod
 * schema, and a JSON Schema for the LLM tool-use input.
 *
 * The JSON Schemas here intentionally mirror the Zod schemas (just
 * loosely enough for Claude/OpenAI to construct valid inputs) — they
 * are NOT the source of truth. Zod is. If the model emits something
 * the JSON schema permits but Zod rejects, the tool returns a
 * `ToolOutcome.error` and the agent loop repairs.
 */

import { createRenderBlockTool } from './tool-factory.js';
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
} from './schemas.js';
import type { AgUiUiPartByKind } from './ag-ui-types.js';
import type { Tool } from '../../../types.js';

// ─────────────────────────────────────────────────────────────────────
// 1. chart-vega
// ─────────────────────────────────────────────────────────────────────

export const renderChartVegaTool: Tool<unknown, AgUiUiPartByKind<'chart-vega'>> =
  createRenderBlockTool<AgUiUiPartByKind<'chart-vega'>>({
    name: 'render-blocks.chart-vega',
    kind: 'chart-vega',
    description:
      'Render a chart in the admin console using a Vega-Lite v5 spec. ' +
      'Use for arrears trends, occupancy %, FX exposure, water consumption, ' +
      'or any time-series / categorical visual. The spec is validated ' +
      'with ajv before render; emit a complete spec, never a partial one.',
    schema: ChartVegaPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['spec', 'data'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        spec: {
          type: 'object',
          description: 'Vega-Lite v5 spec. Must include mark + encoding.',
        },
        data: {
          type: 'array',
          items: { type: 'object' },
          description: 'Inline data rows the spec references via data:{values}.',
        },
      },
      additionalProperties: false,
    },
  });

// ─────────────────────────────────────────────────────────────────────
// 2. data-table
// ─────────────────────────────────────────────────────────────────────

export const renderDataTableTool: Tool<unknown, AgUiUiPartByKind<'data-table'>> =
  createRenderBlockTool<AgUiUiPartByKind<'data-table'>>({
    name: 'render-blocks.data-table',
    kind: 'data-table',
    description:
      'Render a sortable, filterable, CSV-exportable data table. Use for ' +
      'rent rolls, late-payer lists, maintenance backlogs, audit log slices.',
    schema: DataTablePartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['columns', 'rows'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        columns: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'header', 'accessorKey'],
            properties: {
              id: { type: 'string' },
              header: { type: 'string' },
              accessorKey: { type: 'string' },
              format: {
                type: 'string',
                enum: ['text', 'currency', 'percent', 'number', 'date'],
              },
              currency: {
                type: 'string',
                pattern: '^[A-Z]{3}$',
                description: 'ISO-4217 currency code (e.g. KES, TZS, USD, EUR)',
              },
              enableSorting: { type: 'boolean' },
            },
            additionalProperties: false,
          },
        },
        rows: { type: 'array', items: { type: 'object' } },
        pageSize: { type: 'integer', minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
  });

// ─────────────────────────────────────────────────────────────────────
// 3. timeline
// ─────────────────────────────────────────────────────────────────────

export const renderTimelineTool: Tool<unknown, AgUiUiPartByKind<'timeline'>> =
  createRenderBlockTool<AgUiUiPartByKind<'timeline'>>({
    name: 'render-blocks.timeline',
    kind: 'timeline',
    description:
      'Render a vertical event timeline. Use for tenant lifecycle, payment ' +
      'history, complaint threads, audit-trail slices.',
    schema: TimelinePartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['events'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        events: {
          type: 'array',
          items: {
            type: 'object',
            required: ['timestamp', 'title'],
            properties: {
              timestamp: { type: 'string', description: 'ISO-8601' },
              title: { type: 'string' },
              description: { type: 'string' },
              severity: {
                type: 'string',
                enum: ['info', 'warn', 'error', 'success'],
              },
              icon: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  });

// ─────────────────────────────────────────────────────────────────────
// 4. kpi-grid
// ─────────────────────────────────────────────────────────────────────

export const renderKpiGridTool: Tool<unknown, AgUiUiPartByKind<'kpi-grid'>> =
  createRenderBlockTool<AgUiUiPartByKind<'kpi-grid'>>({
    name: 'render-blocks.kpi-grid',
    kind: 'kpi-grid',
    description:
      'Render a KPI tile cluster (Tremor-style). Use for the dashboard ' +
      'hero: collected, due, occupancy, NOI, FX delta, arrears total.',
    schema: KpiGridPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['tiles'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        tiles: {
          type: 'array',
          items: {
            type: 'object',
            required: ['label', 'value', 'format'],
            properties: {
              label: { type: 'string' },
              value: { type: ['number', 'string'] },
              delta: { type: 'number' },
              deltaDirection: { type: 'string', enum: ['up', 'down', 'flat'] },
              format: { type: 'string', enum: ['currency', 'percent', 'number'] },
              currency: {
                type: 'string',
                pattern: '^[A-Z]{3}$',
                description: 'ISO-4217 currency code (e.g. KES, TZS, USD, EUR)',
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  });

// ─────────────────────────────────────────────────────────────────────
// 5. prefill-form
// ─────────────────────────────────────────────────────────────────────

export const renderPrefillFormTool: Tool<unknown, AgUiUiPartByKind<'prefill-form'>> =
  createRenderBlockTool<AgUiUiPartByKind<'prefill-form'>>({
    name: 'render-blocks.prefill-form',
    kind: 'prefill-form',
    description:
      'Render a prefilled form for the admin to review and submit. The ' +
      'schemaJson is SERVER-OWNED — supply it verbatim from the action ' +
      "registry; do NOT modify it. The brain emits VALUES against it. " +
      'Form submission POSTs to the action URL (api-gateway), not the agent.',
    schema: PrefillFormPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['formId', 'schemaJson', 'values', 'action'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        formId: { type: 'string' },
        schemaJson: {
          type: 'object',
          description:
            'JSON Schema Draft-7. Server-owned, supplied verbatim from registry.',
        },
        values: { type: 'object' },
        action: {
          type: 'string',
          description: 'Relative URL on api-gateway. NOT the agent endpoint.',
        },
        diffMode: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  });

// ─────────────────────────────────────────────────────────────────────
// 6. approval
// ─────────────────────────────────────────────────────────────────────

export const renderApprovalTool: Tool<unknown, AgUiUiPartByKind<'approval'>> =
  createRenderBlockTool<AgUiUiPartByKind<'approval'>>({
    name: 'render-blocks.approval',
    kind: 'approval',
    description:
      'Render an HIL approval dialog with a diff preview and a 5-item ' +
      'challenge-and-response checklist (intent / data lineage / permissions ' +
      'chain / blast radius / rollback plan). User must ack every checklist ' +
      'item before the approve button enables. Required for destroy/billing tier.',
    schema: ApprovalPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['action', 'payload', 'diff', 'checklist'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        action: { type: 'string' },
        payload: { type: 'object' },
        diff: { type: 'object' },
        checklist: {
          type: 'array',
          minItems: 5,
          maxItems: 5,
          items: { type: 'string', maxLength: 280 },
        },
      },
      additionalProperties: false,
    },
  });

// ─────────────────────────────────────────────────────────────────────
// 7. workflow
// ─────────────────────────────────────────────────────────────────────

export const renderWorkflowTool: Tool<unknown, AgUiUiPartByKind<'workflow'>> =
  createRenderBlockTool<AgUiUiPartByKind<'workflow'>>({
    name: 'render-blocks.workflow',
    kind: 'workflow',
    description:
      'Render a horizontal stepper for a multi-step workflow. Use for ' +
      'onboarding, eviction, KRA filing, maintenance ticket lifecycle.',
    schema: WorkflowPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['steps', 'currentIndex'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            required: ['label', 'status'],
            properties: {
              label: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'running', 'done', 'failed'],
              },
              startedAt: { type: 'string' },
              completedAt: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        currentIndex: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
  });

// ─────────────────────────────────────────────────────────────────────
// 8. map
// ─────────────────────────────────────────────────────────────────────

export const renderMapTool: Tool<unknown, AgUiUiPartByKind<'map'>> =
  createRenderBlockTool<AgUiUiPartByKind<'map'>>({
    name: 'render-blocks.map',
    kind: 'map',
    description:
      'Render an OSM map with markers (react-leaflet + OpenStreetMap tiles). ' +
      'Use for property locations, inspection routes, geo-fenced arrears. ' +
      'NO Mapbox tokens — works offline in TZ field conditions when tile ' +
      'cache is warm.',
    schema: MapPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['center', 'zoom', 'markers'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        center: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: { type: 'number' },
          description: '[lat, lng]',
        },
        zoom: { type: 'integer', minimum: 0, maximum: 20 },
        markers: {
          type: 'array',
          items: {
            type: 'object',
            required: ['position'],
            properties: {
              position: {
                type: 'array',
                minItems: 2,
                maxItems: 2,
                items: { type: 'number' },
              },
              popup: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  });

// ─────────────────────────────────────────────────────────────────────
// 9. calendar
// ─────────────────────────────────────────────────────────────────────

export const renderCalendarTool: Tool<unknown, AgUiUiPartByKind<'calendar'>> =
  createRenderBlockTool<AgUiUiPartByKind<'calendar'>>({
    name: 'render-blocks.calendar',
    kind: 'calendar',
    description:
      'Render an interactive calendar (FullCalendar v6). Use for lease ' +
      'renewals, inspections, KRA deadlines, rent-due dates.',
    schema: CalendarPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['events'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        events: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'title', 'start'],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              start: { type: 'string', description: 'ISO-8601' },
              end: { type: 'string' },
              color: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        view: { type: 'string', enum: ['dayGrid', 'timeGrid', 'list'] },
      },
      additionalProperties: false,
    },
  });

// ─────────────────────────────────────────────────────────────────────
// 10. file-preview
// ─────────────────────────────────────────────────────────────────────

export const renderFilePreviewTool: Tool<unknown, AgUiUiPartByKind<'file-preview'>> =
  createRenderBlockTool<AgUiUiPartByKind<'file-preview'>>({
    name: 'render-blocks.file-preview',
    kind: 'file-preview',
    description:
      'Render an inline file preview (PDF via react-pdf, image inline). Use ' +
      'for owner statements, signed leases, MRI receipts, ID scans.',
    schema: FilePreviewPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['url', 'mimeType', 'name'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        url: { type: 'string' },
        mimeType: { type: 'string' },
        name: { type: 'string' },
        sizeBytes: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
  });

// ═════════════════════════════════════════════════════════════════════
// ProdFix-7 — Tier-1 (6 new tools)
// ═════════════════════════════════════════════════════════════════════

// ── 11. kanban ────────────────────────────────────────────────────────

export const renderKanbanTool: Tool<unknown, AgUiUiPartByKind<'kanban'>> =
  createRenderBlockTool<AgUiUiPartByKind<'kanban'>>({
    name: 'render-blocks.kanban',
    kind: 'kanban',
    description:
      'Render a kanban board with swimlane columns and cards. Use for ' +
      'maintenance ticket queue, vacancy-to-lease pipeline, KRA filing ' +
      'states, move-in pipeline. Max 8 columns, 500 cards/column.',
    schema: KanbanPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['columns'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        columns: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: {
            type: 'object',
            required: ['id', 'title', 'cards'],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              cards: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['id', 'title'],
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    subtitle: { type: 'string' },
                    badges: { type: 'array', items: { type: 'string' } },
                    meta: { type: 'object' },
                    dueAt: { type: 'string', description: 'ISO-8601' },
                  },
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  });

// ── 12. dashboard-grid ────────────────────────────────────────────────

export const renderDashboardGridTool: Tool<unknown, AgUiUiPartByKind<'dashboard-grid'>> =
  createRenderBlockTool<AgUiUiPartByKind<'dashboard-grid'>>({
    name: 'render-blocks.dashboard-grid',
    kind: 'dashboard-grid',
    description:
      'Render a composite 12-column responsive dashboard grid. Each ' +
      'cell holds another UiPart (chart-vega, kpi-grid, data-table, etc.) ' +
      'with a `span` 1..12. Lets the brain emit ONE structured layout ' +
      'per turn instead of N flat parts.',
    schema: DashboardGridPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['cells'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        cells: {
          type: 'array',
          minItems: 1,
          maxItems: 32,
          items: {
            type: 'object',
            required: ['span', 'part'],
            properties: {
              span: { type: 'integer', minimum: 1, maximum: 12 },
              part: {
                type: 'object',
                description: 'Nested UiPart with discriminator field `kind`.',
                required: ['kind'],
                properties: { kind: { type: 'string' } },
              },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  });

// ── 13. heatmap ───────────────────────────────────────────────────────

export const renderHeatmapTool: Tool<unknown, AgUiUiPartByKind<'heatmap'>> =
  createRenderBlockTool<AgUiUiPartByKind<'heatmap'>>({
    name: 'render-blocks.heatmap',
    kind: 'heatmap',
    description:
      'Render a 2D value matrix as a heatmap. Use for arrears by ' +
      'property × month, occupancy by unit × week. `cells[y][x]` order; ' +
      'cells.length must equal yAxis.length and each row length must ' +
      'equal xAxis.length.',
    schema: HeatmapPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['xAxis', 'yAxis', 'cells', 'colorScale', 'format'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        xAxis: { type: 'array', items: { type: 'string' } },
        yAxis: { type: 'array', items: { type: 'string' } },
        cells: {
          type: 'array',
          items: { type: 'array', items: { type: 'number' } },
        },
        colorScale: { type: 'string', enum: ['linear', 'log', 'diverging'] },
        minValue: { type: 'number' },
        maxValue: { type: 'number' },
        format: { type: 'string', enum: ['currency', 'percent', 'count'] },
        currency: {
          type: 'string',
          pattern: '^[A-Z]{3}$',
          description: 'ISO-4217 currency code when format=currency',
        },
        unit: { type: 'string' },
      },
      additionalProperties: false,
    },
  });

// ── 14. markdown-card ─────────────────────────────────────────────────

export const renderMarkdownCardTool: Tool<unknown, AgUiUiPartByKind<'markdown-card'>> =
  createRenderBlockTool<AgUiUiPartByKind<'markdown-card'>>({
    name: 'render-blocks.markdown-card',
    kind: 'markdown-card',
    description:
      'Render a rich narrative markdown block with optional citations. ' +
      'Use for briefings, case studies, decision-rationale. Citations ' +
      'are referenced in the markdown body via [cite:<id>] markers and ' +
      'rendered as a list below the body.',
    schema: MarkdownCardPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['markdown'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        markdown: { type: 'string', maxLength: 20000 },
        citations: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'label'],
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              sourceUri: { type: 'string' },
              sourceRowRef: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
        severity: { type: 'string', enum: ['info', 'warning', 'success', 'danger'] },
      },
      additionalProperties: false,
    },
  });

// ── 15. prompt-suggestions ────────────────────────────────────────────

export const renderPromptSuggestionsTool: Tool<unknown, AgUiUiPartByKind<'prompt-suggestions'>> =
  createRenderBlockTool<AgUiUiPartByKind<'prompt-suggestions'>>({
    name: 'render-blocks.prompt-suggestions',
    kind: 'prompt-suggestions',
    description:
      'Render typed quick-reply buttons. Clicking dispatches the prompt ' +
      'as the next user message. Use to surface common follow-ups, ' +
      'guided drill-downs, destructive options (with destructive kind).',
    schema: PromptSuggestionsPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['suggestions'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        suggestions: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          items: {
            type: 'object',
            required: ['label', 'prompt', 'kind'],
            properties: {
              label: { type: 'string' },
              prompt: { type: 'string' },
              kind: { type: 'string', enum: ['primary', 'secondary', 'destructive'] },
              icon: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  });

// ── 16. evidence-card ─────────────────────────────────────────────────

export const renderEvidenceCardTool: Tool<unknown, AgUiUiPartByKind<'evidence-card'>> =
  createRenderBlockTool<AgUiUiPartByKind<'evidence-card'>>({
    name: 'render-blocks.evidence-card',
    kind: 'evidence-card',
    description:
      'Render a document-quote with cite-link. Use for compliance ' +
      'reasoning ("MD says X because page 4 of the lease says Y"). ' +
      'Quote rendered in styled blockquote with source ref + click-through.',
    schema: EvidenceCardPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['quote', 'sourceTitle'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        quote: { type: 'string', maxLength: 4000 },
        sourceTitle: { type: 'string' },
        sourceUri: { type: 'string' },
        sourcePageOrLocator: { type: 'string' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        extractedAt: { type: 'string', description: 'ISO-8601' },
      },
      additionalProperties: false,
    },
  });

// ═════════════════════════════════════════════════════════════════════
// ProdFix-7 — Tier-2 (6 new tools)
// ═════════════════════════════════════════════════════════════════════

// ── 17. tree ──────────────────────────────────────────────────────────

const treeNodeJsonSchema: Readonly<Record<string, unknown>> = {
  type: 'object',
  required: ['id', 'label'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    badge: { type: 'string' },
    children: { type: 'array', items: { type: 'object' } },
    onClickAction: {
      type: 'object',
      required: ['kind', 'payload'],
      properties: {
        kind: { type: 'string', enum: ['message', 'tool', 'navigate'] },
        payload: { type: 'object' },
      },
    },
  },
  additionalProperties: false,
};

export const renderTreeTool: Tool<unknown, AgUiUiPartByKind<'tree'>> =
  createRenderBlockTool<AgUiUiPartByKind<'tree'>>({
    name: 'render-blocks.tree',
    kind: 'tree',
    description:
      'Render a hierarchical tree with expand/collapse + optional ' +
      'click actions. Use for owner → portfolio → property → block → ' +
      'unit drill-downs.',
    schema: TreePartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['root'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        root: treeNodeJsonSchema,
      },
      additionalProperties: false,
    },
  });

// ── 18. diff-view ─────────────────────────────────────────────────────

export const renderDiffViewTool: Tool<unknown, AgUiUiPartByKind<'diff-view'>> =
  createRenderBlockTool<AgUiUiPartByKind<'diff-view'>>({
    name: 'render-blocks.diff-view',
    kind: 'diff-view',
    description:
      'Render a side-by-side or unified diff. Critical for plan-mode ' +
      '(before/after preview), lease redline, config drift review.',
    schema: DiffViewPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['left', 'right', 'leftLabel', 'rightLabel', 'mode'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        left: { type: 'string' },
        right: { type: 'string' },
        leftLabel: { type: 'string' },
        rightLabel: { type: 'string' },
        mode: { type: 'string', enum: ['unified', 'split'] },
        language: { type: 'string', enum: ['text', 'json', 'sql'] },
      },
      additionalProperties: false,
    },
  });

// ── 19. gauge ─────────────────────────────────────────────────────────

export const renderGaugeTool: Tool<unknown, AgUiUiPartByKind<'gauge'>> =
  createRenderBlockTool<AgUiUiPartByKind<'gauge'>>({
    name: 'render-blocks.gauge',
    kind: 'gauge',
    description:
      'Render a radial gauge/donut. Use for NPS, collection-rate dials, ' +
      'occupancy donuts. Thresholds drive colour bands.',
    schema: GaugePartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['value', 'min', 'max', 'label'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        value: { type: 'number' },
        min: { type: 'number' },
        max: { type: 'number' },
        label: { type: 'string' },
        format: { type: 'string', enum: ['percent', 'number', 'currency'] },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
        thresholds: {
          type: 'array',
          items: {
            type: 'object',
            required: ['value', 'color'],
            properties: {
              value: { type: 'number' },
              color: { type: 'string', pattern: '^#[0-9a-fA-F]{3,8}$' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  });

// ── 20. metric-sparkline ──────────────────────────────────────────────

export const renderMetricSparklineTool: Tool<unknown, AgUiUiPartByKind<'metric-sparkline'>> =
  createRenderBlockTool<AgUiUiPartByKind<'metric-sparkline'>>({
    name: 'render-blocks.metric-sparkline',
    kind: 'metric-sparkline',
    description:
      'Render an inline mini-trend behind a single KPI. Tighter than ' +
      'kpi-grid (one metric at a time, includes sparkline history).',
    schema: MetricSparklinePartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['label', 'value', 'format', 'sparkline'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        label: { type: 'string' },
        value: { type: 'number' },
        format: { type: 'string', enum: ['currency', 'percent', 'number'] },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
        sparkline: { type: 'array', items: { type: 'number' }, minItems: 2 },
        delta: { type: 'number' },
        deltaIsPositive: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  });

// ── 21. image-annotation ──────────────────────────────────────────────

export const renderImageAnnotationTool: Tool<unknown, AgUiUiPartByKind<'image-annotation'>> =
  createRenderBlockTool<AgUiUiPartByKind<'image-annotation'>>({
    name: 'render-blocks.image-annotation',
    kind: 'image-annotation',
    description:
      'Render an image with overlay markers. Use for inspection-photo ' +
      'finding markup, AXTree overlay. x/y are 0..1 normalised.',
    schema: ImageAnnotationPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['imageUrl', 'annotations'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        imageUrl: { type: 'string' },
        annotations: {
          type: 'array',
          items: {
            type: 'object',
            required: ['x', 'y', 'label', 'severity'],
            properties: {
              x: { type: 'number', minimum: 0, maximum: 1 },
              y: { type: 'number', minimum: 0, maximum: 1 },
              label: { type: 'string' },
              severity: { type: 'string', enum: ['info', 'warning', 'critical'] },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  });

// ── 22. signature-pad ─────────────────────────────────────────────────

export const renderSignaturePadTool: Tool<unknown, AgUiUiPartByKind<'signature-pad'>> =
  createRenderBlockTool<AgUiUiPartByKind<'signature-pad'>>({
    name: 'render-blocks.signature-pad',
    kind: 'signature-pad',
    description:
      'Render an inline canvas-based signature capture. The component ' +
      'accepts a signature, exports a dataURL, and dispatches the ' +
      'onSubmitAction tool/navigate. Use for lease-renewal e-signature.',
    schema: SignaturePadPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['prompt', 'requiredFor', 'onSubmitAction'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        prompt: { type: 'string' },
        requiredFor: { type: 'string' },
        onSubmitAction: {
          type: 'object',
          required: ['kind', 'payload'],
          properties: {
            kind: { type: 'string', enum: ['tool', 'navigate'] },
            payload: { type: 'object' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  });

// ═════════════════════════════════════════════════════════════════════
// Phase E.7 — 13 new tools (landed in ProdFix-8)
// ═════════════════════════════════════════════════════════════════════

// ── 23. pdf-viewer ────────────────────────────────────────────────────

export const renderPdfViewerTool: Tool<unknown, AgUiUiPartByKind<'pdf-viewer'>> =
  createRenderBlockTool<AgUiUiPartByKind<'pdf-viewer'>>({
    name: 'render-blocks.pdf-viewer',
    kind: 'pdf-viewer',
    description:
      'Render a full PDF viewer with pan/zoom + optional annotate toggle. ' +
      'Use for signed leases, KRA receipts, owner statements where the user ' +
      'needs to read across multiple pages (vs. file-preview which is ' +
      'thumbnail-only).',
    schema: PdfViewerPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['url', 'name'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        url: { type: 'string' },
        name: { type: 'string' },
        initialPage: { type: 'integer', minimum: 1 },
        allowAnnotate: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  });

// ── 24. slider-input ──────────────────────────────────────────────────

export const renderSliderInputTool: Tool<unknown, AgUiUiPartByKind<'slider-input'>> =
  createRenderBlockTool<AgUiUiPartByKind<'slider-input'>>({
    name: 'render-blocks.slider-input',
    kind: 'slider-input',
    description:
      'Render a range slider for the user to tune a numeric value. Use ' +
      'for rent-negotiation what-ifs, budget-allocation, threshold ' +
      'tweaks. The component dispatches the configured tool/message on ' +
      'change.',
    schema: SliderInputPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['label', 'min', 'max', 'value', 'onChangeAction'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        label: { type: 'string' },
        min: { type: 'number' },
        max: { type: 'number' },
        step: { type: 'number' },
        value: { type: 'number' },
        format: { type: 'string', enum: ['number', 'currency', 'percent'] },
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
        onChangeAction: {
          type: 'object',
          required: ['kind', 'payload'],
          properties: {
            kind: { type: 'string', enum: ['tool', 'message'] },
            payload: { type: 'object' },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  });

// ── 25. multistep-wizard ──────────────────────────────────────────────

export const renderMultistepWizardTool: Tool<unknown, AgUiUiPartByKind<'multistep-wizard'>> =
  createRenderBlockTool<AgUiUiPartByKind<'multistep-wizard'>>({
    name: 'render-blocks.multistep-wizard',
    kind: 'multistep-wizard',
    description:
      'Render an N-step wizard with retained state between steps. Use ' +
      'for tenant onboarding, multi-page applications, structured data ' +
      'capture that benefits from progressive disclosure. The wizard ' +
      'POSTs the aggregated values to onSubmitAction (api-gateway URL).',
    schema: MultistepWizardPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['steps', 'onSubmitAction'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        steps: { type: 'array', items: { type: 'object' } },
        currentStepId: { type: 'string' },
        values: { type: 'object' },
        onSubmitAction: { type: 'string' },
      },
      additionalProperties: false,
    },
  });

// ── 26. media-grid ────────────────────────────────────────────────────

export const renderMediaGridTool: Tool<unknown, AgUiUiPartByKind<'media-grid'>> =
  createRenderBlockTool<AgUiUiPartByKind<'media-grid'>>({
    name: 'render-blocks.media-grid',
    kind: 'media-grid',
    description:
      'Render a photo / image gallery as a grid with a lightbox. Use for ' +
      'property photos, inspection albums, damage-finding photo evidence.',
    schema: MediaGridPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['items'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        items: { type: 'array', items: { type: 'object' } },
        columns: { type: 'integer', minimum: 1, maximum: 8 },
      },
      additionalProperties: false,
    },
  });

// ── 27. chat-embed ────────────────────────────────────────────────────

export const renderChatEmbedTool: Tool<unknown, AgUiUiPartByKind<'chat-embed'>> =
  createRenderBlockTool<AgUiUiPartByKind<'chat-embed'>>({
    name: 'render-blocks.chat-embed',
    kind: 'chat-embed',
    description:
      'Embed a scoped sub-chat inside the current admin turn. Useful when ' +
      'a side-topic warrants its own short transcript without polluting ' +
      'the main thread. Messages dispatch via genui:chat-embed-message ' +
      'to the host portal.',
    schema: ChatEmbedPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['scope'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        scope: { type: 'string' },
        placeholder: { type: 'string' },
        initialMessages: { type: 'array', items: { type: 'object' } },
      },
      additionalProperties: false,
    },
  });

// ── 28. live-counter ──────────────────────────────────────────────────

export const renderLiveCounterTool: Tool<unknown, AgUiUiPartByKind<'live-counter'>> =
  createRenderBlockTool<AgUiUiPartByKind<'live-counter'>>({
    name: 'render-blocks.live-counter',
    kind: 'live-counter',
    description:
      'Render a real-time counter with optional warn/critical thresholds. ' +
      'Use for queue depth, payment-rail latency, active sessions, error ' +
      'rate. Re-emit the same kind with new value to animate the count.',
    schema: LiveCounterPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['label', 'value'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        label: { type: 'string' },
        value: { type: 'number' },
        unit: { type: 'string' },
        trend: { type: 'string', enum: ['up', 'down', 'flat'] },
        thresholdWarn: { type: 'number' },
        thresholdCritical: { type: 'number' },
        updatedAt: { type: 'string' },
      },
      additionalProperties: false,
    },
  });

// ── 29. org-chart ─────────────────────────────────────────────────────

const orgChartNodeJsonSchema: Readonly<Record<string, unknown>> = {
  type: 'object',
  required: ['id', 'label'],
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    role: { type: 'string' },
    badge: { type: 'string' },
    children: { type: 'array', items: { type: 'object' } },
  },
  additionalProperties: false,
};

export const renderOrgChartTool: Tool<unknown, AgUiUiPartByKind<'org-chart'>> =
  createRenderBlockTool<AgUiUiPartByKind<'org-chart'>>({
    name: 'render-blocks.org-chart',
    kind: 'org-chart',
    description:
      'Render a hierarchical relationship graph. Use for tenant ↔ guarantor ' +
      '↔ co-applicant chains, owner ↔ portfolio ↔ property hierarchies, ' +
      'staff org-charts.',
    schema: OrgChartPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['root'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        root: orgChartNodeJsonSchema,
        orientation: { type: 'string', enum: ['vertical', 'horizontal'] },
      },
      additionalProperties: false,
    },
  });

// ── 30. comparison-table ──────────────────────────────────────────────

export const renderComparisonTableTool: Tool<unknown, AgUiUiPartByKind<'comparison-table'>> =
  createRenderBlockTool<AgUiUiPartByKind<'comparison-table'>>({
    name: 'render-blocks.comparison-table',
    kind: 'comparison-table',
    description:
      'Typed equivalent of the block-system property_comparison_table. ' +
      'One row per attribute, one column per subject (property, unit, ' +
      'tenant). Optional best/worst highlight per row.',
    schema: ComparisonTablePartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['columns', 'rows'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        columns: { type: 'array', items: { type: 'string' } },
        rows: { type: 'array', items: { type: 'object' } },
      },
      additionalProperties: false,
    },
  });

// ── 31. geo-fence ─────────────────────────────────────────────────────

export const renderGeoFenceTool: Tool<unknown, AgUiUiPartByKind<'geo-fence'>> =
  createRenderBlockTool<AgUiUiPartByKind<'geo-fence'>>({
    name: 'render-blocks.geo-fence',
    kind: 'geo-fence',
    description:
      'Render a drawable map for defining an alert zone (e.g. "notify me ' +
      'when a tenant\'s vehicle leaves this perimeter"). Click-to-add ' +
      'vertices when editable=true; emits genui:geo-fence-change with ' +
      'the polygon.',
    schema: GeoFencePartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['center', 'zoom'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        center: {
          type: 'array',
          minItems: 2,
          maxItems: 2,
          items: { type: 'number' },
        },
        zoom: { type: 'integer', minimum: 0, maximum: 20 },
        fence: { type: 'array', items: { type: 'object' } },
        editable: { type: 'boolean' },
        onChangeAction: { type: 'string' },
      },
      additionalProperties: false,
    },
  });

// ── 32. notification-toast ────────────────────────────────────────────

export const renderNotificationToastTool: Tool<unknown, AgUiUiPartByKind<'notification-toast'>> =
  createRenderBlockTool<AgUiUiPartByKind<'notification-toast'>>({
    name: 'render-blocks.notification-toast',
    kind: 'notification-toast',
    description:
      'Render a server-pushed ephemeral toast confirmation (vs. timeline ' +
      'which is historical). Use for "Payment posted", "Notice sent", ' +
      '"Lease saved" confirmations. Auto-dismisses after autoCloseMs.',
    schema: NotificationToastPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['message', 'severity'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        message: { type: 'string' },
        severity: {
          type: 'string',
          enum: ['info', 'success', 'warning', 'error'],
        },
        autoCloseMs: { type: 'integer', minimum: 0, maximum: 60000 },
        actionLabel: { type: 'string' },
        actionPayload: { type: 'object' },
      },
      additionalProperties: false,
    },
  });

// ── 33. decision-trace ────────────────────────────────────────────────

export const renderDecisionTraceTool: Tool<unknown, AgUiUiPartByKind<'decision-trace'>> =
  createRenderBlockTool<AgUiUiPartByKind<'decision-trace'>>({
    name: 'render-blocks.decision-trace',
    kind: 'decision-trace',
    description:
      "Render the kernel's own provenance + reasoning trail. Each step " +
      'is observation | inference | tool-call | decision | output with ' +
      'a rationale + optional evidence links. Use for transparency: ' +
      '"why did Mr. Mwikila propose this?".',
    schema: DecisionTracePartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['steps'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        summary: { type: 'string', maxLength: 2000 },
        steps: { type: 'array', items: { type: 'object' } },
      },
      additionalProperties: false,
    },
  });

// ── 34. code-block ────────────────────────────────────────────────────

export const renderCodeBlockTool: Tool<unknown, AgUiUiPartByKind<'code-block'>> =
  createRenderBlockTool<AgUiUiPartByKind<'code-block'>>({
    name: 'render-blocks.code-block',
    kind: 'code-block',
    description:
      'Render SQL / log / JSON / TypeScript / Python / bash with light ' +
      'syntax-highlight + copy-to-clipboard. Use for query traces, audit ' +
      'log slices, CLI examples. NEVER use to emit executable code as ' +
      'an instruction — just for display.',
    schema: CodeBlockPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['code', 'language'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        code: { type: 'string' },
        language: {
          type: 'string',
          enum: ['sql', 'json', 'log', 'text', 'bash', 'typescript', 'python'],
        },
        filename: { type: 'string' },
        highlightLines: { type: 'array', items: { type: 'integer' } },
      },
      additionalProperties: false,
    },
  });

// ── 35. dataflow-diagram ──────────────────────────────────────────────

export const renderDataflowDiagramTool: Tool<unknown, AgUiUiPartByKind<'dataflow-diagram'>> =
  createRenderBlockTool<AgUiUiPartByKind<'dataflow-diagram'>>({
    name: 'render-blocks.dataflow-diagram',
    kind: 'dataflow-diagram',
    description:
      'Render a node/edge dataflow diagram for an upcoming or running ' +
      'workflow. Use for surfaces like "here is what the monthly-close ' +
      'pipeline does"; nodes carry kind (source/transform/sink/decision) ' +
      'and optional status (pending/running/done/failed).',
    schema: DataflowDiagramPartSchema,
    inputJsonSchema: {
      type: 'object',
      required: ['nodes', 'edges'],
      properties: {
        title: { type: 'string', maxLength: 200 },
        nodes: { type: 'array', items: { type: 'object' } },
        edges: { type: 'array', items: { type: 'object' } },
      },
      additionalProperties: false,
    },
  });

// ─────────────────────────────────────────────────────────────────────
// Bundle — the convenience factory.
// ─────────────────────────────────────────────────────────────────────

export interface RenderBlockToolBundle {
  readonly chartVega: typeof renderChartVegaTool;
  readonly dataTable: typeof renderDataTableTool;
  readonly timeline: typeof renderTimelineTool;
  readonly kpiGrid: typeof renderKpiGridTool;
  readonly prefillForm: typeof renderPrefillFormTool;
  readonly approval: typeof renderApprovalTool;
  readonly workflow: typeof renderWorkflowTool;
  readonly map: typeof renderMapTool;
  readonly calendar: typeof renderCalendarTool;
  readonly filePreview: typeof renderFilePreviewTool;
  // ProdFix-7 Tier-1
  readonly kanban: typeof renderKanbanTool;
  readonly dashboardGrid: typeof renderDashboardGridTool;
  readonly heatmap: typeof renderHeatmapTool;
  readonly markdownCard: typeof renderMarkdownCardTool;
  readonly promptSuggestions: typeof renderPromptSuggestionsTool;
  readonly evidenceCard: typeof renderEvidenceCardTool;
  // ProdFix-7 Tier-2
  readonly tree: typeof renderTreeTool;
  readonly diffView: typeof renderDiffViewTool;
  readonly gauge: typeof renderGaugeTool;
  readonly metricSparkline: typeof renderMetricSparklineTool;
  readonly imageAnnotation: typeof renderImageAnnotationTool;
  readonly signaturePad: typeof renderSignaturePadTool;
  // Phase E.7
  readonly pdfViewer: typeof renderPdfViewerTool;
  readonly sliderInput: typeof renderSliderInputTool;
  readonly multistepWizard: typeof renderMultistepWizardTool;
  readonly mediaGrid: typeof renderMediaGridTool;
  readonly chatEmbed: typeof renderChatEmbedTool;
  readonly liveCounter: typeof renderLiveCounterTool;
  readonly orgChart: typeof renderOrgChartTool;
  readonly comparisonTable: typeof renderComparisonTableTool;
  readonly geoFence: typeof renderGeoFenceTool;
  readonly notificationToast: typeof renderNotificationToastTool;
  readonly decisionTrace: typeof renderDecisionTraceTool;
  readonly codeBlock: typeof renderCodeBlockTool;
  readonly dataflowDiagram: typeof renderDataflowDiagramTool;
  readonly all: ReadonlyArray<Tool>;
}

/**
 * Build the full render-block tool bundle. Wire into the
 * BrainToolRegistry alongside HQ tools (coordinate barrel with C2):
 *
 *   const renderBlocks = createRenderBlockTools();
 *   registry.registerAll(renderBlocks.all);
 */
export function createRenderBlockTools(): RenderBlockToolBundle {
  const all: ReadonlyArray<Tool> = Object.freeze([
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
    // ProdFix-7 Tier-1
    renderKanbanTool,
    renderDashboardGridTool,
    renderHeatmapTool,
    renderMarkdownCardTool,
    renderPromptSuggestionsTool,
    renderEvidenceCardTool,
    // ProdFix-7 Tier-2
    renderTreeTool,
    renderDiffViewTool,
    renderGaugeTool,
    renderMetricSparklineTool,
    renderImageAnnotationTool,
    renderSignaturePadTool,
    // Phase E.7 — 13 new tools
    renderPdfViewerTool,
    renderSliderInputTool,
    renderMultistepWizardTool,
    renderMediaGridTool,
    renderChatEmbedTool,
    renderLiveCounterTool,
    renderOrgChartTool,
    renderComparisonTableTool,
    renderGeoFenceTool,
    renderNotificationToastTool,
    renderDecisionTraceTool,
    renderCodeBlockTool,
    renderDataflowDiagramTool,
  ] as ReadonlyArray<Tool>);

  return {
    chartVega: renderChartVegaTool,
    dataTable: renderDataTableTool,
    timeline: renderTimelineTool,
    kpiGrid: renderKpiGridTool,
    prefillForm: renderPrefillFormTool,
    approval: renderApprovalTool,
    workflow: renderWorkflowTool,
    map: renderMapTool,
    calendar: renderCalendarTool,
    filePreview: renderFilePreviewTool,
    kanban: renderKanbanTool,
    dashboardGrid: renderDashboardGridTool,
    heatmap: renderHeatmapTool,
    markdownCard: renderMarkdownCardTool,
    promptSuggestions: renderPromptSuggestionsTool,
    evidenceCard: renderEvidenceCardTool,
    tree: renderTreeTool,
    diffView: renderDiffViewTool,
    gauge: renderGaugeTool,
    metricSparkline: renderMetricSparklineTool,
    imageAnnotation: renderImageAnnotationTool,
    signaturePad: renderSignaturePadTool,
    // Phase E.7
    pdfViewer: renderPdfViewerTool,
    sliderInput: renderSliderInputTool,
    multistepWizard: renderMultistepWizardTool,
    mediaGrid: renderMediaGridTool,
    chatEmbed: renderChatEmbedTool,
    liveCounter: renderLiveCounterTool,
    orgChart: renderOrgChartTool,
    comparisonTable: renderComparisonTableTool,
    geoFence: renderGeoFenceTool,
    notificationToast: renderNotificationToastTool,
    decisionTrace: renderDecisionTraceTool,
    codeBlock: renderCodeBlockTool,
    dataflowDiagram: renderDataflowDiagramTool,
    all,
  };
}
