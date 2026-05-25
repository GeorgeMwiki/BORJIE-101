/**
 * `element.click` handler — Central Command Phase A.
 *
 * Captures every click on semantic elements. Truncates the target's
 * visible text to 100 chars. NEVER emits text for inputs whose type
 * is password / cc / cvv — defence in depth against weird autocomplete
 * shapes.
 */

import { truncate } from '../pii-redactor.js';
import type { HandlerInstall } from './types.js';

const SENSITIVE_INPUT_TYPES = /^(password|credit|cc|cvv|ssn)$/i;

export const installElementClickHandler: HandlerInstall = (emit, ctx) => {
  function onClick(ev: MouseEvent): void {
    const target = ev.target as HTMLElement | null;
    if (!target || typeof target.tagName !== 'string') return;

    const tag = target.tagName.toLowerCase();
    const type = (target.getAttribute('type') ?? '').toLowerCase();
    let text = '';
    if (!SENSITIVE_INPUT_TYPES.test(type)) {
      const raw =
        target.getAttribute('aria-label') ??
        target.getAttribute('alt') ??
        target.getAttribute('title') ??
        target.textContent ??
        '';
      text = truncate(raw.trim(), 100);
    }
    emit({
      eventType: 'element.click',
      route: ctx.route(),
      emittedAt: new Date().toISOString(),
      payload: {
        targetTagName: tag,
        targetText: text,
        targetId: target.id || '',
        route: ctx.route(),
      },
    });
  }

  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener('click', onClick, { capture: true });
  return () =>
    document.removeEventListener('click', onClick, { capture: true });
};
