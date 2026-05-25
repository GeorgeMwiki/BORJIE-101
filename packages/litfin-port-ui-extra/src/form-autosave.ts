/**
 * Form abstractions — autosave + dirty-tracking + warn-on-leave.
 *
 * LITFIN ref: src/core/ui/forms/* — provides headless state helpers
 * that drop into any React/Vue/Solid form library by feeding values
 * and exposing autosave/dirty status. No React import here so the
 * package stays framework-free.
 */

export interface FormSnapshot<T extends Readonly<Record<string, unknown>>> {
  readonly initial: T;
  readonly current: T;
  /** Last successfully-saved snapshot. */
  readonly lastSaved: T;
  readonly lastSavedAtMs: number | null;
  readonly status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  readonly error: string | null;
}

const shallowEqual = <T extends Readonly<Record<string, unknown>>>(a: T, b: T): boolean => {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (a[k] !== b[k]) return false;
  }
  return true;
};

export const initFormState = <T extends Readonly<Record<string, unknown>>>(
  initial: T,
): FormSnapshot<T> => ({
  initial,
  current: initial,
  lastSaved: initial,
  lastSavedAtMs: null,
  status: 'idle',
  error: null,
});

export const setValue = <T extends Readonly<Record<string, unknown>>>(
  state: FormSnapshot<T>,
  next: T,
): FormSnapshot<T> => {
  const dirty = !shallowEqual(state.lastSaved, next);
  return {
    ...state,
    current: next,
    status: dirty ? 'dirty' : 'idle',
    error: null,
  };
};

export const isDirty = <T extends Readonly<Record<string, unknown>>>(
  state: FormSnapshot<T>,
): boolean => !shallowEqual(state.lastSaved, state.current);

export const warnOnLeave = <T extends Readonly<Record<string, unknown>>>(
  state: FormSnapshot<T>,
): boolean => isDirty(state) && state.status !== 'saving';

export interface AutosavePort<T> {
  readonly save: (value: T) => Promise<void>;
}

export const startSave = <T extends Readonly<Record<string, unknown>>>(
  state: FormSnapshot<T>,
): FormSnapshot<T> => ({ ...state, status: 'saving', error: null });

export const completeSave = <T extends Readonly<Record<string, unknown>>>(
  state: FormSnapshot<T>,
  nowMs: number,
): FormSnapshot<T> => ({
  ...state,
  lastSaved: state.current,
  lastSavedAtMs: nowMs,
  status: 'saved',
  error: null,
});

export const failSave = <T extends Readonly<Record<string, unknown>>>(
  state: FormSnapshot<T>,
  error: string,
): FormSnapshot<T> => ({ ...state, status: 'error', error });

export interface DebounceConfig {
  readonly minDelayMs: number;
  readonly maxDelayMs: number;
}

export const DEFAULT_DEBOUNCE: DebounceConfig = { minDelayMs: 500, maxDelayMs: 3000 };

/**
 * Decide whether the autosave engine should fire now. Stateless so the
 * caller can drive it from an effect with `nowMs` and `lastKeystrokeMs`.
 */
export const shouldFireAutosave = (
  lastKeystrokeMs: number,
  lastFiredMs: number,
  nowMs: number,
  cfg: DebounceConfig = DEFAULT_DEBOUNCE,
): boolean => {
  const sinceKey = nowMs - lastKeystrokeMs;
  const sinceFire = nowMs - lastFiredMs;
  if (sinceKey >= cfg.minDelayMs) return true;
  if (sinceFire >= cfg.maxDelayMs) return true;
  return false;
};
