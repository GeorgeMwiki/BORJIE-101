import { describe, expect, it } from 'vitest';
import {
  generateProposal,
  generateStubProposal,
} from '../decisions/proposal-generator.js';
import type { FailingSignal, TabRecipeRow } from '../types.js';
import type { FormSchema } from '@borjie/dynamic-ui';

const RECIPE: TabRecipeRow = {
  id: 'buyer_kyb_start',
  version: 1,
  status: 'live',
  intent: 'BuyerKYBStart',
  composeFnRef: '@borjie/dynamic-ui/recipes/buyer-kyb-start',
  authorityTier: 1,
  brand: 'borjie',
  promotedAtIso: '2026-04-01T00:00:00.000Z',
  promotedBy: 'owner',
  lockedAtIso: null,
  createdAtIso: '2026-04-01T00:00:00.000Z',
  updatedAtIso: '2026-04-01T00:00:00.000Z',
};

const SCHEMA: FormSchema = {
  title_en: 'Buyer KYB Start',
  title_sw: 'Mwanzo wa KYB',
  groups: [
    {
      id: 'identity',
      title_en: 'Identity',
      title_sw: 'Utambulisho',
      fields: [
        {
          id: 'tin_number',
          kind: 'text',
          label_en: 'TIN',
          label_sw: 'TIN',
          required: true,
        },
      ],
    },
  ],
  submit_action: {
    form_id: 'buyer_kyb',
    url: '/api/gateway/forms/buyer_kyb',
    method: 'POST',
  },
  evidence_ids: ['TUMEMADINI-4.2'],
};

const SIGNALS: ReadonlyArray<FailingSignal> = [
  {
    kind: 'high_tooltip_hit',
    fieldId: 'tin_number',
    value: 0.6,
    threshold: 0.4,
    humanReadable: "Field 'tin_number' has 60% tooltip-hit rate.",
  },
];

describe('generateStubProposal', () => {
  it('adds an add_help_copy op citing the first known citation', () => {
    const out = generateStubProposal({
      recipe: RECIPE,
      currentSchema: SCHEMA,
      failingSignals: SIGNALS,
      knownCitations: ['TUMEMADINI-4.2'],
    });
    expect(out.diff.ops.length).toBeGreaterThanOrEqual(1);
    const helpOp = out.diff.ops.find((op) => op.op === 'add_help_copy');
    expect(helpOp).toBeDefined();
    if (helpOp?.op === 'add_help_copy') {
      expect(helpOp.citationId).toBe('TUMEMADINI-4.2');
      expect(helpOp.fieldId).toBe('tin_number');
    }
  });

  it('produces bilingual rationales', () => {
    const out = generateStubProposal({
      recipe: RECIPE,
      currentSchema: SCHEMA,
      failingSignals: SIGNALS,
      knownCitations: ['TUMEMADINI-4.2'],
    });
    expect(out.diff.rationaleEn.length).toBeGreaterThan(0);
    expect(out.diff.rationaleSw.length).toBeGreaterThan(0);
  });

  it('produces at least one op even with empty failing signals (light-touch)', () => {
    const out = generateStubProposal({
      recipe: RECIPE,
      currentSchema: SCHEMA,
      failingSignals: [],
      knownCitations: [],
    });
    expect(out.diff.ops.length).toBeGreaterThanOrEqual(1);
  });
});

