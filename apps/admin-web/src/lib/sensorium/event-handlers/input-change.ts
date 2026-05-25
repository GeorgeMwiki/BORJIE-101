/**
 * `input.change` handler — Central Command Phase A.
 *
 * Debounced 300ms. Emits only the field's SHAPE: name, length, hasPii
 * bit. NEVER the value. Password / cc / cvv fields always flag
 * hasPii=true regardless of content.
 */

import { redactToShape } from '../pii-redactor.js';
import type { HandlerInstall } from './types.js';

const DEBOUNCE_MS = 300;

export const installInputChangeHandler: HandlerInstall = (emit, ctx) => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  function onInput(ev: Event): void {
    const target = ev.target as HTMLInputElement | null;
    if (
      !target ||
      (target.tagName !== 'INPUT' &&
        target.tagName !== 'TEXTAREA' &&
        target.tagName !== 'SELECT')
    ) {
      return;
    }
    const fieldName =
      target.getAttribute('name') ?? target.id ?? target.tagName.toLowerCase();
    const key = fieldName + (target.id ?? '');
    const prev = timers.get(key);
    if (prev) clearTimeout(prev);
    const handle = setTimeout(() => {
      timers.delete(key);
      const shape = redactToShape({
        fieldName,
        value: typeof target.value === 'string' ? target.value : '',
        type: target.getAttribute('type') ?? undefined,
      });
      emit({
        eventType: 'input.change',
        route: ctx.route(),
        emittedAt: new Date().toISOString(),
        payload: {
          fieldName: shape.fieldName,
          valueLength: shape.valueLength,
          hasPii: shape.hasPii,
          route: ctx.route(),
        },
      });
    }, DEBOUNCE_MS);
    timers.set(key, handle);
  }

  if (typeof document === 'undefined') return () => undefined;
  document.addEventListener('input', onInput, { capture: true });
  return () => {
    document.removeEventListener('input', onInput, { capture: true });
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
  };
};
