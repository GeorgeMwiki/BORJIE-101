/**
 * `form.submit` handler — Central Command Phase A.
 *
 * Fires on every form submission. Emits the form name + field count,
 * never the field values.
 */

import type { HandlerInstall } from './types.js';

export const installFormSubmitHandler: HandlerInstall = (emit, ctx) => {
  function onSubmit(ev: Event): void {
    const form = ev.target as HTMLFormElement | null;
    if (!form || form.tagName !== 'FORM') return;
    const formName =
      form.getAttribute('name') ?? form.id ?? 'unnamed-form';
    const fieldCount = form.elements.length;
    emit({
      eventType: 'form.submit',
      route: ctx.route(),
      emittedAt: new Date().toISOString(),
      payload: {
        formName,
        fieldCount,
        route: ctx.route(),
      },
    });
  }

  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener('submit', onSubmit, { capture: true });
  return () =>
    document.removeEventListener('submit', onSubmit, { capture: true });
};
