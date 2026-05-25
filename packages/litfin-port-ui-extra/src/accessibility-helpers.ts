/**
 * Accessibility helpers.
 *
 * LITFIN ref: src/core/ui/a11y/* — focus-trap, ARIA-live region
 * manager, skip-to-main. Helpers are deterministic and DOM-free where
 * possible; DOM-touching helpers take an element parameter so the
 * caller controls scope.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'details > summary',
].join(',');

export const findFocusable = (root: HTMLElement): readonly HTMLElement[] => {
  const list = root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  return Array.from(list).filter((el) => el.offsetParent !== null || el.tagName === 'A');
};

export interface FocusTrap {
  readonly activate: () => void;
  readonly deactivate: () => void;
}

export const createFocusTrap = (
  container: HTMLElement,
  options: { readonly returnFocus?: HTMLElement | null } = {},
): FocusTrap => {
  let previouslyFocused: HTMLElement | null = options.returnFocus ?? null;
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab') return;
    const focusables = findFocusable(container);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (first === undefined || last === undefined) return;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return {
    activate: () => {
      previouslyFocused =
        previouslyFocused ?? (document.activeElement as HTMLElement | null);
      const focusables = findFocusable(container);
      focusables[0]?.focus();
      container.addEventListener('keydown', onKey);
    },
    deactivate: () => {
      container.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    },
  };
};

// ----------------------------------------------------------------------
// ARIA-live region manager — single global node so screen readers don't
// get overwhelmed; messages are de-duplicated within a debounce window.
// ----------------------------------------------------------------------

export interface AriaAnnouncer {
  readonly announce: (
    message: string,
    politeness?: 'polite' | 'assertive',
  ) => void;
  readonly destroy: () => void;
}

export const createAriaAnnouncer = (
  options: {
    readonly debounceMs?: number;
    readonly attachTo?: HTMLElement;
  } = {},
): AriaAnnouncer => {
  const root = options.attachTo ?? document.body;
  const region = document.createElement('div');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  region.style.position = 'absolute';
  region.style.left = '-10000px';
  region.style.width = '1px';
  region.style.height = '1px';
  region.style.overflow = 'hidden';
  root.appendChild(region);
  let lastMessage: string | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = options.debounceMs ?? 200;
  return {
    announce: (message, politeness) => {
      if (message === lastMessage) return;
      region.setAttribute('aria-live', politeness ?? 'polite');
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        region.textContent = '';
        region.textContent = message;
        lastMessage = message;
      }, debounceMs);
    },
    destroy: () => {
      if (pendingTimer !== null) clearTimeout(pendingTimer);
      region.remove();
    },
  };
};

// ----------------------------------------------------------------------
// Skip-to-main — returns the props an anchor needs to render an
// accessible skip link.
// ----------------------------------------------------------------------

export interface SkipLinkProps {
  readonly href: string;
  readonly className: string;
  readonly children: string;
}

export const skipToMain = (
  mainId: string = 'main',
  label: string = 'Skip to main content',
): SkipLinkProps => ({
  href: `#${mainId}`,
  className:
    'sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-background focus:px-3 focus:py-2 focus:rounded-md focus:ring-2 focus:ring-ring',
  children: label,
});