describe('generateProposal dispatcher', () => {
  it('mode=stub falls back to the deterministic stub', async () => {
    const out = await generateProposal({
      recipe: RECIPE,
      currentSchema: SCHEMA,
      failingSignals: SIGNALS,
      knownCitations: ['TUMEMADINI-4.2'],
      mode: 'stub',
    });
    expect(out.citations).toEqual(['TUMEMADINI-4.2']);
  });

  it('mode=llm without a wired client also falls back to stub', async () => {
    const out = await generateProposal({
      recipe: RECIPE,
      currentSchema: SCHEMA,
      failingSignals: SIGNALS,
      knownCitations: ['TUMEMADINI-4.2'],
      mode: 'llm',
    });
    expect(out.diff.ops.length).toBeGreaterThanOrEqual(1);
  });

  it('mode=llm with a wired client parses well-formed JSON', async () => {
    const llmClient = {
      provider: 'anthropic' as const,
      async invoke() {
        return {
          id: 'r1',
          model: 'claude-haiku-4-5',
          provider: 'anthropic' as const,
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 100, outputTokens: 200 },
          latencyMs: 123,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                ops: [
                  {
                    op: 'rename_label',
                    fieldId: 'tin_number',
                    labelEnBefore: 'TIN',
                    labelEnAfter: 'Tax Identification Number',
                    labelSwBefore: 'TIN',
                    labelSwAfter: 'Nambari ya Utambulisho wa Kodi',
                  },
                ],
                rationaleEn: 'Operators do not recognise the abbreviation.',
                rationaleSw: 'Watumiaji hawatambui kifupisho.',
              }),
            },
          ],
        };
      },
    };
    const out = await generateProposal({
      recipe: RECIPE,
      currentSchema: SCHEMA,
      failingSignals: SIGNALS,
      knownCitations: ['TUMEMADINI-4.2'],
      mode: 'llm',
      llmClient,
      model: 'claude-haiku-4-5',
    });
    expect(out.diff.ops).toHaveLength(1);
    expect(out.diff.ops[0]?.op).toBe('rename_label');
    expect(out.diff.rationaleEn).toMatch(/abbreviation/);
  });

  it('drops Tier-2 ops returned by the LLM (defense-in-depth)', async () => {
    const llmClient = {
      provider: 'anthropic' as const,
      async invoke() {
        return {
          id: 'r1',
          model: 'claude-haiku-4-5',
          provider: 'anthropic' as const,
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 100, outputTokens: 200 },
          latencyMs: 123,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                ops: [
                  {
                    op: 'change_submit_action', // Tier-2 — should be dropped
                    fieldId: 'tin_number',
                  },
                  {
                    op: 'add_help_copy',
                    fieldId: 'tin_number',
                    helpEn: 'Enter TIN.',
                    helpSw: 'Andika TIN.',
                    citationId: 'TUMEMADINI-4.2',
                  },
                ],
                rationaleEn: 'A two-op proposal.',
                rationaleSw: 'Pendekezo la mabadiliko mawili.',
              }),
            },
          ],
        };
      },
    };
    const out = await generateProposal({
      recipe: RECIPE,
      currentSchema: SCHEMA,
      failingSignals: SIGNALS,
      knownCitations: ['TUMEMADINI-4.2'],
      mode: 'llm',
      llmClient,
      model: 'claude-haiku-4-5',
    });
    expect(out.diff.ops).toHaveLength(1);
    expect(out.diff.ops[0]?.op).toBe('add_help_copy');
  });

  it('falls back to minimal diff when the LLM returns garbage', async () => {
    const llmClient = {
      provider: 'anthropic' as const,
      async invoke() {
        return {
          id: 'r1',
          model: 'claude-haiku-4-5',
          provider: 'anthropic' as const,
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 100, outputTokens: 200 },
          latencyMs: 123,
          content: [{ type: 'text' as const, text: 'not even close to JSON' }],
        };
      },
    };
    const out = await generateProposal({
      recipe: RECIPE,
      currentSchema: SCHEMA,
      failingSignals: SIGNALS,
      knownCitations: ['TUMEMADINI-4.2'],
      mode: 'llm',
      llmClient,
      model: 'claude-haiku-4-5',
    });
    expect(out.diff.ops).toHaveLength(0);
    expect(out.diff.rationaleEn).toMatch(/human review/);
  });

  it('parses each Tier-1 op shape correctly', async () => {
    const llmClient = {
      provider: 'anthropic' as const,
      async invoke() {
        return {
          id: 'r1',
          model: 'claude-haiku-4-5',
          provider: 'anthropic' as const,
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 100, outputTokens: 200 },
          latencyMs: 123,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                ops: [
                  {
                    op: 'reorder_fields',
                    groupId: 'identity',
                    fieldIdsBefore: ['tin_number'],
                    fieldIdsAfter: ['tin_number'],
                  },
                  {
                    op: 'regroup_field',
                    fieldId: 'tin_number',
                    fromGroupId: 'identity',
                    toGroupId: 'compliance',
                  },
                  {
                    op: 'split_step',
                    groupId: 'identity',
                    intoGroupIds: ['identity_1', 'identity_2'],
                  },
                ],
                rationaleEn: 'Full restructure.',
                rationaleSw: 'Marekebisho makubwa.',
              }),
            },
          ],
        };
      },
    };
    const out = await generateProposal({
      recipe: RECIPE,
      currentSchema: SCHEMA,
      failingSignals: SIGNALS,
      knownCitations: ['TUMEMADINI-4.2'],
      mode: 'llm',
      llmClient,
      model: 'claude-haiku-4-5',
    });
    expect(out.diff.ops).toHaveLength(3);
    expect(out.diff.ops.map((o) => o.op)).toEqual([
      'reorder_fields',
      'regroup_field',
      'split_step',
    ]);
  });
});
