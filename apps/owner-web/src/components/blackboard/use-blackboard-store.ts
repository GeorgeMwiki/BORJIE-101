'use client';

/**
 * use-blackboard-store — immutable state for the Borjie blackboard.
 *
 * Pure useReducer + module-level pub/sub so the store survives unmounts
 * across the chat ↔ board boundary (parity with LitFin's
 * `smartboardReducer`, but local rather than provider-based).
 *
 * Every action returns a NEW state object; no field is ever mutated.
 * `appendElement` dedupes by element id (re-emits update in place) so
 * the brain can safely re-emit an element across reconnects.
 */

import { useEffect, useState } from 'react';
import type { BoardElement, BoardElementEnvelope } from './types';

interface BoardState {
  readonly elements: ReadonlyArray<BoardElementEnvelope>;
  readonly activeId: string | null;
  /** Wallclock when the last element landed — used to drive replay. */
  readonly lastAddedAt: number;
  /** True while a replay walk is animating earlier elements back in. */
  readonly replaying: boolean;
}

const INITIAL: BoardState = {
  elements: [],
  activeId: null,
  lastAddedAt: 0,
  replaying: false,
};

type Action =
  | { readonly kind: 'append'; readonly element: BoardElement; readonly messageId: string | null }
  | { readonly kind: 'focus'; readonly id: string }
  | { readonly kind: 'remove'; readonly id: string }
  | { readonly kind: 'clear' }
  | { readonly kind: 'replay-start' }
  | { readonly kind: 'replay-end' };

function reduce(state: BoardState, action: Action): BoardState {
  switch (action.kind) {
    case 'append': {
      const now = Date.now();
      const dedupe = state.elements.findIndex((e) => e.id === action.element.id);
      const envelope: BoardElementEnvelope = {
        id: action.element.id,
        addedAt: now,
        element: action.element,
        messageId: action.messageId,
      };
      if (dedupe >= 0) {
        const next = state.elements.map((e, i) => (i === dedupe ? envelope : e));
        return {
          ...state,
          elements: next,
          activeId: envelope.id,
          lastAddedAt: now,
        };
      }
      return {
        ...state,
        elements: [...state.elements, envelope],
        activeId: envelope.id,
        lastAddedAt: now,
      };
    }
    case 'focus': {
      if (!state.elements.some((e) => e.id === action.id)) return state;
      return { ...state, activeId: action.id };
    }
    case 'remove': {
      const next = state.elements.filter((e) => e.id !== action.id);
      const wasActive = state.activeId === action.id;
      return {
        ...state,
        elements: next,
        activeId: wasActive ? (next[next.length - 1]?.id ?? null) : state.activeId,
      };
    }
    case 'clear':
      return INITIAL;
    case 'replay-start':
      return { ...state, replaying: true };
    case 'replay-end':
      return { ...state, replaying: false };
    default:
      return state;
  }
}

// ─── Module-level pub/sub so sibling chat + board share one store ──

let current: BoardState = INITIAL;
const subscribers = new Set<(s: BoardState) => void>();

function dispatch(action: Action): void {
  const next = reduce(current, action);
  if (next === current) return;
  current = next;
  for (const sub of subscribers) sub(current);
}

export function appendBoardElement(
  element: BoardElement,
  messageId: string | null = null,
): void {
  dispatch({ kind: 'append', element, messageId });
}

export function focusBoardElement(id: string): void {
  dispatch({ kind: 'focus', id });
}

export function removeBoardElement(id: string): void {
  dispatch({ kind: 'remove', id });
}

export function clearBoard(): void {
  dispatch({ kind: 'clear' });
}

export function startReplay(): void {
  dispatch({ kind: 'replay-start' });
}

export function endReplay(): void {
  dispatch({ kind: 'replay-end' });
}

export function getBoardState(): BoardState {
  return current;
}

// ─── React hook ────────────────────────────────────────────────────

export function useBlackboardStore(): BoardState {
  const [state, setState] = useState<BoardState>(current);
  useEffect(() => {
    subscribers.add(setState);
    setState(current);
    return () => {
      subscribers.delete(setState);
    };
  }, []);
  return state;
}
