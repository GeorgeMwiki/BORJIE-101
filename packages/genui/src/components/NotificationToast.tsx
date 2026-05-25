'use client';

/**
 * 32. notification-toast — server-pushed toast confirmation.
 *
 * Differs from `timeline` entries (which are historical) — this is an
 * ephemeral inline toast that auto-dismisses after `autoCloseMs`. Used
 * for "Payment posted", "Notice sent", "Lease saved" confirmations.
 */

import { useEffect, useState } from 'react';

import type { AgUiUiPartByKind } from '../types';
import { Frame, GenUiError } from './Frame';
import { NotificationToastPartSchema } from '../schemas';

export type NotificationToastProps = AgUiUiPartByKind<'notification-toast'>;

const SEVERITY_COLOURS = {
  info: 'border-sky-300 bg-sky-50 text-sky-900',
  success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
  error: 'border-destructive bg-destructive/10 text-destructive',
} as const;

const SEVERITY_ICONS = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕',
} as const;

export function NotificationToast(props: NotificationToastProps): JSX.Element {
  const [visible, setVisible] = useState(true);
  const parsed = NotificationToastPartSchema.safeParse(props);

  useEffect(() => {
    if (!props.autoCloseMs || props.autoCloseMs <= 0) return undefined;
    const id = setTimeout(() => setVisible(false), props.autoCloseMs);
    return () => clearTimeout(id);
  }, [props.autoCloseMs]);

  if (!parsed.success) {
    return (
      <GenUiError
        kind="notification-toast"
        message={parsed.error.issues.map((i) => i.message).join('; ')}
      />
    );
  }
  if (!visible) return <></>;

  function dispatchAction(): void {
    if (typeof window === 'undefined') return;
    try {
      window.dispatchEvent(
        new CustomEvent('genui:notification-toast-action', {
          detail: { payload: props.actionPayload ?? {} },
        }),
      );
    } catch {
      /* ignore */
    }
  }

  return (
    <Frame kind="notification-toast" {...(props.title ? { title: props.title } : {})}>
      <div
        role="status"
        aria-live="polite"
        className={`flex items-start gap-2 rounded border px-3 py-2 text-sm ${SEVERITY_COLOURS[props.severity]}`}
      >
        <span aria-hidden className="text-base">
          {SEVERITY_ICONS[props.severity]}
        </span>
        <div className="flex-1">{props.message}</div>
        {props.actionLabel ? (
          <button
            type="button"
            onClick={dispatchAction}
            className="rounded border border-current/40 bg-white/70 px-2 py-0.5 text-xs font-medium"
          >
            {props.actionLabel}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setVisible(false)}
          aria-label="Dismiss"
          className="rounded border border-current/40 bg-white/70 px-1 text-xs"
        >
          ×
        </button>
      </div>
    </Frame>
  );
}
