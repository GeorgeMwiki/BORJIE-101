/**
 * Blackboard ↔ learning-chat bridge — Borjie behaviour test.
 *
 * Mr. Mwikila streams `<board_add>{...}</board_add>` tags in the chat
 * body. The api-gateway strips those tags and re-emits each payload
 * as a typed `board_element` SSE frame. `HomeChatTeach` consumes the
 * frame and calls `appendBoardElement(element, assistantId)`. The
 * mounted `Blackboard` aside subscribes to the module-level store
 * and re-renders with the new element.
 *
 * This test exercises the FE half of the bridge end-to-end:
 *  1. Render the Blackboard with the empty state.
 *  2. Validate a brain-emitted payload via `boardElementSchema` (the
 *     same defence-in-depth check `HomeChatTeach` performs after the
 *     SSE event lands).
 *  3. Push the validated element through `appendBoardElement` — the
 *     real bridge function the chat panel uses.
 *  4. Assert the Blackboard re-renders with the element AND the
 *     empty state disappears, proving the chat→board hook fires.
 *
 * Resists regression: any future change that decouples
 * `appendBoardElement` from `useBlackboardStore` will fail this test
 * before owners ever see a blank board.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { Blackboard } from '../Blackboard';
import {
  appendBoardElement,
  clearBoard,
  getBoardState,
} from '../use-blackboard-store';
import { boardElementSchema } from '../types';

// Reset the module-level store between cases so element accumulation
// from one test never leaks into the next.
afterEach(() => {
  clearBoard();
  cleanup();
});

describe('Blackboard ↔ learning-chat bridge (Borjie)', () => {
  it('renders the empty state until the chat emits a board element', () => {
    render(<Blackboard languagePreference="en" tradingName="Acacia PML" />);
    // Empty-state copy is the surface marker.
    expect(screen.getByText(/Ask about royalty, licences/i)).toBeTruthy();
    expect(getBoardState().elements).toHaveLength(0);
  });

  it('appends a brain-emitted formula and renders it on the board', () => {
    render(<Blackboard languagePreference="en" tradingName="Acacia PML" />);

    // The brain emits this payload inside a `<board_add>` tag; the
    // api-gateway parses + re-emits it as a `board_element` SSE event.
    const royaltyFormula = {
      type: 'formula',
      id: 'f-royalty',
      latex: 'royalty = grade × tonnage × spot_price × rate',
      label: {
        en: 'Royalty formula',
        sw: 'Fomula ya mrabaha',
      },
      variables: [
        {
          symbol: 'rate',
          meaning: { en: '6% for gold', sw: '6% kwa dhahabu' },
        },
      ],
    } as const;

    // Defence-in-depth — exactly the same validation `HomeChatTeach`
    // performs before calling `appendBoardElement`.
    const validated = boardElementSchema.safeParse(royaltyFormula);
    expect(validated.success).toBe(true);

    // The bridge call. In production this fires inside the SSE event
    // handler when `frame.event === 'board_element'`.
    act(() => {
      if (validated.success) {
        appendBoardElement(validated.data, 'msg-1');
      }
    });

    // Board store mirrors the chat event.
    expect(getBoardState().elements).toHaveLength(1);
    expect(getBoardState().elements[0]?.element.type).toBe('formula');

    // Visual: the Blackboard re-rendered with the element slot AND the
    // empty-state copy is gone (the lesson has begun).
    expect(screen.getByTestId('blackboard-slot-formula')).toBeTruthy();
    expect(screen.queryByText(/Ask about royalty, licences/i)).toBeNull();
  });

  it('dedupes when the brain re-emits the same id across reconnects', () => {
    render(<Blackboard languagePreference="en" />);
    const diagram = {
      type: 'diagram',
      id: 'd-ladder',
      kind: 'flow',
      nodes: [
        { id: 'orient', label: { en: 'ORIENT', sw: 'KUJIORIENTI' } },
        { id: 'licence', label: { en: 'LICENCE', sw: 'LESENI' } },
        { id: 'royalty', label: { en: 'ROYALTY', sw: 'MRABAHA' } },
      ],
    } as const;
    const validated = boardElementSchema.safeParse(diagram);
    expect(validated.success).toBe(true);

    act(() => {
      if (validated.success) {
        appendBoardElement(validated.data, 'msg-1');
        // Re-emit (SSE reconnect, idempotent retry). Should dedupe by id.
        appendBoardElement(validated.data, 'msg-2');
      }
    });

    expect(getBoardState().elements).toHaveLength(1);
    expect(getBoardState().elements[0]?.element.type).toBe('diagram');
  });
});
