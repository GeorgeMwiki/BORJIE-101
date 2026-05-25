'use client';

import { useEffect, useRef, type ReactNode } from 'react';

interface ConfirmModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly body: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly tone?: 'danger' | 'warn' | 'info';
  readonly busy?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

const TONE_STYLES: Record<'danger' | 'warn' | 'info', string> = {
  danger: 'bg-danger/20 text-danger hover:bg-danger/30 border-danger/40',
  warn: 'bg-warning/20 text-warning hover:bg-warning/30 border-warning/40',
  info: 'bg-signal-500/20 text-signal-500 hover:bg-signal-500/30 border-signal-500/30',
};

/**
 * Headless-style modal built on the native <dialog> element so we keep
 * keyboard focus trapping + ESC-to-dismiss for free without pulling a
 * Radix dependency into the internal admin bundle.
 */
export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps): JSX.Element {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      className="rounded-lg border border-border bg-surface p-0 backdrop:bg-black/60"
    >
      <div className="w-[28rem] max-w-[90vw] p-6">
        <h2 className="text-base font-display text-foreground mb-2">{title}</h2>
        <div className="text-sm text-neutral-300 mb-6">{body}</div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-neutral-300 hover:bg-surface-sunken disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${TONE_STYLES[tone]}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
