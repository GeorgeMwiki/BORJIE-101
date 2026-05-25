/**
 * Vitest setup — jsdom + testing-library matchers + matchMedia
 * polyfill (jsdom doesn't ship one by default) + PointerEvent
 * polyfill (jsdom only ships MouseEvent).
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

/**
 * jsdom doesn't implement PointerEvent. We synthesise it as a
 * subclass of MouseEvent so `.clientX` + `.clientY` already work,
 * and add `pointerType` + `button` defaults so handlers that read
 * those don't trip.
 */
if (typeof window !== 'undefined' && typeof (window as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    public readonly pointerType: string;
    public readonly pointerId: number;
    constructor(type: string, params: MouseEventInit & { pointerType?: string; pointerId?: number } = {}) {
      super(type, params);
      this.pointerType = params.pointerType ?? 'mouse';
      this.pointerId = params.pointerId ?? 1;
    }
  }
  (globalThis as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent =
    PointerEventPolyfill;
  (window as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent =
    PointerEventPolyfill;
}

/**
 * Install a minimal matchMedia polyfill on the window so the
 * `useViewportBreakpoint` hook works under jsdom. The
 * `__setMatchMedia` helper lets tests force a specific breakpoint.
 */
declare global {
  // eslint-disable-next-line no-var
  var __setMatchMedia: ((matches: boolean) => void) | undefined;
}

let _matches = false;
const listeners = new Set<(e: MediaQueryListEvent) => void>();

function makeQueryList(matches: boolean): MediaQueryList {
  return {
    matches,
    media: '(max-width: 767px)',
    onchange: null,
    addEventListener: (_type: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
    removeEventListener: (_type: string, l: (e: MediaQueryListEvent) => void) => {
      listeners.delete(l);
    },
    addListener: (l: (e: MediaQueryListEvent) => void) => listeners.add(l),
    removeListener: (l: (e: MediaQueryListEvent) => void) => {
      listeners.delete(l);
    },
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
}

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation(() => makeQueryList(_matches)),
  });
}

globalThis.__setMatchMedia = (matches: boolean) => {
  _matches = matches;
  // Re-invoke matchMedia mock so new listeners see the new value.
  if (typeof window !== 'undefined') {
    (window.matchMedia as ReturnType<typeof vi.fn>).mockImplementation(() =>
      makeQueryList(matches),
    );
  }
  // Dispatch change events to existing listeners.
  const evt = { matches } as MediaQueryListEvent;
  listeners.forEach((l) => l(evt));
};
