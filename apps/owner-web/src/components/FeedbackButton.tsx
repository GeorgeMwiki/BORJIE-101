'use client';

/**
 * FeedbackButton (Owner Cockpit) — pilot in-app feedback widget.
 *
 * Lifecycle:
 *   - Renders a fixed bottom-right pill labelled "Niarifu Borjie".
 *   - Click → modal with 1–5 star rating + textarea + Send.
 *   - POSTs to `/api/v1/pilot/feedback` via the owner-web `apiRequest`
 *     client (forwards the Supabase access token).
 *   - Optimistic UI: the modal closes immediately on Send; if the POST
 *     fails, the modal re-opens with the error.
 *
 * Mounting policy: this file ONLY exports the component. Layouts choose
 * whether to mount it (we never auto-mount on every page — pilot scope
 * is opt-in by the page owner).
 *
 * Bilingual: Swahili-first labels per CLAUDE.md.
 */

import { useCallback, useMemo, useState } from 'react';
import { apiRequest, ApiError } from '@/lib/api-client';

export interface FeedbackButtonProps {
  readonly screenId?: string;
  readonly sessionContext?: Readonly<Record<string, unknown>>;
  readonly lang?: 'sw' | 'en';
  /** Override the submit handler for tests / Storybook. */
  readonly onSubmit?: (input: FeedbackSubmission) => Promise<void>;
}

export interface FeedbackSubmission {
  readonly rating: number;
  readonly message: string;
  readonly screenId?: string;
  readonly sessionContext?: Readonly<Record<string, unknown>>;
}

const RATINGS = [1, 2, 3, 4, 5] as const;

const LABELS = {
  open: { sw: 'Niarifu Borjie', en: 'Tell Borjie' },
  title: { sw: 'Tueleze uzoefu wako', en: 'Share your experience' },
  ratingPrompt: { sw: 'Ulipenda kiasi gani?', en: 'How was it?' },
  messagePlaceholder: {
    sw: 'Andika kwa Kiswahili au Kiingereza...',
    en: 'Write in Swahili or English...',
  },
  cancel: { sw: 'Funga', en: 'Close' },
  send: { sw: 'Niarifu Borjie', en: 'Send' },
  error: {
    sw: 'Hatukuweza kutuma — tafadhali jaribu tena',
    en: 'Could not send — please try again',
  },
} as const;

function pick(label: { sw: string; en: string }, lang: 'sw' | 'en'): string {
  return lang === 'en' ? label.en : label.sw;
}

async function defaultSubmit(input: FeedbackSubmission): Promise<void> {
  await apiRequest<{ id: string | null }>(
    '/api/v1/pilot/feedback',
    {
      method: 'POST',
      body: {
        rating: input.rating,
        message: input.message,
        screenId: input.screenId,
        sessionContext: input.sessionContext,
      },
    },
  );
}

export function FeedbackButton({
  screenId,
  sessionContext,
  lang = 'sw',
  onSubmit,
}: FeedbackButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitter = useMemo(() => onSubmit ?? defaultSubmit, [onSubmit]);

  const reset = useCallback((): void => {
    setRating(0);
    setMessage('');
    setError(null);
  }, []);

  const close = useCallback((): void => {
    setOpen(false);
    reset();
  }, [reset]);

  const send = useCallback(async (): Promise<void> => {
    if (submitting) return;
    const trimmed = message.trim();
    if (rating < 1 || rating > 5 || trimmed.length === 0) {
      setError(pick(LABELS.error, lang));
      return;
    }
    const submission: FeedbackSubmission = {
      rating,
      message: trimmed,
      ...(screenId !== undefined ? { screenId } : {}),
      ...(sessionContext !== undefined ? { sessionContext } : {}),
    };
    // Optimistic UI: close first; reopen on error.
    setOpen(false);
    setSubmitting(true);
    setError(null);
    try {
      await submitter(submission);
      reset();
    } catch (cause) {
      const msg =
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : pick(LABELS.error, lang);
      setError(msg);
      setOpen(true);
    } finally {
      setSubmitting(false);
    }
  }, [rating, message, screenId, sessionContext, submitting, submitter, lang, reset]);

  return (
    <>
      <button
        type="button"
        onClick={(): void => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 rounded-full border border-yellow-700 bg-yellow-400 px-4 py-2 text-sm font-bold text-neutral-900 shadow-lg hover:bg-yellow-300"
        aria-label={pick(LABELS.open, lang)}
        data-testid="feedback-button-open"
      >
        {pick(LABELS.open, lang)}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 sm:items-center sm:p-4"
          data-testid="feedback-button-modal"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-t-xl bg-surface p-6 shadow-xl sm:rounded-xl">
            <h2 className="text-lg font-bold text-foreground">
              {pick(LABELS.title, lang)}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {pick(LABELS.ratingPrompt, lang)}
            </p>

            <div className="mt-3 flex gap-2" role="radiogroup" aria-label={pick(LABELS.ratingPrompt, lang)}>
              {RATINGS.map((star) => {
                const active = rating >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={(): void => setRating(star)}
                    className={
                      active
                        ? 'h-11 w-11 rounded-md border border-yellow-700 bg-yellow-400 text-base font-bold text-neutral-900'
                        : 'h-11 w-11 rounded-md border border-border bg-surface-sunken text-base font-bold text-foreground hover:bg-surface'
                    }
                    data-testid={`feedback-button-star-${star}`}
                  >
                    {star}
                  </button>
                );
              })}
            </div>

            <textarea
              value={message}
              onChange={(e): void => setMessage(e.target.value.slice(0, 1500))}
              placeholder={pick(LABELS.messagePlaceholder, lang)}
              className="mt-3 min-h-[96px] w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground"
              maxLength={1500}
              aria-label={pick(LABELS.messagePlaceholder, lang)}
              data-testid="feedback-button-message"
            />

            {error ? (
              <p
                role="alert"
                className="mt-2 text-sm text-destructive"
                data-testid="feedback-button-error"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-sunken"
                data-testid="feedback-button-cancel"
              >
                {pick(LABELS.cancel, lang)}
              </button>
              <button
                type="button"
                onClick={(): void => {
                  void send();
                }}
                disabled={submitting}
                className="rounded-md border border-yellow-700 bg-yellow-400 px-4 py-2 text-sm font-bold text-neutral-900 hover:bg-yellow-300 disabled:opacity-50"
                data-testid="feedback-button-send"
              >
                {pick(LABELS.send, lang)}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
