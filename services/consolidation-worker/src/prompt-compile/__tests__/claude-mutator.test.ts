/**
 * claude-mutator — unit tests.
 *
 * Coverage:
 *   1. identity fallback when client is null
 *   2. parses <candidate> tags
 *   3. parses numbered-list fallback
 *   4. single-blob fallback (no tags, no numbers)
 *   5. system prompt mentions "prompt engineer" + "property"
 *   6. user prompt carries capability + failing-case input
 *   7. mutationCount cap (>8 → 8) and floor (≤0 → 1)
 *   8. mutationCount honoured on emitted call
 *   9. dedupes identical candidate blocks
 *   10. empty currentPrompt → empty array
 *   11. API throw → identity fallback (returns current prompt)
 *   12. default model is claude-opus-4-20250514
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createClaudeMutator,
  buildMutatorUserPrompt,
  parseMutatorResponse,
  MUTATOR_SYSTEM_PROMPT,
  DEFAULT_MUTATOR_MODEL,
  type ClaudeMessagesClient,
  type GoldenCase,
} from '../claude-mutator.js';

function fakeClient(body: string): ClaudeMessagesClient {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: 'text', text: body }],
      })),
    },
  };
}

function throwingClient(): ClaudeMessagesClient {
  return {
    messages: {
      create: vi.fn(async () => {
        throw new Error('upstream 502');
      }),
    },
  };
}

const CASE: GoldenCase = {
  id: 'late-rent-reminder-sw-1',
  input: 'Kumbusha Juma kuhusu kodi.',
  expectedOutput: 'Habari Juma, kumbusho la kodi.',
  capability: 'late-rent-reminder',
};

describe('createClaudeMutator', () => {
  it('returns identity (current prompt) when client is null', async () => {
    const mut = createClaudeMutator({ anthropicClient: null });
    const out = await mut.mutate({
      currentPrompt: 'You draft Swahili reminders.',
      failureCase: CASE,
      capability: 'late-rent-reminder',
      mutationCount: 3,
    });
    expect(out).toEqual(['You draft Swahili reminders.']);
  });

  it('parses <candidate>...</candidate> blocks from the model', async () => {
    const body = [
      '<candidate>Variant A: be friendlier.</candidate>',
      '<candidate>Variant B: mention rent due date.</candidate>',
      '<candidate>Variant C: ask for confirmation.</candidate>',
    ].join('\n');
    const client = fakeClient(body);
    const mut = createClaudeMutator({ anthropicClient: client });
    const out = await mut.mutate({
      currentPrompt: 'Base.',
      failureCase: CASE,
      capability: 'late-rent-reminder',
      mutationCount: 3,
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toContain('Variant A');
    expect(out[2]).toContain('Variant C');
  });

  it('falls back to numbered-list parsing', () => {
    const parsed = parseMutatorResponse(
      '1. first candidate\n2. second candidate\n3. third candidate',
      3,
    );
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toContain('first');
  });

  it('treats unparseable body as a single candidate', () => {
    const parsed = parseMutatorResponse('just one paragraph here', 3);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toBe('just one paragraph here');
  });

  it('system prompt names the role and domain', () => {
    expect(MUTATOR_SYSTEM_PROMPT).toMatch(/prompt engineer/i);
    expect(MUTATOR_SYSTEM_PROMPT).toMatch(/property/i);
    expect(MUTATOR_SYSTEM_PROMPT).toMatch(/<candidate>/);
  });

  it('user prompt carries capability + failing case', () => {
    const built = buildMutatorUserPrompt({
      currentPrompt: 'Base prompt.',
      failureCase: CASE,
      capability: 'late-rent-reminder',
      mutationCount: 3,
    });
    expect(built).toContain('late-rent-reminder');
    expect(built).toContain('Kumbusha Juma');
    expect(built).toContain('Habari Juma');
  });

  it('caps mutationCount above 8 to 8 and below 1 to 1', async () => {
    const create = vi.fn(async () => ({
      content: [
        {
          type: 'text',
          text:
            '<candidate>a</candidate><candidate>b</candidate><candidate>c</candidate>',
        },
      ],
    }));
    const client: ClaudeMessagesClient = { messages: { create } };
    const mut = createClaudeMutator({ anthropicClient: client });
    await mut.mutate({
      currentPrompt: 'Base.',
      failureCase: CASE,
      capability: 'x',
      mutationCount: 99,
    });
    const call = create.mock.calls[0]?.[0] as { messages: { content: string }[] };
    expect(call.messages[0]?.content).toContain('Mutation count: 8');

    create.mockClear();
    await mut.mutate({
      currentPrompt: 'Base.',
      failureCase: CASE,
      capability: 'x',
      mutationCount: 0,
    });
    const call2 = create.mock.calls[0]?.[0] as { messages: { content: string }[] };
    expect(call2.messages[0]?.content).toContain('Mutation count: 1');
  });

  it('mutationCount is reflected in the user prompt verbatim', () => {
    const built = buildMutatorUserPrompt({
      currentPrompt: 'X.',
      failureCase: CASE,
      capability: 'c',
      mutationCount: 5,
    });
    expect(built).toContain('Mutation count: 5');
    expect(built).toContain('Emit 5 distinct');
  });

  it('dedupes identical <candidate> blocks', () => {
    const parsed = parseMutatorResponse(
      '<candidate>same</candidate><candidate>same</candidate><candidate>diff</candidate>',
      5,
    );
    expect(parsed).toEqual(['same', 'diff']);
  });

  it('returns empty array for empty currentPrompt', async () => {
    const mut = createClaudeMutator({ anthropicClient: null });
    const out = await mut.mutate({
      currentPrompt: '   ',
      failureCase: CASE,
      capability: 'c',
      mutationCount: 3,
    });
    expect(out).toEqual([]);
  });

  it('returns identity (current prompt) on API throw', async () => {
    const mut = createClaudeMutator({ anthropicClient: throwingClient() });
    const out = await mut.mutate({
      currentPrompt: 'Base.',
      failureCase: CASE,
      capability: 'c',
      mutationCount: 3,
    });
    expect(out).toEqual(['Base.']);
  });

  it('uses claude-opus by default and honours model override', async () => {
    expect(DEFAULT_MUTATOR_MODEL).toMatch(/opus/);
    const create = vi.fn(async () => ({
      content: [{ type: 'text', text: '<candidate>x</candidate>' }],
    }));
    const client: ClaudeMessagesClient = { messages: { create } };
    const mut = createClaudeMutator({
      anthropicClient: client,
      model: 'claude-sonnet-4',
    });
    await mut.mutate({
      currentPrompt: 'B.',
      failureCase: CASE,
      capability: 'c',
      mutationCount: 1,
    });
    const call = create.mock.calls[0]?.[0] as { model: string };
    expect(call.model).toBe('claude-sonnet-4');
  });
});
