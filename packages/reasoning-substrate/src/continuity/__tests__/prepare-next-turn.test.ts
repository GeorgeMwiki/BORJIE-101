/**
 * Continuity tests — 6 multi-turn sequences with interleaved tools.
 *
 * Each scenario walks a realistic BORJIE MD flow:
 *   1. user → assistant (thinking + tool_use) → tool_result → assistant text
 *   2. user → assistant (multiple thinking + tool_use pairs) → multi-result → text
 *   3. user → assistant (thinking + tool_use) → tool_result → user follow-up
 *   4. eviction flow — full §7 audit walkthrough (3 tool calls)
 *   5. negative — missing thinking block before tool_use throws
 *   6. negative — missing tool_result for a tool_use throws
 */

import { describe, expect, it } from 'vitest';
import type {
  AnthropicMessageResponse,
  AssistantBlock,
  Message,
  ThinkingBlock,
  ToolResultBlock,
  ToolUseBlock,
} from '../../adaptive-thinking/types.js';
import {
  ThinkingContinuityError,
  assertThinkingBlockOrder,
  extractThinkingBlocks,
  prepareNextTurn,
} from '../prepare-next-turn.js';

function thinking(text: string, signature = 'sig-1'): ThinkingBlock {
  return { type: 'thinking', thinking: text, signature };
}

function toolUse(id: string, name: string, input: unknown): ToolUseBlock {
  return { type: 'tool_use', id, name, input };
}

function toolResult(id: string, content: string, isError = false): ToolResultBlock {
  const base: ToolResultBlock = { type: 'tool_result', tool_use_id: id, content };
  return isError ? { ...base, is_error: true } : base;
}

function makeResp(content: ReadonlyArray<AssistantBlock>, stop: string = 'tool_use'): AnthropicMessageResponse {
  return { role: 'assistant', content, stop_reason: stop };
}

describe('prepareNextTurn — sequence 1: single tool round-trip', () => {
  it('lookup_lease → result → continue', () => {
    const priorMessages: Message[] = [
      { role: 'user', content: 'Decide whether to send eviction notice for t_8821.' },
    ];
    const priorResponse = makeResp([
      thinking('I need the lease to check mediation_opt_in.', 'sig-a'),
      toolUse('tu_1', 'get_lease', { tenantId: 't_8821' }),
    ]);
    const next = prepareNextTurn({
      priorMessages,
      priorResponse,
      toolResults: [toolResult('tu_1', JSON.stringify({ mediationOptIn: true }))],
    });
    expect(next.messages).toHaveLength(3);
    expect(next.messages[1]?.role).toBe('assistant');
    // The thinking block IS retained.
    const assistantContent = next.messages[1]?.content as ReadonlyArray<AssistantBlock>;
    expect(assistantContent[0]?.type).toBe('thinking');
    expect(assistantContent[1]?.type).toBe('tool_use');
  });
});

describe('prepareNextTurn — sequence 2: multi-tool interleaved', () => {
  it('two tools, each preceded by its own thinking block', () => {
    const priorMessages: Message[] = [{ role: 'user', content: 'Late-fee for t_8821.' }];
    const priorResponse = makeResp([
      thinking('Pull payment history.', 'sig-1'),
      toolUse('tu_1', 'query_rent_history', { tenantId: 't_8821' }),
      thinking('Now jurisdiction lookup.', 'sig-2'),
      toolUse('tu_2', 'get_jurisdiction_rules', { code: 'TZ-DSM' }),
    ]);
    const next = prepareNextTurn({
      priorMessages,
      priorResponse,
      toolResults: [
        toolResult('tu_1', JSON.stringify({ missed: 4 })),
        toolResult('tu_2', JSON.stringify({ cap: 10 })),
      ],
    });
    expect(next.messages).toHaveLength(3);
    // Both tool_use blocks survive, in original order.
    const assistant = next.messages[1]!.content as ReadonlyArray<AssistantBlock>;
    expect(assistant.filter((b) => b.type === 'tool_use').map((b) => (b as ToolUseBlock).id)).toEqual([
      'tu_1',
      'tu_2',
    ]);
    // Both tool_results are in the follow-up user turn.
    const user = next.messages[2]!.content as ReadonlyArray<ToolResultBlock | { type: 'text' }>;
    const resultIds = user
      .filter((b): b is ToolResultBlock => b.type === 'tool_result')
      .map((b) => b.tool_use_id);
    expect(resultIds).toEqual(['tu_1', 'tu_2']);
  });
});

