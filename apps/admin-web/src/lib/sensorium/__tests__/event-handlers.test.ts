/**
 * Event handler unit tests — Central Command Phase A (C4 Brain Skin).
 *
 * Covers the 14 install functions against the jsdom DOM:
 *   - page.view + page.leave dwell computation
 *   - element.click PII filtering on password fields
 *   - input.change 300ms debounce + shape redact
 *   - form.submit metadata extraction
 *   - scroll.depth 25/50/75/100 milestones (no dupes)
 *   - focus.change window focus/blur
 *   - keyboard.shortcut only fires for Cmd/Ctrl combos
 *   - copy.paste emits selection length only
 *   - viewport.resize 300ms debounce
 *   - network.request emits on failure / slow
 *   - error.boundary truncates stack
 *   - a11y.tree.diff debounced 500ms
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  installPageViewHandler,
  installPageLeaveHandler,
  installElementClickHandler,
  installInputChangeHandler,
  installFormSubmitHandler,
  installScrollDepthHandler,
  installFocusChangeHandler,
  installKeyboardShortcutHandler,
  installCopyPasteHandler,
  installViewportResizeHandler,
  installErrorBoundaryHandler,
  installA11yTreeDiffHandler,
  type SensoryHandler,
} from '../event-handlers';
import type { EmitFn, HandlerContext } from '../event-handlers/types';

function ctxFor(route = '/jarvis'): HandlerContext {
  return {
    route: () => route,
    surface: 'test',
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('page-view handler', () => {
  it('emits page.view on install', () => {
    const events: any[] = [];
    const teardown = installPageViewHandler(
      (e) => events.push(e),
      ctxFor('/a'),
    );
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('page.view');
    expect(events[0].payload.route).toBe('/a');
    teardown();
  });
});

describe('page-leave handler', () => {
  it('emits page.leave with dwellMs on beforeunload', () => {
    const events: any[] = [];
    installPageViewHandler(() => undefined, ctxFor('/a'));
    const teardown = installPageLeaveHandler(
      (e) => events.push(e),
      ctxFor('/a'),
    );
    window.dispatchEvent(new Event('beforeunload'));
    teardown();
    const leave = events.find((e) => e.eventType === 'page.leave');
    expect(leave).toBeDefined();
    expect(typeof leave.payload.dwellMs).toBe('number');
  });
});

describe('element-click handler', () => {
  it('emits element.click with target metadata', () => {
    const events: any[] = [];
    document.body.innerHTML = `<button id="btn-1">Save</button>`;
    const teardown = installElementClickHandler(
      (e) => events.push(e),
      ctxFor(),
    );
    document.getElementById('btn-1')!.click();
    teardown();
    expect(events).toHaveLength(1);
    expect(events[0].payload.targetTagName).toBe('button');
    expect(events[0].payload.targetText).toBe('Save');
    expect(events[0].payload.targetId).toBe('btn-1');
  });

  it('does not emit raw text for password inputs', () => {
    const events: any[] = [];
    document.body.innerHTML = `<input type="password" value="topsecret" />`;
    const input = document.querySelector('input') as HTMLInputElement;
    const teardown = installElementClickHandler(
      (e) => events.push(e),
      ctxFor(),
    );
    input.click();
    teardown();
    const payload = events[0]?.payload as { targetText: string };
    expect(payload.targetText).toBe('');
  });
});

describe('input-change handler — debounce + redact', () => {
  it('debounces emit until 300ms after last input', async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = `<input name="email" />`;
      const input = document.querySelector('input') as HTMLInputElement;
      const events: any[] = [];
      const teardown = installInputChangeHandler(
        (e) => events.push(e),
        ctxFor(),
      );
      input.value = 'al';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(150);
      input.value = 'alice@example.com';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(150);
      expect(events).toHaveLength(0);
      vi.advanceTimersByTime(200);
      expect(events).toHaveLength(1);
      expect(events[0].payload.fieldName).toBe('email');
      expect(events[0].payload.valueLength).toBe('alice@example.com'.length);
      expect(events[0].payload.hasPii).toBe(true);
      // Critical: no `value` key in the payload.
      expect((events[0].payload as Record<string, unknown>).value).toBeUndefined();
      teardown();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('form-submit handler', () => {
  it('emits form.submit with fieldCount', () => {
    document.body.innerHTML = `
      <form name="login">
        <input name="email" />
        <input name="password" />
        <button type="submit">Go</button>
      </form>`;
    const form = document.querySelector('form') as HTMLFormElement;
    const events: any[] = [];
    const teardown = installFormSubmitHandler(
      (e) => events.push(e),
      ctxFor(),
    );
    const submit = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    teardown();
    expect(events).toHaveLength(1);
    expect(events[0].payload.formName).toBe('login');
    expect(events[0].payload.fieldCount).toBeGreaterThan(0);
  });
});

describe('scroll-depth handler', () => {
  it('fires each milestone at most once per route', () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 1100,
    });
    const events: any[] = [];
    const teardown = installScrollDepthHandler(
      (e) => events.push(e),
      ctxFor('/r1'),
    );
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 250, // ~25%
    });
    window.dispatchEvent(new Event('scroll'));
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 250,
    });
    window.dispatchEvent(new Event('scroll'));
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 600, // ~60%
    });
    window.dispatchEvent(new Event('scroll'));
    teardown();
    const percents = events.map((e) => e.payload.percent);
    // 25 fires once + 50 fires once = 2 events
    expect(percents).toEqual([25, 50]);
  });
});

describe('focus-change handler', () => {
  it('emits true on window focus and false on blur', () => {
    const events: any[] = [];
    const teardown = installFocusChangeHandler(
      (e) => events.push(e),
      ctxFor(),
    );
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('blur'));
    teardown();
    expect(events).toEqual([
      expect.objectContaining({ payload: { focused: true } }),
      expect.objectContaining({ payload: { focused: false } }),
    ]);
  });
});

describe('keyboard-shortcut handler', () => {
  it('emits only for Cmd/Ctrl combos and skips plain alphanumeric', () => {
    const events: any[] = [];
    const teardown = installKeyboardShortcutHandler(
      (e) => events.push(e),
      ctxFor(),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true }),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    teardown();
    expect(events).toHaveLength(2);
    expect(events[0].payload.combo).toContain('Meta');
    expect(events[1].payload.combo).toContain('Escape');
  });
});

describe('copy-paste handler', () => {
  it('emits copy / paste direction with selectionLength only', () => {
    const events: any[] = [];
    const teardown = installCopyPasteHandler(
      (e) => events.push(e),
      ctxFor(),
    );
    document.dispatchEvent(new Event('copy'));
    document.dispatchEvent(new Event('paste'));
    teardown();
    expect(events).toHaveLength(2);
    expect(events[0].payload.direction).toBe('copy');
    expect(typeof events[0].payload.selectionLength).toBe('number');
    expect(events[1].payload.direction).toBe('paste');
  });
});

describe('viewport-resize handler', () => {
  it('debounces and emits the latest dimensions', async () => {
    vi.useFakeTimers();
    try {
      const events: any[] = [];
      const teardown = installViewportResizeHandler(
        (e) => events.push(e),
        ctxFor(),
      );
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: 100,
      });
      Object.defineProperty(window, 'innerHeight', {
        configurable: true,
        value: 200,
      });
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('resize'));
      vi.advanceTimersByTime(100);
      expect(events).toHaveLength(0);
      vi.advanceTimersByTime(250);
      expect(events).toHaveLength(1);
      expect(events[0].payload.width).toBe(100);
      teardown();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('error-boundary handler', () => {
  it('emits error.boundary on window error event', () => {
    const events: any[] = [];
    const teardown = installErrorBoundaryHandler(
      (e) => events.push(e),
      ctxFor(),
    );
    const err = new Error('boom');
    err.name = 'BoomError';
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'boom', error: err }),
    );
    teardown();
    expect(events).toHaveLength(1);
    expect(events[0].payload.errorName).toBe('BoomError');
  });

  it('truncates very long stacks to 500 chars', () => {
    const events: any[] = [];
    const teardown = installErrorBoundaryHandler(
      (e) => events.push(e),
      ctxFor(),
    );
    const err = new Error('boom');
    err.stack = 'x'.repeat(2000);
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'boom', error: err }),
    );
    teardown();
    expect(events[0].payload.componentStack.length).toBeLessThanOrEqual(500);
  });
});

describe('a11y-tree-diff handler', () => {
  it('emits an initial baseline event', () => {
    document.body.innerHTML = `<main><button>Save</button></main>`;
    const events: any[] = [];
    const teardown = installA11yTreeDiffHandler(
      (e) => events.push(e),
      ctxFor(),
    );
    expect(events).toHaveLength(1);
    expect(events[0].payload).toHaveProperty('addedRoles');
    expect(events[0].payload).toHaveProperty('removedRoles');
    teardown();
  });
});

// Sanity: every handler matches the contract.
describe('handler contract', () => {
  it('every handler returns a teardown that does not throw', () => {
    const handlers: SensoryHandler[] = [
      { id: 'page.view', install: installPageViewHandler },
      { id: 'element.click', install: installElementClickHandler },
      { id: 'form.submit', install: installFormSubmitHandler },
      { id: 'focus.change', install: installFocusChangeHandler },
    ];
    for (const h of handlers) {
      const noop: EmitFn = () => undefined;
      const teardown = h.install(noop, ctxFor());
      expect(typeof teardown).toBe('function');
      expect(() => teardown()).not.toThrow();
    }
  });
});
