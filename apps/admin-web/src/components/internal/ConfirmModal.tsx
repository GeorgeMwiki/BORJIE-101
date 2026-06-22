'use client';

/**
 * ConfirmModal — THIN WRAPPER over the design-system `Modal`.
 *
 * The public API (`open, title, body, confirmLabel, cancelLabel, tone,
 * busy, onConfirm, onCancel`) is preserved VERBATIM so existing callers
 * (PromptRegistry, RollbackPanel, …) keep compiling unchanged. The
 * hand-rolled native `<dialog>` + focus-trap body is gone; overlay,
 * ESC-to-dismiss, focus trapping, and scroll-lock now come from the DS
 * `Modal`, and the footer buttons map `tone` onto the canonical DS
 * `Button` variants.
 */
import type { ReactNode } from 'react';
import { Modal, ModalBody, ModalFooter, Button, type ButtonProps } from '@borjie/design-system';

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

const TONE_VARIANT: Record<'danger' | 'warn' | 'info', ButtonProps['variant']> = {
  danger: 'destructive',
  warn: 'warning',
  info: 'default',
};

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
  return (
    <Modal open={open} onClose={onCancel} title={title} size="md">
      <ModalBody className="text-sm text-muted-foreground">{body}</ModalBody>
      <ModalFooter>
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={busy}>
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
      </ModalFooter>
    </Modal>
  );
}