describe('prepareNextTurn — sequence 3: result + new user message', () => {
  it('attaches new user text after tool_result blocks', () => {
    const priorMessages: Message[] = [{ role: 'user', content: 'Compute prorated rent.' }];
    const priorResponse = makeResp([
      thinking('Need monthly rent.', 'sig-1'),
      toolUse('tu_1', 'get_lease', { tenantId: 't_8821' }),
    ]);
    const next = prepareNextTurn({
      priorMessages,
      priorResponse,
      toolResults: [toolResult('tu_1', JSON.stringify({ monthlyRentKES: 24000 }))],
      newUserMessage: 'Also use the move-in day from this email: 12.',
    });
    const userContent = next.messages[2]!.content as ReadonlyArray<unknown>;
    expect(userContent).toHaveLength(2);
    expect((userContent[0] as ToolResultBlock).type).toBe('tool_result');
    expect((userContent[1] as { type: string; text: string }).type).toBe('text');
    expect((userContent[1] as { type: string; text: string }).text).toContain('move-in day');
  });
});

describe('prepareNextTurn — sequence 4: full eviction flow (3 tool calls)', () => {
  it('preserves all 3 thinking+tool pairs across 3 turns', () => {
    // Turn 1 — get_lease
    const t1User: Message = { role: 'user', content: 'Should we evict t_8821?' };
    const t1Resp = makeResp([
      thinking('Need lease.', 'sig-1'),
      toolUse('tu_1', 'get_lease', { tenantId: 't_8821' }),
    ]);
    const afterT1 = prepareNextTurn({
      priorMessages: [t1User],
      priorResponse: t1Resp,
      toolResults: [toolResult('tu_1', '{"mediationOptIn":true}')],
    });
    expect(afterT1.messages).toHaveLength(3);

    // Turn 2 — query_rent_history
    const t2Resp = makeResp([
      thinking('Mediation is in. Need payment history.', 'sig-2'),
      toolUse('tu_2', 'query_rent_history', { tenantId: 't_8821' }),
    ]);
    const afterT2 = prepareNextTurn({
      priorMessages: afterT1.messages,
      priorResponse: t2Resp,
      toolResults: [toolResult('tu_2', '{"missed":4}')],
    });
    expect(afterT2.messages).toHaveLength(5);
    // The original thinking block from turn 1 IS still in the message
    // array. This is the regression we're guarding against.
    const allBlocks = afterT2.messages
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => m.content as ReadonlyArray<AssistantBlock>);
    expect(allBlocks.filter((b) => b.type === 'thinking')).toHaveLength(2);

    // Turn 3 — check_mediation_status
    const t3Resp = makeResp([
      thinking('Need mediation status.', 'sig-3'),
      toolUse('tu_3', 'check_mediation_status', { tenantId: 't_8821' }),
    ]);
    const afterT3 = prepareNextTurn({
      priorMessages: afterT2.messages,
      priorResponse: t3Resp,
      toolResults: [toolResult('tu_3', '{"initiated":false}')],
    });
    const allAssistant = afterT3.messages
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => m.content as ReadonlyArray<AssistantBlock>);
    expect(allAssistant.filter((b) => b.type === 'thinking')).toHaveLength(3);
    expect(allAssistant.filter((b) => b.type === 'tool_use')).toHaveLength(3);
    // assertThinkingBlockOrder validated this internally.
  });
});

describe('prepareNextTurn — sequence 5: tool errors propagate', () => {
  it('is_error=true tool_result is accepted (it still pairs with the tool_use)', () => {
    const priorMessages: Message[] = [{ role: 'user', content: 'check FX.' }];
    const priorResponse = makeResp([
      thinking('FX lookup.', 'sig-1'),
      toolUse('tu_1', 'get_fx_rate', { from: 'KES', to: 'TZS' }),
    ]);
    const next = prepareNextTurn({
      priorMessages,
      priorResponse,
      toolResults: [toolResult('tu_1', 'FX provider timeout', true)],
    });
    const user = next.messages[2]!.content as ReadonlyArray<ToolResultBlock | { type: string }>;
    const result = user.find(
      (b): b is ToolResultBlock => b.type === 'tool_result',
    );
    expect(result?.is_error).toBe(true);
  });
});

