'use client';

/**
 * Context breadcrumbs (K-D) — owner-web hook + provider.
 *
 * When the owner navigates from cockpit → manager's worktree view →
 * worker detail, the chat session preserves contextual breadcrumbs
 * ("you're looking at Mwadui Foreman → Worker Hassan → Last shift
 * report") and the brain narrows entity-search relevance to that
 * crumb stack.
 *
 * Each crumb is a small typed object — kind + id + label + optional
 * scopeId. The provider keeps a stable identity (LIFO stack) and
 * exposes `push` / `pop` / `replace` / `clear` along with the current
 * stack. The chat composer reads `useContextStack()` and inlines the
 * crumbs into the brain turn body as `contextStack` so the SSE
 * endpoint can emit a `<context_set>` tag the workforce / buyer
 * mobile equivalents listen for.
 *
 * Defensive policy:
 *  - Stack capped at 8 levels (any deeper navigation pops the oldest).
 *  - Crumbs are immutable; mutations construct a new stack.
 *  - Listener subscribers are notified synchronously after every
 *    mutation. The hook batches identical sequences via React's own
 *    bail-out on `===`.
 *
 * No I/O — pure FE state. The brain-side reader lives in
 * `services/api-gateway/src/routes/brain-teach.hono.ts` (planned
 * extension) which validates the same shape via zod.
 */

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import type { ReactNode, ReactElement } from 'react';

export interface ContextCrumb {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
  readonly scopeId?: string;
}

const MAX_STACK = 8;

interface ContextStackValue {
  readonly stack: ReadonlyArray<ContextCrumb>;
  push(crumb: ContextCrumb): void;
  pop(): void;
  replace(stack: ReadonlyArray<ContextCrumb>): void;
  clear(): void;
}

const noop = (): void => {
  /* default no-op until a provider is mounted */
};

const DEFAULT_VALUE: ContextStackValue = Object.freeze({
  stack: Object.freeze([]),
  push: noop,
  pop: noop,
  replace: noop,
  clear: noop,
});

const ContextStackContext = createContext<ContextStackValue>(DEFAULT_VALUE);

export function ContextBreadcrumbProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const [stack, setStack] = useState<ReadonlyArray<ContextCrumb>>(() =>
    Object.freeze([]),
  );

  const push = useCallback((crumb: ContextCrumb) => {
    setStack((prev) => {
      const next = prev.length >= MAX_STACK ? prev.slice(1) : prev.slice();
      next.push(Object.freeze({ ...crumb }));
      return Object.freeze(next);
    });
  }, []);

  const pop = useCallback(() => {
    setStack((prev) => (prev.length === 0 ? prev : Object.freeze(prev.slice(0, -1))));
  }, []);

  const replace = useCallback((nextStack: ReadonlyArray<ContextCrumb>) => {
    const capped = nextStack.slice(-MAX_STACK).map((c) => Object.freeze({ ...c }));
    setStack(Object.freeze(capped));
  }, []);

  const clear = useCallback(() => {
    setStack(Object.freeze([]));
  }, []);

  const value = useMemo<ContextStackValue>(
    () => Object.freeze({ stack, push, pop, replace, clear }),
    [stack, push, pop, replace, clear],
  );

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (createContextProvider as any)(value, children)
  );
}

// Helper to render the Context.Provider tree without inlining JSX in
// this `.ts` file (kept JSX-free so the file lives outside the
// component graph and avoids the React/JSX compile path).
function createContextProvider(value: ContextStackValue, children: ReactNode): ReactElement {
  return {
    type: ContextStackContext.Provider,
    props: { value, children },
    key: null,
  } as unknown as ReactElement;
}

export function useContextStack(): ContextStackValue {
  return useContext(ContextStackContext);
}

/**
 * Hook variant — push a crumb when this component mounts, pop on
 * unmount. Used by route-level layouts to keep the stack in sync
 * with the URL.
 */
export function useTrackContextCrumb(crumb: ContextCrumb): void {
  const stack = useContextStack();
  useEffect(() => {
    stack.push(crumb);
    return () => {
      stack.pop();
    };
    // The crumb's kind + id + scopeId uniquely identify it. Re-mount
    // when any of those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crumb.kind, crumb.id, crumb.scopeId, stack.push, stack.pop]);
}

/**
 * Render a serialised crumb stack header — bilingual sw/en.
 * Returns null when the stack is empty.
 */
export function serializeCrumbStack(
  stack: ReadonlyArray<ContextCrumb>,
): string | null {
  if (stack.length === 0) return null;
  return stack.map((c) => c.label).join(' → ');
}

/**
 * Convert the stack into the wire payload the chat composer sends
 * to the brain turn endpoint. The brain extracts this from the body
 * and uses it as the persona-aware entity-index `actorScopeIds` +
 * relevance bias.
 */
export interface ContextStackPayload {
  readonly stack: ReadonlyArray<{
    readonly kind: string;
    readonly id: string;
    readonly label: string;
    readonly scopeId?: string;
  }>;
}

export function toWirePayload(
  stack: ReadonlyArray<ContextCrumb>,
): ContextStackPayload {
  return Object.freeze({
    stack: Object.freeze(
      stack.map((c) =>
        Object.freeze({
          kind: c.kind,
          id: c.id,
          label: c.label,
          ...(c.scopeId !== undefined && { scopeId: c.scopeId }),
        }),
      ),
    ),
  });
}
