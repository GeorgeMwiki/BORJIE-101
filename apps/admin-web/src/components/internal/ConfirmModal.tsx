'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@borjie/design-system';

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

const TONE_VARIANT: Record<'danger' | 'warn' | 'info', ButtonProps['variant']> =
  {
    danger: 'destructive',
    warn: 'warning',
    info: 'default',
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
      <div className="w-dialog-md max-w-modal-cap p-6">
        <h2 className="text-base font-display text-foreground mb-2">{title}</h2>
        <div className="text-sm text-neutral-300 mb-6">{body}</div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={TONE_VARIANT[tone]}
            size="sm"
            onClick={onConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
