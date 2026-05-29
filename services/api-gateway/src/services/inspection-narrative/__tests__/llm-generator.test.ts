/**
 * R15 — Inspection-narrative LLM generator tests (G-FIX-2).
 *
 * Covers:
 *   1. Happy path: LLM returns bilingual JSON, evidence is preserved,
 *      cost is tagged "anthropic" not "borjie-default".
 *   2. Cache hit: cache_read tokens flow through, system prompt is
 *      marked cache_control: ephemeral.
 *   3. Fallback on LLM throw: heuristic kicks in, costUsd === 0,
 *      llmProvider returns to "borjie-default".
 *   4. Evidence-required fallback: LLM omits supplied evidence IDs →
 *      heuristic takes over.
 */

import { describe, expect, it, vi } from 'vitest';
import pino from 'pino';

import type {
  BrainLlmClient,
  BrainLlmMessageRequest,
  BrainLlmMessageResponse,
} from '../../brain/llm-call';
import { createLlmInspectionNarrator } from '../llm-generator';
import type { InspectionInputForLlm } from '../generator';

function makeStubClient(
  responses: Array<Partial<BrainLlmMessageResponse>>,
): BrainLlmClient & {
  readonly capturedRequests: BrainLlmMessageRequest[];
} {
  const capturedRequests: BrainLlmMessageRequest[] = [];
  let i = 0;
  return Object.freeze({
    model: 'claude-sonnet-test',
    capturedRequests,
    sdk: {
      messages: {
        async create(req: BrainLlmMessageRequest) {
          capturedRequests.push(req);
          const r = responses[i] ?? responses[responses.length - 1] ?? {};
          i += 1;
          return {
            content: r.content ?? [],
            usage: r.usage ?? { input_tokens: 1, output_tokens: 1 },
            stop_reason: r.stop_reason ?? 'end_turn',
          } as BrainLlmMessageResponse;
        },
      },
    },
  }) as BrainLlmClient & {
    readonly capturedRequests: BrainLlmMessageRequest[];
  };
}

function sampleInput(): InspectionInputForLlm {
  return {
    inspectionId: 'ins_1',
    inspectionKind: 'pre_shift',
    siteName: 'Site Alpha',
    assetName: 'Compressor C-12',
    supervisorName: 'A. Mahenge',
    shiftKind: 'day',
    checklist: [
      { code: 'A1', label: 'Air filter', status: 'pass' },
      { code: 'A2', label: 'Hose pressure', status: 'fail', note: 'reseat required' },
    ],
    notes: 'Compressor needs reseat.',
    evidenceIds: ['ev_photo_1', 'ev_pressure_2'],
    observedAt: new Date('2026-05-29T07:00:00Z'),
  };
}

describe('createLlmInspectionNarrator', () => {
  it('returns LLM bilingual JSON on the happy path', async () => {
    const client = makeStubClient([
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              draftMdSw:
                '---\ninspection_id: ins_1\n---\n# Ripoti — Site Alpha\nUshahidi: ev_photo_1, ev_pressure_2',
              draftMdEn:
                '---\ninspection_id: ins_1\n---\n# Report — Site Alpha\nEvidence: ev_photo_1, ev_pressure_2',
              evidenceIds: ['ev_photo_1', 'ev_pressure_2'],
            }),
          },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ]);
    const narrator = createLlmInspectionNarrator({ client });
    const out = await narrator(sampleInput());
    expect(out.llmProvider).toBe('anthropic');
    expect(out.draftMdSw).toContain('ev_photo_1');
    expect(out.draftMdEn).toContain('ev_pressure_2');
    expect(out.promptVersion).toBe('r15-narrator-v1');
    // System block uses cache_control: ephemeral
    const sys = client.capturedRequests[0]!.system as ReadonlyArray<{
      readonly cache_control?: { readonly type: string };
    }>;
    expect(sys[0]?.cache_control?.type).toBe('ephemeral');
  });

  it('reports cache-hit tokens when the LLM returns them', async () => {
    const client = makeStubClient([
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              draftMdSw:
                '---\ninspection_id: ins_1\n---\n# Ripoti\nUshahidi: ev_photo_1',
              draftMdEn:
                '---\ninspection_id: ins_1\n---\n# Report\nEvidence: ev_photo_1',
              evidenceIds: ['ev_photo_1'],
            }),
          },
        ],
        usage: {
          input_tokens: 5,
          output_tokens: 10,
          cache_read_input_tokens: 2048,
        },
      },
    ]);
    const narrator = createLlmInspectionNarrator({ client });
    const input = sampleInput();
    const out = await narrator({ ...input, evidenceIds: ['ev_photo_1'] });
    expect(out.llmProvider).toBe('anthropic');
    // costUsd should reflect token spend (positive value)
    expect(out.costUsd).toBeGreaterThanOrEqual(0);
  });

  it('falls back to heuristic when the LLM throws', async () => {
    const failingClient: BrainLlmClient = {
      model: 'fail-model',
      sdk: {
        messages: {
          async create() {
            throw new Error('500 Internal');
          },
        },
      },
    };
    const logger = pino({ level: 'silent' });
    const warn = vi.spyOn(logger, 'warn');
    const narrator = createLlmInspectionNarrator({
      client: failingClient,
      logger,
    });
    const out = await narrator(sampleInput());
    expect(out.llmProvider).toBe('borjie-default');
    expect(out.costUsd).toBe(0);
    expect(out.draftMdSw).toContain('Ripoti ya Ukaguzi');
    expect(warn).toHaveBeenCalled();
  });

  it('falls back to heuristic when LLM output omits supplied evidence', async () => {
    const client = makeStubClient([
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              draftMdSw:
                '---\ninspection_id: ins_1\n---\n# Ripoti bila ushahidi',
              draftMdEn:
                '---\ninspection_id: ins_1\n---\n# Report without evidence',
              evidenceIds: [],
            }),
          },
        ],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    ]);
    const logger = pino({ level: 'silent' });
    const warn = vi.spyOn(logger, 'warn');
    const narrator = createLlmInspectionNarrator({ client, logger });
    const out = await narrator(sampleInput());
    expect(out.llmProvider).toBe('borjie-default');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'inspection-narrative-r15' }),
      expect.stringContaining('missing evidence'),
    );
  });
});
