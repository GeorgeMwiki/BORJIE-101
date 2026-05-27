/**
 * useMessageWindow — windowed slice of a long chat history.
 *
 * Background: the chat widget renders every message in the cumulative
 * `chat.messages` array. On long sessions the DOM grows unbounded — past
 * ~200 bubbles INP starts to suffer (each insertion forces React to
 * reconcile the whole list).
 *
 * Strategy: when the message count exceeds `windowThreshold` we mount
 * only the last `windowSize` bubbles + a single "older messages" header
 * the user can click to extend the window. Below the threshold we
 * always render the full array (zero behavioural change for the 99 %
 * common path — quick chats, founder demos, support sessions).
 *
 * Intelligence-loss audit: ZERO. No message data is dropped — the older
 * tail still lives in `chat.messages` and the user can extend the
 * window at any time. The window is a *render* optimisation only.
 *
 * Library-agnostic: no @tanstack/react-virtual or virtua dependency.
 * Host apps that want true cell virtualisation pass the windowed
 * `visibleMessages` into their own virtualiser; this hook stays a
 * single export that works in every chat surface.
 *
 * Cite: react.dev/reference/react/useState 2026 + tanstack.com/virtual
 * (2026) for the canonical pattern.
 */

import { useCallback, useMemo, useState } from 'react';

export interface MessageWindowOptions<TMessage> {
  /** Render the full list while count is at or below this threshold. */
  readonly windowThreshold?: number;
  /** Tail size to render once the threshold is exceeded. */
  readonly windowSize?: number;
  /** How many additional rows each "load older" click reveals. */
  readonly loadMoreStep?: number;
  /** Map of `id`-key getter for the message type. */
  readonly idOf: (msg: TMessage) => string;
}

export interface MessageWindowResult<TMessage> {
  /** Subset of messages the consumer should render this frame. */
  readonly visibleMessages: ReadonlyArray<TMessage>;
  /** True when the window is hiding some messages on the head. */
  readonly hasOlder: boolean;
  /** Count of messages currently hidden by the window. */
  readonly olderCount: number;
  /** Extend the window by `loadMoreStep`, capped at the full list. */
  readonly loadOlder: () => void;
  /** Reset the window back to its tail-only state. */
  readonly resetWindow: () => void;
}

const DEFAULT_THRESHOLD = 50;
const DEFAULT_SIZE = 50;
const DEFAULT_STEP = 50;

/**
 * Slice a long message list down to its most recent tail. Returns the
 * full list when the count is below the configured threshold.
 *
 * The window state is held inside the hook — callers do not need to
 * thread an extra prop through their chat container.
 */
export function useMessageWindow<TMessage>(
  messages: ReadonlyArray<TMessage>,
  options: MessageWindowOptions<TMessage>,
): MessageWindowResult<TMessage> {
  const threshold = options.windowThreshold ?? DEFAULT_THRESHOLD;
  const size = options.windowSize ?? DEFAULT_SIZE;
  const step = options.loadMoreStep ?? DEFAULT_STEP;

  const [windowSize, setWindowSize] = useState(size);

  const { visibleMessages, hasOlder, olderCount } = useMemo(() => {
    if (messages.length <= threshold) {
      return {
        visibleMessages: messages,
        hasOlder: false,
        olderCount: 0,
      };
    }
    const start = Math.max(0, messages.length - windowSize);
    return {
      visibleMessages: messages.slice(start),
      hasOlder: start > 0,
      olderCount: start,
    };
  }, [messages, threshold, windowSize]);

  const loadOlder = useCallback(() => {
    setWindowSize((current) => current + step);
  }, [step]);

  const resetWindow = useCallback(() => {
    setWindowSize(size);
  }, [size]);

  return {
    visibleMessages,
    hasOlder,
    olderCount,
    loadOlder,
    resetWindow,
  };
}
