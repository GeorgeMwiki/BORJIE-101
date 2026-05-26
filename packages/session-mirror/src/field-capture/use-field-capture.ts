'use client';

/**
 * `useFieldCapture` — React hook that captures the live value of a
 * single form field and emits a `field_change` event through the
 * surrounding `SessionMirrorProvider`.
 *
 * Debounce: 500ms. On blur or unmount, the pending value is flushed
 * immediately so the MD never misses the last keystroke before the
 * user moves on.
 *
 * Privacy: values are run through the `pii-redactor` before they leave
 * the hook; PII fields ship with a hash, not the value. Elements
 * carrying the `data-no-capture` attribute are skipped — emit() is
 * never called for them.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { emitFieldChange } from './emit-field-change.js';
import { useCaptureEmit, useSessionScope } from '../provider/session-mirror-provider.js';

const DEBOUNCE_MS = 500;

export interface UseFieldCaptureArgs {
  readonly tabId: string;
  readonly fieldId: string;
  readonly fieldType?: string | undefined;
  /** Skip capture entirely — useful for explicit opt-out without dropping the hook. */
  readonly disabled?: boolean;
}

export interface UseFieldCaptureReturn {
  /** Call from your input's `onChange` with the next value. */
  readonly onChange: (next: string) => void;
  /** Call from your input's `onBlur` to force-flush any pending debounce. */
  readonly onBlur: () => void;
}

export function useFieldCapture(
  args: UseFieldCaptureArgs,
): UseFieldCaptureReturn {
  const emit = useCaptureEmit();
  const scope = useSessionScope();
  const pendingValue = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (pendingValue.current === null) return;
    const value = pendingValue.current;
    pendingValue.current = null;
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (args.disabled) return;
    if (!scope) return;
    await emitFieldChange({
      tenantId: scope.tenantId,
      sessionId: scope.sessionId,
      tabId: args.tabId,
      fieldId: args.fieldId,
      ...(args.fieldType !== undefined ? { fieldType: args.fieldType } : {}),
      value,
      emit,
    });
  }, [args.disabled, args.fieldId, args.fieldType, args.tabId, emit, scope]);

  const onChange = useCallback(
    (next: string) => {
      if (args.disabled) return;
      pendingValue.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void flush();
      }, DEBOUNCE_MS);
    },
    [args.disabled, flush],
  );

  const onBlur = useCallback(() => {
    void flush();
  }, [flush]);

  // Flush on unmount so the last keystroke is not lost.
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  return useMemo(() => ({ onChange, onBlur }), [onChange, onBlur]);
}
