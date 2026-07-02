/**
 * SuperpowerListeners highlight-overlay positioning regression.
 *
 * The overlay container is `fixed inset-0` (viewport-anchored), so its
 * absolutely-positioned children must be laid out in VIEWPORT coordinates.
 * The receiver previously added `window.scrollX/scrollY` to `rect.left/top`,
 * double-counting the scroll offset once the page was scrolled and pushing the
 * callout off the target. This test scrolls the window, fires the highlight
 * event, and asserts the overlay is positioned at the raw viewport rect — with
 * NO scroll offset baked in.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { SuperpowerListeners } from '../SuperpowerListeners';
import { HIGHLIGHT_EVENT_NAME } from '../home-chat/superpower-events';

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'scrollX', { value: 0, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
});

function addTarget(rect: {
  top: number;
  left: number;
  width: number;
  height: number;
}): void {
  const target = document.createElement('div');
  target.id = 'tip-anchor';
  target.getBoundingClientRect = () =>
    ({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  target.scrollIntoView = () => undefined;
  document.body.appendChild(target);
}

describe('SuperpowerListeners highlight positioning', () => {
  it('positions the callout in viewport coords, ignoring scroll offset', () => {
    // Simulate a scrolled page — the historic bug added these to rect.top/left.
    Object.defineProperty(window, 'scrollX', { value: 500, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 800, configurable: true });

    addTarget({ top: 120, left: 60, width: 200, height: 40 });

    const { container } = render(<SuperpowerListeners languagePreference="en" />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(HIGHLIGHT_EVENT_NAME, {
          detail: {
            selector: '#tip-anchor',
            message: { en: 'Here is the tip', sw: 'Hii ndiyo dokezo' },
            ttl: 3000,
            tone: 'info',
          },
        }),
      );
    });

    const overlay = document.querySelector<HTMLElement>(
      '[data-testid="superpower-highlight-overlay"]',
    );
    const box = document.querySelector<HTMLElement>(
      '[data-testid="superpower-highlight-callout"]',
    );
    const outline = overlay?.querySelector<HTMLElement>(
      '.absolute.rounded-md.border-2',
    );
    expect(box).not.toBeNull();
    expect(outline).not.toBeNull();

    // Outline: top = rect.top(120) - 4 = 116, left = rect.left(60) - 4 = 56.
    // Callout: top = rect.top(120) + height(40) + 8 = 168, left = rect.left(60).
    // NONE of these include +scrollY(800) / +scrollX(500).
    expect(outline!.style.top).toBe('116px');
    expect(outline!.style.left).toBe('56px');
    expect(box!.style.top).toBe('168px');
    expect(box!.style.left).toBe('60px');

    // container is referenced so the render root is retained for cleanup.
    expect(container).toBeTruthy();
  });
});
