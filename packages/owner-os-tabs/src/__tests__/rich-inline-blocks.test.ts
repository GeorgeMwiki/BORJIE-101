import { describe, expect, it } from 'vitest';

import {
  inlineBlockSchema,
  inlineTableSchema,
  inlineChartSchema,
  inlineWizardSchema,
  inlineWorkflowSchema,
  inlineComparisonSchema,
  inlineSectionSchema,
  inlineDashboardSchema,
  richInlineBlockSchema,
  RICH_INLINE_BLOCK_TYPES,
  INLINE_BLOCK_TYPES,
  parseInlineBlocks,
  type InlineBlock,
} from '../index.js';

// ─── 1. inline_table ─────────────────────────────────────────────────

describe('inline_table schema', () => {
  it('parses a valid PMLs-expiring table', () => {
    const block = {
      type: 'inline_table' as const,
      title: { en: 'PMLs expiring soon', sw: 'PML zinazoisha hivi karibuni' },
      columns: [
        {
          key: 'licence',
          label: { en: 'Licence', sw: 'Leseni' },
          kind: 'text' as const,
        },
        {
          key: 'days',
          label: { en: 'Days', sw: 'Siku' },
          kind: 'number' as const,
        },
        {
          key: 'status',
          label: { en: 'Status', sw: 'Hali' },
          kind: 'status_pill' as const,
        },
      ],
      rows: [
        { id: 'pml-0241', licence: 'PML/0241/2023', days: 23, status: 'queued' },
        { id: 'pml-0312', licence: 'PML/0312/2023', days: 47, status: 'needs-signoff' },
      ],
      pageSize: 8,
      tabPromotion: {
        tabType: 'licences' as const,
        contextTemplate: { focus: 'expiring_90d' },
        label: { en: 'See full licence calendar', sw: 'Kalenda kamili' },
      },
    };
    const parsed = inlineTableSchema.safeParse(block);
    expect(parsed.success).toBe(true);
  });

  it('rejects empty columns', () => {
    const bad = {
      type: 'inline_table',
      title: { en: 'X', sw: 'X' },
      columns: [],
      rows: [],
    };
    expect(inlineTableSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown column kind', () => {
    const bad = {
      type: 'inline_table',
      title: { en: 'X', sw: 'X' },
      columns: [
        {
          key: 'a',
          label: { en: 'A', sw: 'A' },
          kind: 'video',
        },
      ],
      rows: [],
    };
    expect(inlineTableSchema.safeParse(bad).success).toBe(false);
  });
});

// ─── 2. inline_chart ────────────────────────────────────────────────

describe('inline_chart schema', () => {
  it('parses a valid 30-day royalty line chart', () => {
    const block = {
      type: 'inline_chart' as const,
      kind: 'line' as const,
      title: { en: 'April royalty trend', sw: 'Mwenendo wa mrabaha Aprili' },
      series: [
        {
          name: 'TZS millions',
          color: 'gold',
          points: [
            { x: '2026-04-01', y: 14.2 },
            { x: '2026-04-15', y: 18.4 },
            { x: '2026-04-30', y: 22.1 },
          ],
        },
      ],
      height: 220,
    };
    expect(inlineChartSchema.safeParse(block).success).toBe(true);
  });

  it('accepts annotations and tabPromotion', () => {
    const block = {
      type: 'inline_chart',
      kind: 'bar',
      title: { en: 'X', sw: 'X' },
      series: [
        {
          name: 'A',
          color: 'amber',
          points: [
            { x: 1, y: 1 },
            { x: 2, y: 4 },
          ],
        },
      ],
      annotations: [
        {
          at: 2,
          label: { en: 'Filing deadline', sw: 'Mwisho wa kufaili' },
          kind: 'line',
        },
      ],
      tabPromotion: {
        tabType: 'finance',
        contextTemplate: {},
        label: { en: 'Open full P&L', sw: 'Fungua P&L kamili' },
      },
    };
    expect(inlineChartSchema.safeParse(block).success).toBe(true);
  });

  it('rejects unknown chart kind', () => {
    const bad = {
      type: 'inline_chart',
      kind: 'radar',
      title: { en: 'X', sw: 'X' },
      series: [],
    };
    expect(inlineChartSchema.safeParse(bad).success).toBe(false);
  });
});

// ─── 3. inline_wizard ───────────────────────────────────────────────

describe('inline_wizard schema', () => {
  it('parses a valid 3-step NEMC EIA wizard', () => {
    const block = {
      type: 'inline_wizard' as const,
      purpose: 'nemc_eia_renewal',
      steps: [
        {
          id: 'site',
          title: { en: 'Site & licence', sw: 'Tovuti na leseni' },
          fields: [
            {
              key: 'siteId',
              label: { en: 'Which site', sw: 'Tovuti ipi' },
              kind: 'site-picker' as const,
              required: true,
            },
          ],
        },
        {
          id: 'impact',
          title: { en: 'Environmental scope', sw: 'Mazingira' },
          fields: [
            {
              key: 'hectares',
              label: { en: 'Hectares', sw: 'Hekta' },
              kind: 'number' as const,
              required: true,
            },
          ],
        },
        {
          id: 'submit',
          title: { en: 'Confirm', sw: 'Thibitisha' },
          intro: { en: 'Review before send', sw: 'Hakiki' },
          fields: [],
        },
      ],
      submitAction: 'file_nemc_eia_renewal',
    };
    expect(inlineWizardSchema.safeParse(block).success).toBe(true);
  });

  it('honours skipIf condition shape', () => {
    const block = {
      type: 'inline_wizard',
      purpose: 'p',
      steps: [
        {
          id: 'a',
          title: { en: 'A', sw: 'A' },
          fields: [],
          skipIf: { fieldKey: 'waterNearby', equals: 'no' },
        },
      ],
      submitAction: 'do_it',
    };
    expect(inlineWizardSchema.safeParse(block).success).toBe(true);
  });
});

// ─── 4. inline_workflow ─────────────────────────────────────────────

describe('inline_workflow schema', () => {
  it('parses a 4-step checklist with mixed status', () => {
    const block = {
      type: 'inline_workflow' as const,
      title: { en: 'Geita PML renewal', sw: 'Upyaji wa PML Geita' },
      steps: [
        {
          id: 'pull-letter',
          label: { en: 'Pull current EIA letter', sw: 'Toa barua ya EIA' },
          status: 'done' as const,
        },
        {
          id: 'review',
          label: { en: 'Owner review', sw: 'Mmiliki ahakiki' },
          status: 'in_progress' as const,
        },
        {
          id: 'sign',
          label: { en: 'Sign-off', sw: 'Sahihi' },
          status: 'pending' as const,
          action: {
            label: { en: 'Sign now', sw: 'Sahihi sasa' },
            kind: 'micro_action_card' as const,
            payload: { renewalId: 'r-001' },
          },
        },
        {
          id: 'submit',
          label: { en: 'File to NEMC', sw: 'Tuma kwa NEMC' },
          status: 'blocked' as const,
          blockedReason: {
            en: 'Awaiting sign-off',
            sw: 'Inangoja sahihi',
          },
        },
      ],
    };
    expect(inlineWorkflowSchema.safeParse(block).success).toBe(true);
  });

  it('rejects unknown status', () => {
    const bad = {
      type: 'inline_workflow',
      title: { en: 'X', sw: 'X' },
      steps: [
        {
          id: 'a',
          label: { en: 'A', sw: 'A' },
          status: 'mid_air',
        },
      ],
    };
    expect(inlineWorkflowSchema.safeParse(bad).success).toBe(false);
  });
});

// ─── 5. inline_comparison ───────────────────────────────────────────

describe('inline_comparison schema', () => {
  it('parses a 2-option PML renewal comparison', () => {
    const block = {
      type: 'inline_comparison' as const,
      title: { en: 'PML renewal options', sw: 'Chaguzi za upyaji wa PML' },
      options: [
        {
          id: 'standard',
          headline: { en: 'Standard track', sw: 'Mfumo wa kawaida' },
          bullets: [
            { en: '47 day buffer', sw: 'Buffer ya siku 47' },
            { en: 'No expediting fee', sw: 'Hakuna ada ya haraka' },
          ],
          metrics: [
            {
              label: { en: 'Cost', sw: 'Gharama' },
              value: 'TZS 1.2M',
              tone: 'neutral' as const,
            },
          ],
          chooseAction: {
            label: { en: 'Choose standard', sw: 'Chagua kawaida' },
            kind: 'micro_action_card' as const,
            payload: { track: 'standard' },
          },
        },
        {
          id: 'expedited',
          headline: { en: 'Expedited track', sw: 'Mfumo wa haraka' },
          bullets: [{ en: '14 day turnaround', sw: 'Siku 14' }],
          metrics: [
            {
              label: { en: 'Cost', sw: 'Gharama' },
              value: 'TZS 1.8M',
              tone: 'warning' as const,
            },
          ],
          recommendedReason: {
            en: 'Buffer is tight',
            sw: 'Buffer ni ndogo',
          },
          chooseAction: {
            label: { en: 'Choose expedited', sw: 'Chagua haraka' },
            kind: 'micro_action_card' as const,
            payload: { track: 'expedited' },
          },
        },
      ],
      highlightOptionId: 'expedited',
    };
    expect(inlineComparisonSchema.safeParse(block).success).toBe(true);
  });

  it('rejects single-option comparison', () => {
    const bad = {
      type: 'inline_comparison',
      title: { en: 'X', sw: 'X' },
      options: [
        {
          id: 'a',
          headline: { en: 'A', sw: 'A' },
          bullets: [{ en: 'one', sw: 'moja' }],
          metrics: [],
          chooseAction: {
            label: { en: 'Pick', sw: 'Chagua' },
            kind: 'micro_action_card',
          },
        },
      ],
    };
    expect(inlineComparisonSchema.safeParse(bad).success).toBe(false);
  });
});

// ─── 6 + 7. Recursive containers ────────────────────────────────────

describe('inline_section (recursive) schema', () => {
  it('accepts nested mini_metric children', () => {
    const block = {
      type: 'inline_section' as const,
      title: { en: 'Compliance', sw: 'Utii' },
      defaultOpen: true,
      blocks: [
        {
          type: 'mini_metric',
          name: 'NEMC EIA Geita',
          value: '47 days',
          tone: 'warning',
        },
        {
          type: 'inline_workflow',
          title: { en: 'Renewal checklist', sw: 'Orodha ya upyaji' },
          steps: [
            {
              id: 'a',
              label: { en: 'A', sw: 'A' },
              status: 'done',
            },
          ],
        },
      ],
    };
    expect(inlineSectionSchema.safeParse(block).success).toBe(true);
  });

  it('rejects empty blocks list', () => {
    const bad = {
      type: 'inline_section',
      title: { en: 'X', sw: 'X' },
      blocks: [],
    };
    expect(inlineSectionSchema.safeParse(bad).success).toBe(false);
  });
});

describe('inline_dashboard (recursive) schema', () => {
  it('accepts a 4-cell grid_2x2 with mixed cell types', () => {
    const block = {
      type: 'inline_dashboard' as const,
      title: { en: 'Today at Geita', sw: 'Leo Geita' },
      layout: 'grid_2x2' as const,
      cells: [
        {
          type: 'mini_metric',
          name: 'Tonnage today',
          value: '42 t',
          tone: 'positive',
        },
        {
          type: 'mini_metric',
          name: 'Open incidents',
          value: '0',
          tone: 'positive',
        },
        {
          type: 'inline_chart',
          kind: 'sparkline',
          title: { en: 'Royalty trail', sw: 'Mwenendo wa mrabaha' },
          series: [
            {
              name: 'TZS',
              color: 'gold',
              points: [
                { x: 1, y: 10 },
                { x: 2, y: 12 },
              ],
            },
          ],
        },
        {
          type: 'micro_action_card',
          label: { en: 'Open EIA draft', sw: 'Fungua rasimu ya EIA' },
          action: 'open_eia_draft',
          payload: {},
        },
      ],
      refreshIntervalSeconds: 60,
    };
    expect(inlineDashboardSchema.safeParse(block).success).toBe(true);
  });

  it('rejects unknown layout', () => {
    const bad = {
      type: 'inline_dashboard',
      title: { en: 'X', sw: 'X' },
      layout: 'pyramid',
      cells: [{ type: 'mini_metric', name: 'a', value: 'b' }],
    };
    expect(inlineDashboardSchema.safeParse(bad).success).toBe(false);
  });
});

// ─── Discriminated union ────────────────────────────────────────────

describe('inlineBlockSchema (combined union)', () => {
  it('narrows by type for every rich kind', () => {
    const samples: ReadonlyArray<{ type: string }> = [
      {
        type: 'inline_table',
      },
      {
        type: 'inline_chart',
      },
      {
        type: 'inline_wizard',
      },
      {
        type: 'inline_workflow',
      },
      {
        type: 'inline_comparison',
      },
      {
        type: 'inline_section',
      },
      {
        type: 'inline_dashboard',
      },
    ];
    for (const s of samples) {
      expect(RICH_INLINE_BLOCK_TYPES).toContain(s.type as never);
      expect(INLINE_BLOCK_TYPES).toContain(s.type as never);
    }
  });

  it('rich and layer-1 types are both in the master list', () => {
    expect(INLINE_BLOCK_TYPES).toContain('mini_metric');
    expect(INLINE_BLOCK_TYPES).toContain('inline_dashboard');
    expect(INLINE_BLOCK_TYPES).toContain('inline_section');
  });

  it('richInlineBlockSchema accepts an inline_section', () => {
    const block = {
      type: 'inline_section',
      title: { en: 'X', sw: 'X' },
      blocks: [
        {
          type: 'mini_metric',
          name: 'A',
          value: '1',
        },
      ],
    };
    expect(richInlineBlockSchema.safeParse(block).success).toBe(true);
  });
});

// ─── parser end-to-end ──────────────────────────────────────────────

describe('parseInlineBlocks with rich blocks', () => {
  it('extracts an inline_table block and strips it from body', () => {
    const text =
      'Here is the list.\n<ui_block>{"type":"inline_table","title":{"en":"X","sw":"X"},"columns":[{"key":"a","label":{"en":"A","sw":"A"},"kind":"text"}],"rows":[]}</ui_block>\nDone.';
    const { body, blocks } = parseInlineBlocks(text);
    expect(blocks.length).toBe(1);
    const first = blocks[0] as InlineBlock;
    expect(first.type).toBe('inline_table');
    expect(body).not.toContain('<ui_block>');
  });

  it('extracts a mix of layer-1 and rich blocks', () => {
    const text = [
      '<ui_block>{"type":"mini_metric","name":"X","value":"1"}</ui_block>',
      '<ui_block>{"type":"inline_workflow","title":{"en":"X","sw":"X"},"steps":[{"id":"a","label":{"en":"A","sw":"A"},"status":"done"}]}</ui_block>',
    ].join('\n');
    const { blocks } = parseInlineBlocks(text);
    expect(blocks.map((b: InlineBlock) => b.type)).toEqual([
      'mini_metric',
      'inline_workflow',
    ]);
  });

  it('drops malformed rich blocks silently', () => {
    const text =
      '<ui_block>{"type":"inline_table","title":{},"columns":[],"rows":[]}</ui_block>';
    const { blocks } = parseInlineBlocks(text);
    expect(blocks.length).toBe(0);
  });

  it('accepts inline_section with nested blocks via the master union', () => {
    const text = JSON.stringify({
      type: 'inline_section',
      title: { en: 'Compliance', sw: 'Utii' },
      blocks: [
        { type: 'mini_metric', name: 'A', value: '1' },
        { type: 'micro_action_card', label: { en: 'X', sw: 'X' }, action: 'do' },
      ],
    });
    const wrapped = `<ui_block>${text}</ui_block>`;
    const { blocks } = parseInlineBlocks(wrapped);
    expect(blocks.length).toBe(1);
    expect((blocks[0] as InlineBlock).type).toBe('inline_section');
  });
});

// ─── Constraints summary ────────────────────────────────────────────

describe('union constraints', () => {
  it('inlineBlockSchema is one of 16 known block types', () => {
    expect(INLINE_BLOCK_TYPES).toHaveLength(16);
  });

  it('rich union enumerates exactly 7 entries', () => {
    expect(RICH_INLINE_BLOCK_TYPES).toHaveLength(7);
  });

  it('parses each rich type via the master union', () => {
    const minimal = {
      inline_table: {
        type: 'inline_table',
        title: { en: 'X', sw: 'X' },
        columns: [
          {
            key: 'a',
            label: { en: 'A', sw: 'A' },
            kind: 'text',
          },
        ],
        rows: [],
      },
      inline_chart: {
        type: 'inline_chart',
        kind: 'bar',
        title: { en: 'X', sw: 'X' },
        series: [
          {
            name: 'A',
            color: 'gold',
            points: [{ x: 1, y: 1 }],
          },
        ],
      },
      inline_wizard: {
        type: 'inline_wizard',
        purpose: 'p',
        steps: [
          {
            id: 'a',
            title: { en: 'A', sw: 'A' },
            fields: [],
          },
        ],
        submitAction: 'do',
      },
      inline_workflow: {
        type: 'inline_workflow',
        title: { en: 'X', sw: 'X' },
        steps: [
          {
            id: 'a',
            label: { en: 'A', sw: 'A' },
            status: 'done',
          },
        ],
      },
      inline_comparison: {
        type: 'inline_comparison',
        title: { en: 'X', sw: 'X' },
        options: [
          {
            id: 'a',
            headline: { en: 'A', sw: 'A' },
            bullets: [{ en: 'b', sw: 'b' }],
            metrics: [],
            chooseAction: {
              label: { en: 'Pick', sw: 'Chagua' },
              kind: 'micro_action_card',
            },
          },
          {
            id: 'b',
            headline: { en: 'B', sw: 'B' },
            bullets: [{ en: 'b', sw: 'b' }],
            metrics: [],
            chooseAction: {
              label: { en: 'Pick', sw: 'Chagua' },
              kind: 'micro_action_card',
            },
          },
        ],
      },
      inline_section: {
        type: 'inline_section',
        title: { en: 'X', sw: 'X' },
        blocks: [{ type: 'mini_metric', name: 'A', value: '1' }],
      },
      inline_dashboard: {
        type: 'inline_dashboard',
        title: { en: 'X', sw: 'X' },
        layout: 'grid_2x2',
        cells: [{ type: 'mini_metric', name: 'A', value: '1' }],
      },
    };
    for (const sample of Object.values(minimal)) {
      const parsed = inlineBlockSchema.safeParse(sample);
      if (!parsed.success) {
        // eslint-disable-next-line no-console
        console.error('Failed:', sample, parsed.error.format());
      }
      expect(parsed.success).toBe(true);
    }
  });
});
