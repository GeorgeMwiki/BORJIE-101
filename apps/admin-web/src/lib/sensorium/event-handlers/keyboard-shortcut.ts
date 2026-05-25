/**
 * `keyboard.shortcut` handler — Central Command Phase A.
 *
 * Emits ONLY for Cmd/Ctrl/Meta + key combos. Plain alphanumeric keys
 * are skipped (keystroke-level capture is too noisy and a privacy
 * landmine). Function keys (F1-F12) and Escape/Tab also count as
 * "shortcuts" for the brain — they signal navigation intent.
 */

import type { HandlerInstall } from './types.js';

export const installKeyboardShortcutHandler: HandlerInstall = (emit, ctx) => {
  function onKeyDown(ev: KeyboardEvent): void {
    const isMeta = ev.metaKey || ev.ctrlKey;
    const isAlt = ev.altKey;
    const isFunctional =
      ev.key === 'Escape' ||
      ev.key === 'Tab' ||
      /^F\d+$/.test(ev.key);
    if (!isMeta && !isAlt && !isFunctional) return;
    // Skip the meta/ctrl key on its own — only emit when paired.
    if ((isMeta || isAlt) && (ev.key === 'Meta' || ev.key === 'Control' || ev.key === 'Alt')) {
      return;
    }
    const combo = [
      ev.metaKey ? 'Meta' : '',
      ev.ctrlKey ? 'Ctrl' : '',
      ev.altKey ? 'Alt' : '',
      ev.shiftKey ? 'Shift' : '',
      ev.key,
    ]
      .filter(Boolean)
      .join('+');
    emit({
      eventType: 'keyboard.shortcut',
      route: ctx.route(),
      emittedAt: new Date().toISOString(),
      payload: { combo, route: ctx.route() },
    });
  }

  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener('keydown', onKeyDown);
  return () => document.removeEventListener('keydown', onKeyDown);
};
