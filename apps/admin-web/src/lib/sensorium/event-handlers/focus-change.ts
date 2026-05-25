/**
 * `focus.change` handler — Central Command Phase A.
 *
 * Window-level focus / blur. The brain reads this to know whether
 * the user is even looking at the surface — high-stakes "are you
 * about to confirm something destructive?" prompts get suppressed
 * when the user has tabbed away.
 */

import type { HandlerInstall } from './types.js';

export const installFocusChangeHandler: HandlerInstall = (emit, ctx) => {
  function fire(focused: boolean): void {
    emit({
      eventType: 'focus.change',
      route: ctx.route(),
      emittedAt: new Date().toISOString(),
      payload: { focused },
    });
  }

  if (typeof window === 'undefined') return () => undefined;
  const onFocus = () => fire(true);
  const onBlur = () => fire(false);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  return () => {
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
  };
};
