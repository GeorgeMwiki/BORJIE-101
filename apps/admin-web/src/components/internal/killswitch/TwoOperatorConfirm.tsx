'use client';

import { useEffect, useState } from 'react';
import { ConfirmModal } from '../ConfirmModal';
import type { SwitchState } from '@/lib/mocks/types';

interface TwoOperatorConfirmProps {
  readonly open: boolean;
  readonly junior: string;
  readonly currentOperatorId: string;
  readonly target: SwitchState;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (secondOperatorId: string) => void;
}

const WINDOW_MS = 30_000;

/**
 * Two-operator confirm. The operator who initiated the change has 30s
 * to get a second operator's ID typed in and submitted; after that
 * the request expires and the modal closes itself. Required for all
 * killswitch mutations per the build plan.
 */
export function TwoOperatorConfirm({
  open,
  junior,
  currentOperatorId,
  target,
  busy,
  onCancel,
  onConfirm,
}: TwoOperatorConfirmProps): JSX.Element {
  const [secondId, setSecondId] = useState('');
  const [remaining, setRemaining] = useState(WINDOW_MS / 1000);

  useEffect(() => {
    if (!open) {
      setSecondId('');
      setRemaining(WINDOW_MS / 1000);
      return undefined;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      const left = Math.max(0, WINDOW_MS - (Date.now() - start));
      setRemaining(Math.ceil(left / 1000));
      if (left <= 0) {
        window.clearInterval(id);
        onCancel();
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [open, onCancel]);

  const isSelf = secondId.trim() === currentOperatorId;
  const isValid = secondId.trim().length >= 3 && !isSelf;

  return (
    <ConfirmModal
      open={open}
      tone={target === 'OK' ? 'info' : 'danger'}
      title={`Set ${junior} → ${target}`}
      body={
        <div className="space-y-3">
          <p>
            A second operator must confirm within <strong className="text-foreground tabular-nums">{remaining}s</strong>.
          </p>
          <label className="block">
            <span className="block text-xs uppercase tracking-wider text-neutral-500 mb-1">Second operator ID</span>
            <input
              type="text"
              autoFocus
              value={secondId}
              onChange={(e) => setSecondId(e.target.value)}
              placeholder="e.g. op_naima"
              className="w-full rounded-md border border-border bg-surface-sunken px-3 py-2 text-sm text-foreground"
            />
          </label>
          {isSelf ? <p className="text-xs text-danger">Second operator must differ from {currentOperatorId}.</p> : null}
        </div>
      }
      confirmLabel="Confirm"
      cancelLabel="Cancel"
      busy={busy || !isValid}
      onCancel={onCancel}
      onConfirm={() => isValid && onConfirm(secondId.trim())}
    />
  );
}
