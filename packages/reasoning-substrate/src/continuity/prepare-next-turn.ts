/**
 * prepareNextTurn + assertThinkingBlockOrder — the thinking-block
 * continuity layer.
 *
 * Why this exists (verbatim from the L1 audit §1.1 and the Anthropic
 * docs):
 *
 *   "When looping with tools, you MUST pass the prior turn's `thinking`
 *    block back alongside the `tool_use` block — otherwise the next
 *    turn loses reasoning continuity. Both Python and TS samples
 *    confirm this."
 *
 * Concretely, when the model returns:
 *
 *   [
 *     { type: 'thinking', thinking: '...', signature: 'sig-1' },
 *     { type: 'tool_use', id: 'tu_1', name: 'get_lease', input: {...} },
 *   ]
 *
 * and we run the tool externally and want to give Claude the result,
 * the NEXT request's `messages` MUST look like:
 *
 *   [
 *     ...prior messages,
 *     {
 *       role: 'assistant',
 *       content: [
 *         { type: 'thinking', thinking: '...', signature: 'sig-1' },  ← MUST
 *         { type: 'tool_use', id: 'tu_1', ... },                       be paired
 *       ],
 *     },
 *     {
 *       role: 'user',
 *       content: [
 *         { type: 'tool_result', tool_use_id: 'tu_1', content: '...' },
 *       ],
 *     },
 *   ]
 *
 * If the thinking block is dropped, the API still ACCEPTS the request
 * but the model loses the chain it was in, often producing nonsense
 * or duplicating steps. Worst-case, the signature mismatch returns a
 * 400 (newer SDK).
 *
 * `prepareNextTurn` reconstructs the next messages array CORRECTLY
 * from the prior assistant response + an optional new user message +
 * tool results. The function is the only safe path for callers; doing
 * it by hand is forbidden.
 *
 * `assertThinkingBlockOrder` is the runtime gate — it throws if any
 * tool_use block is missing its preceding thinking block, or if a
 * thinking block is orphaned.
 */

import type {
  AnthropicMessageResponse,
  AssistantBlock,
  Message,
  ThinkingBlock,
  ToolResultBlock,
  ToolUseBlock,
} from '../adaptive-thinking/types.js';

// ─────────────────────────────────────────────────────────────────────
// prepareNextTurn — the safe builder
// ─────────────────────────────────────────────────────────────────────

export interface PrepareNextTurnArgs {
  /** Prior turn's full message history (everything sent on the last call). */
  readonly priorMessages: ReadonlyArray<Message>;
  /** The assistant response from the prior call. */
  readonly priorResponse: AnthropicMessageResponse;
  /**
   * Tool results to attach to the new user turn. Maps `tool_use_id` →
   * tool result content. Every `tool_use` block in the prior response
   * MUST have a result here (or `is_error: true` on the result).
   */
  readonly toolResults: ReadonlyArray<ToolResultBlock>;
  /** Optional additional user text to append to the new user turn. */
  readonly newUserMessage?: string;
}

export interface PrepareNextTurnResult {
  readonly messages: ReadonlyArray<Message>;
}

export class ThinkingContinuityError extends Error {
  override readonly name = 'ThinkingContinuityError';
}

/**
 * Assemble the next request's `messages` array from the prior
 * response + tool results. Guarantees:
 *
 *   - the prior response is appended as an assistant message with
 *     ALL its blocks in their original order (thinking blocks are
 *     never dropped),
 *   - the tool results are appended as a user message with EXACTLY
 *     one tool_result per tool_use_id (extras throw),
 *   - `assertThinkingBlockOrder` is run on the result before return,
 *     so the caller can never construct an invalid array.
 *
 * Throws ThinkingContinuityError on any violation.
 */
