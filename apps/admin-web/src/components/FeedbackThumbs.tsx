'use client';

/**
 * FeedbackThumbs (Admin) — per-Jarvis-turn feedback widget.
 *
 * Mirrors `apps/customer-app/src/components/FeedbackThumbs.tsx` exactly
 * — the gateway wire and the kernel's `kernel_feedback` table treat
 * every surface identically. Living the same component locally keeps
 * the strict per-app file-isolation S4 sweep recommended.
 *
 * Behaviour:
 *   - 👍/👎 buttons under the assistant turn
 *   - 👎 expands a 1-line reason input
 *   - submit handler is caller-owned (POST /api/v1/feedback)
 *   - optimistic disable while submitting; toast on failure
 */

import { useCallback, useEffect, useState } from 'react';

export type FeedbackVerdict = 'up' | 'down';

export interface FeedbackThumbsProps {
  readonly turnId: string;
  readonly onFeedback: (verdict: FeedbackVerdict, reason?: string) => Promise<void>;
  readonly disabled?: boolean;
}

const REASON_MAX_LEN = 200;
const TOAST_DURATION_MS = 3000;

export function FeedbackThumbs({
  turnId,
  onFeedback,
  disabled = false,
}: FeedbackThumbsProps): JSX.Element {
  const [submitting, setSubmitting] = useState(false);
  const [submittedVerdict, setSubmittedVerdict] = useState<FeedbackVerdict | null>(null);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const handle = setTimeout(() => setError(null), TOAST_DURATION_MS);
    return (): void => clearTimeout(handle);
  }, [error]);

  const submit = useCallback(
    async (verdict: FeedbackVerdict, reasonText?: string): Promise<void> => {
      if (submitting || disabled) return;
      setSubmitting(true);
      setError(null);
      try {
        await onFeedback(verdict, reasonText);
        setSubmittedVerdict(verdict);
        setShowReason(verdict === 'down');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Feedback failed';
        setError(msg);
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, disabled, onFeedback],
  );

  const submitReason = useCallback(
    async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
      e.preventDefault();
      const trimmed = reason.trim();
      if (!trimmed) return;
      await submit('down', trimmed);
      if (!error) setReason('');
    },
    [reason, submit, error],
  );

  const buttonsDisabled = submitting || disabled;
  const upChosen = submittedVerdict === 'up';
  const downChosen = submittedVerdict === 'down';

  return (
    <div
      className="mt-2 flex flex-col gap-2"
      data-testid={`feedback-thumbs-${turnId}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Was this helpful?</span>
        <button
          type="button"
          aria-label="Thumbs up"
          aria-pressed={upChosen}
          disabled={buttonsDisabled}
          onClick={(): void => void submit('up')}
          className={
            upChosen
              ? 'rounded border border-primary bg-primary px-2 py-1 text-primary-foreground disabled:opacity-50'
              : 'rounded border border-border bg-surface px-2 py-1 text-foreground hover:bg-surface-sunken disabled:opacity-50'
          }
        >
          {'\u{1F44D}'}
        </button>
        <button
          type="button"
          aria-label="Thumbs down"
          aria-pressed={downChosen}
          disabled={buttonsDisabled}
          onClick={(): void => void submit('down')}
          className={
            downChosen
              ? 'rounded border border-destructive bg-destructive px-2 py-1 text-destructive-foreground disabled:opacity-50'
              : 'rounded border border-border bg-surface px-2 py-1 text-foreground hover:bg-surface-sunken disabled:opacity-50'
          }
        >
          {'\u{1F44E}'}
        </button>
      </div>

      {showReason ? (
        <form onSubmit={submitReason} className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={reason}
            onChange={(e): void =>
              setReason(e.target.value.slice(0, REASON_MAX_LEN))
            }
            placeholder="Tell me what was wrong (optional)"
            aria-label="Feedback reason"
            disabled={buttonsDisabled}
            className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground disabled:opacity-50"
            maxLength={REASON_MAX_LEN}
          />
          <button
            type="submit"
            disabled={buttonsDisabled || reason.trim().length === 0}
            className="rounded border border-border bg-surface px-2 py-1 text-xs text-foreground disabled:opacity-50"
          >
            Send
          </button>
        </form>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="text-xs text-destructive"
          data-testid="feedback-error"
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
