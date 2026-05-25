/**
 * `useSwipeNav()` — pointer capture + cancel handling tests.
 *
 * Regression coverage for the touch-gesture edge cases surfaced in
 * the 2026-05-20 deep audit:
 *   - pointerdown must call `setPointerCapture(pointerId)` so
 *     pointerup fires even if the finger leaves the target.
 *   - pointercancel must reset gesture state and NOT fire a swipe.
 *   - pointerup that arrives while the pointer is captured but
 *     outside the target geometry still resolves the gesture.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSwipeNav } from '../hooks/use-swipe-nav.js';

interface CapturableElement extends HTMLElement {
  setPointerCapture: ReturnType<typeof vi.fn>;
  releasePointerCapture: ReturnType<typeof vi.fn>;
  hasPointerCapture: ReturnType<typeof vi.fn>;
}

function makeTarget(): CapturableElement {
  const el = document.createElement('div') as CapturableElement;
  const captured = new Set<number>();
  el.setPointerCapture = vi.fn((id: number) => {
    captured.add(id);
  });
  el.releasePointerCapture = vi.fn((id: number) => {
    captured.delete(id);
  });
  el.hasPointerCapture = vi.fn((id: number) => captured.has(id));
  document.body.appendChild(el);
  return el;
}

function pointer(
  type: 'pointerdown' | 'pointerup' | 'pointercancel',
  init: { clientX: number; clientY: number; pointerId?: number },
): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    pointerType: 'touch',
    pointerId: init.pointerId ?? 1,
    clientX: init.clientX,
    clientY: init.clientY,
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('useSwipeNav — pointer capture', () => {
  it('calls setPointerCapture on pointerdown with the event pointerId', () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() =>
      useSwipeNav({ enabled: true, onSwipeLeft, onSwipeRight }),
    );
    const target = makeTarget();
    act(() => {
      result.current.attach(target);
    });
    act(() => {
      target.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100, pointerId: 42 }));
    });
    expect(target.setPointerCapture).toHaveBeenCalledWith(42);
  });

  it('releases capture on pointerup', () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() =>
      useSwipeNav({ enabled: true, onSwipeLeft, onSwipeRight }),
    );
    const target = makeTarget();
    act(() => {
      result.current.attach(target);
    });
    act(() => {
      target.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100, pointerId: 7 }));
      target.dispatchEvent(pointer('pointerup', { clientX: 200, clientY: 102, pointerId: 7 }));
    });
    expect(target.releasePointerCapture).toHaveBeenCalledWith(7);
  });

  it('pointerup fires a swipe even when delivered outside the target geometry', () => {
    // Captured pointers deliver pointerup to the original target
    // regardless of where the finger is — this is the entire point
    // of setPointerCapture. The handler must process it normally.
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() =>
      useSwipeNav({ enabled: true, onSwipeLeft, onSwipeRight }),
    );
    const target = makeTarget();
    act(() => {
      result.current.attach(target);
    });
    act(() => {
      target.dispatchEvent(pointer('pointerdown', { clientX: 300, clientY: 100, pointerId: 3 }));
      // pointerup arrives with coordinates way outside the target
      // (e.g. the finger drifted off-screen). With pointer capture,
      // the event still reaches `target` and the gesture resolves.
      target.dispatchEvent(pointer('pointerup', { clientX: 50, clientY: 110, pointerId: 3 }));
    });
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
    expect(onSwipeRight).not.toHaveBeenCalled();
  });

  it('pointercancel resets gesture state and does NOT fire a swipe', () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() =>
      useSwipeNav({ enabled: true, onSwipeLeft, onSwipeRight }),
    );
    const target = makeTarget();
    act(() => {
      result.current.attach(target);
    });
    act(() => {
      target.dispatchEvent(pointer('pointerdown', { clientX: 300, clientY: 100, pointerId: 5 }));
      target.dispatchEvent(pointer('pointercancel', { clientX: 50, clientY: 100, pointerId: 5 }));
    });
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
    // Releasing capture is the polite thing to do on cancel.
    expect(target.releasePointerCapture).toHaveBeenCalledWith(5);
  });

  it('after a pointercancel a subsequent fresh gesture works normally', () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() =>
      useSwipeNav({ enabled: true, onSwipeLeft, onSwipeRight }),
    );
    const target = makeTarget();
    act(() => {
      result.current.attach(target);
    });
    act(() => {
      target.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
      target.dispatchEvent(pointer('pointercancel', { clientX: 200, clientY: 100, pointerId: 1 }));
    });
    act(() => {
      target.dispatchEvent(pointer('pointerdown', { clientX: 200, clientY: 100, pointerId: 2 }));
      target.dispatchEvent(pointer('pointerup', { clientX: 100, clientY: 100, pointerId: 2 }));
    });
    expect(onSwipeLeft).toHaveBeenCalledTimes(1);
  });

  it('survives environments where setPointerCapture throws (already-captured)', () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() =>
      useSwipeNav({ enabled: true, onSwipeLeft, onSwipeRight }),
    );
    const target = makeTarget();
    target.setPointerCapture = vi.fn(() => {
      throw new Error('InvalidStateError');
    });
    act(() => {
      result.current.attach(target);
    });
    expect(() => {
      act(() => {
        target.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
        target.dispatchEvent(pointer('pointerup', { clientX: 200, clientY: 100 }));
      });
    }).not.toThrow();
    // The gesture still resolves — capture is a nice-to-have, not load-bearing.
    expect(onSwipeRight).toHaveBeenCalledTimes(1);
  });

  it('when disabled, no listeners are bound', () => {
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() =>
      useSwipeNav({ enabled: false, onSwipeLeft, onSwipeRight }),
    );
    const target = makeTarget();
    act(() => {
      result.current.attach(target);
    });
    act(() => {
      target.dispatchEvent(pointer('pointerdown', { clientX: 300, clientY: 100 }));
      target.dispatchEvent(pointer('pointerup', { clientX: 100, clientY: 100 }));
    });
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
    expect(target.setPointerCapture).not.toHaveBeenCalled();
  });

  it('does not release capture on a detached target if it unmounts mid-gesture', () => {
    // Regression for the 2026-05-21 HIGH bug: `finishGesture` was
    // a stale closure that still held a reference to the original
    // `target` DOM node after the user unmounted the panel
    // mid-swipe. Calling `releasePointerCapture` on a detached
    // node throws `InvalidStateError` in some browsers. We now
    // guard with `target.isConnected`.
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() =>
      useSwipeNav({ enabled: true, onSwipeLeft, onSwipeRight }),
    );
    const target = makeTarget();
    act(() => {
      result.current.attach(target);
    });
    // Start a gesture.
    act(() => {
      target.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100, pointerId: 9 }));
    });
    expect(target.setPointerCapture).toHaveBeenCalledWith(9);
    // Simulate panel unmount mid-gesture — the DOM node is detached
    // BEFORE the matching pointerup arrives.
    target.remove();
    expect(target.isConnected).toBe(false);
    // The pointerup is delivered to the detached node (e.g. via
    // the captured-pointer dispatch path in some implementations).
    // The hook MUST short-circuit and never call releasePointerCapture.
    expect(() => {
      act(() => {
        target.dispatchEvent(
          pointer('pointerup', { clientX: 200, clientY: 100, pointerId: 9 }),
        );
      });
    }).not.toThrow();
    // No swipe should fire because the panel is gone — there is
    // nothing to navigate.
    expect(onSwipeLeft).not.toHaveBeenCalled();
    expect(onSwipeRight).not.toHaveBeenCalled();
    // The guard prevents the release-capture call on a detached node.
    expect(target.releasePointerCapture).not.toHaveBeenCalled();
  });

  it('pointercancel on a detached target does not release capture', () => {
    // Same guard, on the pointercancel path.
    const onSwipeLeft = vi.fn();
    const onSwipeRight = vi.fn();
    const { result } = renderHook(() =>
      useSwipeNav({ enabled: true, onSwipeLeft, onSwipeRight }),
    );
    const target = makeTarget();
    act(() => {
      result.current.attach(target);
    });
    act(() => {
      target.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100, pointerId: 4 }));
    });
    target.remove();
    expect(() => {
      act(() => {
        target.dispatchEvent(
          pointer('pointercancel', { clientX: 100, clientY: 100, pointerId: 4 }),
        );
      });
    }).not.toThrow();
    expect(target.releasePointerCapture).not.toHaveBeenCalled();
  });
});
