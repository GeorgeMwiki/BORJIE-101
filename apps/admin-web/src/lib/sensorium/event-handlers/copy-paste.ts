/**
 * `copy.paste` handler — Central Command Phase A.
 *
 * Emits direction + selection LENGTH only. Never the clipboard
 * content. Copy-to-clipboard on an AI answer is one of the strongest
 * implicit positive signals — see `2025-progressive-intelligence.md`.
 */

import type { HandlerInstall } from './types.js';

export const installCopyPasteHandler: HandlerInstall = (emit, ctx) => {
  function fire(direction: 'copy' | 'paste'): void {
    let selectionLength = 0;
    if (
      direction === 'copy' &&
      typeof window !== 'undefined' &&
      typeof window.getSelection === 'function'
    ) {
      try {
        selectionLength = window.getSelection()?.toString().length ?? 0;
      } catch {
        selectionLength = 0;
      }
    }
    emit({
      eventType: 'copy.paste',
      route: ctx.route(),
      emittedAt: new Date().toISOString(),
      payload: { direction, selectionLength },
    });
  }

  if (typeof document === 'undefined') return () => undefined;
  const onCopy = () => fire('copy');
  const onPaste = () => fire('paste');
  document.addEventListener('copy', onCopy);
  document.addEventListener('paste', onPaste);
  return () => {
    document.removeEventListener('copy', onCopy);
    document.removeEventListener('paste', onPaste);
  };
};
