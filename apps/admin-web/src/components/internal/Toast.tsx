'use client';

/**
 * Toast — THIN WRAPPER preserving the app's declarative toast API
 * (message, tone, onDismiss + 3s auto-dismiss) while delegating all
 * visual styling to the design-system Alert primitive, so the surface
 * inherits the canonical token palette (subtle bg, border, text)
 * instead of the hand-rolled per-tone Tailwind maps.
 *
 * The public API is unchanged — every existing call site keeps
 * compiling verbatim. The only fork the app keeps is the fixed-position
 * aria-live envelope + timer (the DS Toaster/useToast imperative stack
 * is a different contract; converging the 22 call sites onto it is out
 * of scope for this foundation pass).
 */
import { useEffect } from 'react';
import { Alert } from '@borjie/design-system';

interface ToastProps {
  readonly message: string | null;
  readonly tone?: 'success' | 'danger' | 'info';
  readonly onDismiss: () => void;
}

const TONE_VARIANT = {
  success: 'success',
  danger: 'danger',
  info: 'info',
} as const;

export function Toast({ message, tone = 'success', onDismiss }: ToastProps): JSX.Element | null {
  useEffect(() => {
    if (!message) return undefined;
    const t = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(t);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div role="status" aria-live="polite" className="fixed bottom-6 right-6 z-50 max-w-sm">
      <Alert variant={TONE_VARIANT[tone]} size="sm" className="shadow-lg">
        {message}
      </Alert>
    </div>
  );
}
