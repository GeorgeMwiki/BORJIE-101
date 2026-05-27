/**
 * Polite ARIA Live Region announcer.
 *
 * Two-region rotation pattern (per MDN ARIA Live Regions guide) so the
 * same message can be announced twice in succession without the
 * screen reader collapsing the second one into a "no change".
 *
 * Sources:
 *  - WAI-ARIA 1.3 — Live Regions Authoring Practices.
 *    <https://www.w3.org/WAI/ARIA/apg/practices/live-regions/> (2026-02-22)
 *  - MDN — Aria-live and the announcer pattern.
 *    <https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/ARIA_Live_Regions> (2026-03-12)
 */

const REGION_A_ID = 'bb-announcer-region-a';
const REGION_B_ID = 'bb-announcer-region-b';
const DEBOUNCE_MS = 500;

interface AnnouncerState {
  readonly debounceTimer: ReturnType<typeof setTimeout> | null;
  readonly toggle: 'a' | 'b';
  readonly pendingMessage: string;
}

let state: AnnouncerState = {
  debounceTimer: null,
  toggle: 'a',
  pendingMessage: '',
};

function ensureRegions(): { readonly a: HTMLElement; readonly b: HTMLElement } | null {
  if (typeof document === 'undefined') return null;
  let a = document.getElementById(REGION_A_ID);
  let b = document.getElementById(REGION_B_ID);
  if (!a) {
    a = document.createElement('div');
    a.id = REGION_A_ID;
    a.setAttribute('aria-live', 'polite');
    a.setAttribute('aria-atomic', 'true');
    a.className = 'bb-announcer';
    document.body.appendChild(a);
  }
  if (!b) {
    b = document.createElement('div');
    b.id = REGION_B_ID;
    b.setAttribute('aria-live', 'polite');
    b.setAttribute('aria-atomic', 'true');
    b.className = 'bb-announcer';
    document.body.appendChild(b);
  }
  return { a, b };
}

/**
 * Announce a message to assistive technology. Calls are debounced
 * (last-write-wins inside the debounce window) so a burst of new
 * posts collapses into one announcement.
 */
export function announce(message: string): void {
  if (!message || typeof document === 'undefined') return;
  const regions = ensureRegions();
  if (!regions) return;

  if (state.debounceTimer !== null) {
    clearTimeout(state.debounceTimer);
  }

  state = { ...state, pendingMessage: message };

  state = {
    ...state,
    debounceTimer: setTimeout(() => {
      const region = state.toggle === 'a' ? regions.a : regions.b;
      const otherRegion = state.toggle === 'a' ? regions.b : regions.a;
      // Clear the other region first so subsequent identical messages
      // are still announced. Per MDN: empty + re-fill.
      otherRegion.textContent = '';
      region.textContent = state.pendingMessage;
      state = {
        debounceTimer: null,
        toggle: state.toggle === 'a' ? 'b' : 'a',
        pendingMessage: '',
      };
    }, DEBOUNCE_MS),
  };
}

/**
 * Internal getter for tests — returns the current contents of both
 * regions plus the debounce timer. Not exported from the public barrel.
 */
export function _internal_getRegions(): {
  readonly a: string;
  readonly b: string;
} | null {
  if (typeof document === 'undefined') return null;
  const a = document.getElementById(REGION_A_ID);
  const b = document.getElementById(REGION_B_ID);
  if (!a || !b) return null;
  return {
    a: a.textContent ?? '',
    b: b.textContent ?? '',
  };
}

/**
 * Flush any pending debounce immediately. Used by tests to avoid
 * waiting on real timers.
 */
export function _internal_flush(): void {
  if (state.debounceTimer !== null) {
    clearTimeout(state.debounceTimer);
    const regions = ensureRegions();
    if (regions && state.pendingMessage) {
      const region = state.toggle === 'a' ? regions.a : regions.b;
      const otherRegion = state.toggle === 'a' ? regions.b : regions.a;
      otherRegion.textContent = '';
      region.textContent = state.pendingMessage;
    }
    state = {
      debounceTimer: null,
      toggle: state.toggle === 'a' ? 'b' : 'a',
      pendingMessage: '',
    };
  }
}
