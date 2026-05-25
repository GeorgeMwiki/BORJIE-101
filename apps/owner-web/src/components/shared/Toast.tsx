'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';

interface ToastProps {
  readonly message: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly onDismiss: () => void;
  readonly autoHideMs?: number;
}

/**
 * Lightweight toast surface used after async actions (report
 * generated, renewal pack queued, etc). Auto-dismisses after 6s.
 */
export function Toast({
  message,
  actionLabel,
  onAction,
  onDismiss,
  autoHideMs = 6000,
}: ToastProps) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => {
      setVisible(false);
      onDismiss();
    }, autoHideMs);
    return () => clearTimeout(t);
  }, [visible, autoHideMs, onDismiss]);

  if (!visible) return null;
  return (
    <div
      role="status"
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border border-success/50 bg-surface px-4 py-3 shadow-lg"
    >
      <CheckCircle2 className="h-5 w-5 text-success" />
      <span className="text-sm text-foreground">{message}</span>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="text-xs font-medium text-warning hover:underline"
        >
          {actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => {
          setVisible(false);
          onDismiss();
        }}
        aria-label="Dismiss"
        className="text-neutral-500 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
