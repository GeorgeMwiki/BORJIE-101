'use client';

import { useEffect } from 'react';

interface ToastProps {
  readonly message: string | null;
  readonly tone?: 'success' | 'danger' | 'info';
  readonly onDismiss: () => void;
}

const TONE_STYLES: Record<'success' | 'danger' | 'info', string> = {
  success: 'border-success/40 bg-success/10 text-success',
  danger: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-signal-500/30 bg-signal-500/10 text-signal-500',
};

/**
 * Bare-bones aria-live toast — auto-dismisses after 3s so async
 * mutation callers don't have to manage the timer themselves.
 * Passing `message=null` hides the toast.
 */
export function Toast({ message, tone = 'success', onDismiss }: ToastProps): JSX.Element | null {
  useEffect(() => {
    if (!message) return undefined;
    const t = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(t);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-50 rounded-lg border px-4 py-2 text-xs shadow-lg ${TONE_STYLES[tone]}`}
    >
      {message}
    </div>
  );
}