describe('prepareNextTurn — sequence 6: negative cases', () => {
  it('throws when tool_use has NO preceding thinking block', () => {
    const priorMessages: Message[] = [{ role: 'user', content: 'x' }];
    const priorResponse = makeResp([
      // Note: no thinking block here. With adaptive thinking, this is
      // illegal — the model would have emitted one in real usage.
      toolUse('tu_1', 'get_lease', { tenantId: 't_8821' }),
    ]);
    expect(() =>
      prepareNextTurn({
        priorMessages,
        priorResponse,
        toolResults: [toolResult('tu_1', 'ok')],
      }),
    ).toThrow(ThinkingContinuityError);
  });

  it('throws when a tool_use has NO tool_result supplied', () => {
    const priorMessages: Message[] = [{ role: 'user', content: 'x' }];
    const priorResponse = makeResp([
      thinking('think', 'sig'),
      toolUse('tu_1', 'a', {}),
      thinking('again', 'sig'),
      toolUse('tu_2', 'b', {}),
    ]);
    expect(() =>
      prepareNextTurn({
        priorMessages,
        priorResponse,
        toolResults: [toolResult('tu_1', 'ok')], // missing tu_2
      }),
    ).toThrow(/missing tool_result for tool_use_id 'tu_2'/);
  });

  it('throws when a tool_result references an UNKNOWN tool_use_id', () => {
    // Supply the real tool_result AND a ghost result — the ghost
    // triggers the "unknown tool_use_id" branch (the real result
    // means the "missing" branch is happy).
    const priorMessages: Message[] = [{ role: 'user', content: 'x' }];
    const priorResponse = makeResp([
      thinking('think', 'sig'),
      toolUse('tu_1', 'a', {}),
    ]);
    expect(() =>
      prepareNextTurn({
        priorMessages,
        priorResponse,
        toolResults: [toolResult('tu_1', 'ok'), toolResult('tu_99', 'ghost')],
      }),
    ).toThrow(/unknown tool_use_id 'tu_99'/);
  });
});

describe('assertThinkingBlockOrder — direct invariant checks', () => {
  it('accepts a single thinking+tool_use pair', () => {
    expect(() =>
      assertThinkingBlockOrder([
        { role: 'user', content: 'x' },
        {
          role: 'assistant',
          content: [thinking('t', 'sig'), toolUse('tu_1', 'a', {})],
        },
      ]),
    ).not.toThrow();
  });

  it('accepts thinking → tool_use → thinking → text pattern', () => {
    expect(() =>
      assertThinkingBlockOrder([
        { role: 'user', content: 'x' },
        {
          role: 'assistant',
          content: [
            thinking('t1', 'sig1'),
            toolUse('tu_1', 'a', {}),
            thinking('t2', 'sig2'),
            { type: 'text', text: 'final answer' },
          ],
        },
      ]),
    ).not.toThrow();
  });

  it('throws on tool_use without preceding thinking', () => {
    expect(() =>
      assertThinkingBlockOrder([
        {
          role: 'assistant',
          content: [toolUse('tu_1', 'a', {})],
        },
      ]),
    ).toThrow(ThinkingContinuityError);
  });

  it('throws on consecutive tool_uses with only one thinking before them', () => {
    expect(() =>
      assertThinkingBlockOrder([
        {
          role: 'assistant',
          content: [
            thinking('only one', 'sig'),
            toolUse('tu_1', 'a', {}),
            toolUse('tu_2', 'b', {}),
          ],
        },
      ]),
    ).toThrow(/tool_use 'tu_2' has no preceding thinking/);
  });

  it('throws on dangling thinking block at end (no text or tool_use after)', () => {
    expect(() =>
      assertThinkingBlockOrder([
        {
          role: 'assistant',
          content: [
            thinking('t1', 'sig'),
            toolUse('tu_1', 'a', {}),
            thinking('orphan trailing', 'sig'),
          ],
        },
      ]),
    ).toThrow(/trailing thinking block/);
  });

  it('accepts a thinking-only response (no tool_use)', () => {
    expect(() =>
      assertThinkingBlockOrder([
        {
          role: 'assistant',
          content: [
            thinking('thought all the way', 'sig'),
            { type: 'text', text: 'final answer' },
          ],
        },
      ]),
    ).not.toThrow();
  });
});

describe('extractThinkingBlocks', () => {
  it('returns thinking blocks in order, excluding tool_use + text', () => {
    const r = makeResp([
      thinking('a', 'sig-a'),
      toolUse('tu_1', 'a', {}),
      thinking('b', 'sig-b'),
      { type: 'text', text: 'final' },
    ]);
    const t = extractThinkingBlocks(r);
    expect(t).toHaveLength(2);
    expect(t[0]?.signature).toBe('sig-a');
    expect(t[1]?.signature).toBe('sig-b');
  });

  it('returns empty array on responses with no thinking', () => {
    const r = makeResp([{ type: 'text', text: 'just text' }], 'end_turn');
    expect(extractThinkingBlocks(r)).toHaveLength(0);
  });
});