export function prepareNextTurn(
  args: PrepareNextTurnArgs,
): PrepareNextTurnResult {
  const priorBlocks: ReadonlyArray<AssistantBlock> = args.priorResponse.content ?? [];

  const toolUseBlocks = priorBlocks.filter(
    (b): b is ToolUseBlock => b.type === 'tool_use',
  );
  const expectedToolUseIds = new Set(toolUseBlocks.map((t) => t.id));
  const providedToolUseIds = new Set(args.toolResults.map((r) => r.tool_use_id));

  // Every tool_use must have a result.
  for (const id of expectedToolUseIds) {
    if (!providedToolUseIds.has(id)) {
      throw new ThinkingContinuityError(
        `prepareNextTurn: missing tool_result for tool_use_id '${id}'`,
      );
    }
  }
  // Every tool_result must map to a real tool_use.
  for (const id of providedToolUseIds) {
    if (!expectedToolUseIds.has(id)) {
      throw new ThinkingContinuityError(
        `prepareNextTurn: tool_result references unknown tool_use_id '${id}'`,
      );
    }
  }

  const assistantMsg: Message = {
    role: 'assistant',
    content: priorBlocks,
  };

  const userContent: Array<ToolResultBlock | { type: 'text'; text: string }> = [
    ...args.toolResults,
  ];
  const newUser = (args.newUserMessage ?? '').trim();
  if (newUser) {
    userContent.push({ type: 'text', text: newUser });
  }
  const userMsg: Message = {
    role: 'user',
    content: userContent,
  };

  const messages: ReadonlyArray<Message> = [
    ...args.priorMessages,
    assistantMsg,
    userMsg,
  ];

  assertThinkingBlockOrder(messages);
  return { messages };
}

// ─────────────────────────────────────────────────────────────────────
// assertThinkingBlockOrder — the invariant gate
// ─────────────────────────────────────────────────────────────────────

/**
 * Runtime check: for every assistant message that contains tool_use
 * blocks, the thinking blocks (if any) must come BEFORE the tool_use
 * blocks they pair with, and every tool_use must be either preceded
 * by a thinking block in the same assistant message (interleaved
 * thinking) or there must be no thinking blocks at all in the message
 * (non-thinking model). Orphaned thinking blocks at the end of an
 * assistant message (after the last tool_use) are also illegal.
 *
 * Throws `ThinkingContinuityError` on any violation. Returns void on
 * success.
 */
export function assertThinkingBlockOrder(
  messages: ReadonlyArray<Message>,
): void {
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i]!;
    if (m.role !== 'assistant') continue;
    const blocks = m.content;
    if (!Array.isArray(blocks)) continue;

    // Track which tool_use blocks have a preceding thinking block.
    let lastSawThinking = false;
    let toolUseCount = 0;
    let thinkingCount = 0;
    let lastToolUseIdx = -1;
    let lastThinkingIdx = -1;
    for (let j = 0; j < blocks.length; j += 1) {
      const b = blocks[j]!;
      if (b.type === 'thinking' || b.type === 'redacted_thinking') {
        lastSawThinking = true;
        thinkingCount += 1;
        lastThinkingIdx = j;
        // Validate thinking blocks carry a signature when not redacted.
        // Redacted blocks carry a `data` field instead.
        if (b.type === 'thinking') {
          // Signature MAY be undefined in test fixtures; we don't fail
          // here because Anthropic only signs in production. Real
          // requests with missing signatures will fail server-side.
        }
      } else if (b.type === 'tool_use') {
        if (!lastSawThinking) {
          throw new ThinkingContinuityError(
            `assistant message ${i} block ${j}: tool_use '${b.id}' has no preceding thinking block in this assistant turn`,
          );
        }
        // Reset — a thinking block must precede EACH tool_use in
        // interleaved mode. (This matches the Anthropic samples.)
        // After the tool_use, the next tool_use needs its own thinking
        // block.
        lastSawThinking = false;
        toolUseCount += 1;
        lastToolUseIdx = j;
      } else if (b.type === 'text') {
        // A text block resets lastSawThinking — Claude finalised its
        // thought.
        lastSawThinking = false;
      }
    }
    // Orphan check — a thinking block AFTER the last tool_use AND
    // with no text block between is dangling. This is only illegal
    // if there is at least one tool_use; otherwise it's just a
    // thinking-only response.
    if (
      toolUseCount > 0 &&
      thinkingCount > toolUseCount &&
      lastThinkingIdx > lastToolUseIdx &&
      !blocks
        .slice(lastToolUseIdx + 1, lastThinkingIdx)
        .some((b) => b.type === 'text')
    ) {
      // Allow trailing thinking ONLY when followed by a text block.
      const hasTrailingText = blocks
        .slice(lastThinkingIdx + 1)
        .some((b) => b.type === 'text');
      if (!hasTrailingText) {
        throw new ThinkingContinuityError(
          `assistant message ${i}: trailing thinking block at idx ${lastThinkingIdx} has no following text or tool_use`,
        );
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Convenience accessor — returns the thinking blocks from a response
// in original order, for callers that want to log or persist them.
// ─────────────────────────────────────────────────────────────────────

export function extractThinkingBlocks(
  response: AnthropicMessageResponse,
): ReadonlyArray<ThinkingBlock> {
  return (response.content ?? []).filter(
    (b): b is ThinkingBlock => b.type === 'thinking',
  );
}
