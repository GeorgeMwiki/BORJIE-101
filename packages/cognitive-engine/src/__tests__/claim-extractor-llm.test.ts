/**
 * R17 — RAG citation-claim extractor LLM lift tests (G-FIX-2).
 *
 * Covers:
 *   1. Happy path: borderline sentence flipped to is_claim=true; cache
 *      marker present on system block; no markers invented.
 *   2. LLM throw → falls back to deterministic heuristic, warn logged.
 *   3. No client → short-circuits to heuristic.
 *   4. Anti-fabrication guard: LLM returns a marker not in the source
 *      sentence → wrapper drops the LLM judgement for that sentence
 *      and keeps the heuristic, warn logged.
 *   5. LLM shape violation → falls back to heuristic.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  classifySentencesWithLlm,
  type ClaimLlmClient,
  type ClaimLlmRequest,
  type ClaimLlmResponse,
} from '../grounding/claim-extractor-llm.js';

function makeStubClient(
  responses: Array<Partial<ClaimLlmResponse>>,
): ClaimLlmClient & {
  readonly capturedRequests: ClaimLlmRequest[];
} {
  const capturedRequests: ClaimLlmRequest[] = [];
  let i = 0;
  return {
    model: 'claude-test',
    capturedRequests,
    messages: {
      async create(req: ClaimLlmRequest) {
        capturedRequests.push(req);
        const r = responses[i] ?? responses[responses.length - 1] ?? {};
        i += 1;
        return {
          content: r.content ?? [],
          usage: r.usage ?? { input_tokens: 1, output_tokens: 1 },
        } as ClaimLlmResponse;
      },
    },
  } as ClaimLlmClient & { readonly capturedRequests: ClaimLlmRequest[] };
}

const BORDERLINE_TEXT =
  'The Tanzanian mining sector remains an important pillar of the national economy. ' +
  'A balanced regulatory regime supports artisanal miners and their cooperatives effectively.';

describe('classifySentencesWithLlm', () => {
  it('flips borderline sentence to claim when LLM says so + sends cache marker', async () => {
    const client = makeStubClient([
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              results: [
                { index: 0, is_claim: true, citation_markers: [] },
                { index: 1, is_claim: false, citation_markers: [] },
              ],
            }),
          },
        ],
      },
    ]);
    const out = await classifySentencesWithLlm(BORDERLINE_TEXT, { client });
    expect(out[0]?.is_claim).toBe(true);
    expect(out[1]?.is_claim).toBe(false);
    // System block uses cache_control: ephemeral
    const req = client.capturedRequests[0]!;
    const sys = req.system as ReadonlyArray<{
      readonly cache_control?: { readonly type: string };
    }>;
    expect(sys[0]?.cache_control?.type).toBe('ephemeral');
  });

  it('falls back to heuristic when LLM throws', async () => {
    const failing: ClaimLlmClient = {
      model: 'fail-model',
      messages: {
        async create() {
          throw new Error('500 Internal');
        },
      },
    };
    const warn = vi.fn();
    const out = await classifySentencesWithLlm(BORDERLINE_TEXT, {
      client: failing,
      logger: { warn },
    });
    expect(out).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'rag-citation-r17' }),
      expect.stringContaining('falling back'),
    );
  });

  it('returns heuristic unchanged when client is null', async () => {
    const out = await classifySentencesWithLlm(BORDERLINE_TEXT, {
      client: null,
    });
    // No LLM, no flips — both sentences stay heuristic-default (false).
    expect(out[0]?.is_claim).toBe(false);
    expect(out[1]?.is_claim).toBe(false);
  });

  it('drops LLM judgement when LLM invents a citation marker', async () => {
    const client = makeStubClient([
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              results: [
                {
                  index: 0,
                  is_claim: true,
                  citation_markers: ['cit_fabricated'],
                },
              ],
            }),
          },
        ],
      },
    ]);
    const warn = vi.fn();
    const out = await classifySentencesWithLlm(BORDERLINE_TEXT, {
      client,
      logger: { warn },
    });
    // Sentence 0 had no marker in the source text; LLM tried to add
    // one. Wrapper rejects and keeps the heuristic verdict.
    expect(out[0]?.citation_markers).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'rag-citation-r17',
        invented: ['cit_fabricated'],
      }),
      expect.stringContaining('invented citation markers'),
    );
  });

  it('falls back to heuristic when LLM JSON shape is invalid', async () => {
    const client = makeStubClient([
      {
        content: [
          { type: 'text', text: JSON.stringify({ wrong: 'shape' }) },
        ],
      },
    ]);
    const warn = vi.fn();
    const out = await classifySentencesWithLlm(BORDERLINE_TEXT, {
      client,
      logger: { warn },
    });
    expect(out).toHaveLength(2);
    expect(warn).toHaveBeenCalled();
  });

  it('does not call the LLM when there are no borderline sentences', async () => {
    const client = makeStubClient([{}]);
    // All-hedge / very-short sentences only — heuristic is enough.
    const text = 'We should think. We could try.';
    await classifySentencesWithLlm(text, { client });
    expect(client.capturedRequests).toHaveLength(0);
  });
});
