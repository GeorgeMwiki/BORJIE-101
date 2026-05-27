'use client';

/**
 * FeedbackButton (Admin Console) — pilot in-app feedback widget.
 *
 * Lifecycle:
 *   - Renders a fixed bottom-right pill labelled "Niarifu Borjie".
 *   - Click → modal with 1–5 star rating + textarea + Send.
 *   - POSTs to `/api/v1/pilot/feedback` on the api-gateway. Uses the
 *     Supabase Auth session cookie / access token, matching the rest
 *     of the admin console.
 *   - Optimistic UI: closes immediately on Send; re-opens with an error
 *     line on failure.
 *
 * Mounting policy: this file ONLY exports the component. Pages opt in
 * by importing and placing the button — there is no auto-mount.
 *
 * Bilingual: Swahili-first labels per CLAUDE.md.
 */

import { useCallback, useMemo, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

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

function resolveGatewayBase(): string {
  const configured =
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_API_GATEWAY_URL?.trim()
      : undefined;
  const root =
    configured && configured.length > 0
      ? configured.replace(/\/$/, '')
      : 'http://localhost:3001';
  return root;
}

async function authHeaders(): Promise<Record<string, string>> {
  if (typeof window === 'undefined') return {};
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function defaultSubmit(input: FeedbackSubmission): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${resolveGatewayBase()}/api/v1/pilot/feedback`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      rating: input.rating,
      message: input.message,
      screenId: input.screenId,
      sessionContext: input.sessionContext,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `HTTP ${res.status}`);
  }
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
    setOpen(false);
    setSubmitting(true);
    setError(null);
    try {
      await submitter(submission);
      reset();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : pick(LABELS.error, lang),
      );
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
          role="dialog"
          aria-modal="true"
          data-testid="feedback-button-modal"
        >
          <div className="w-full max-w-md rounded-t-xl bg-white p-6 shadow-xl sm:rounded-xl">
            <h2 className="text-lg font-bold text-neutral-900">
              {pick(LABELS.title, lang)}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              {pick(LABELS.ratingPrompt, lang)}
            </p>

            <div
              className="mt-3 flex gap-2"
              role="radiogroup"
              aria-label={pick(LABELS.ratingPrompt, lang)}
            >
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
                        : 'h-11 w-11 rounded-md border border-neutral-200 bg-neutral-50 text-base font-bold text-neutral-700 hover:bg-neutral-100'
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
              className="mt-3 min-h-[96px] w-full rounded-md border border-neutral-200 px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400"
              maxLength={1500}
              aria-label={pick(LABELS.messagePlaceholder, lang)}
              data-testid="feedback-button-message"
            />

            {error ? (
              <p
                role="alert"
                className="mt-2 text-sm text-red-600"
                data-testid="feedback-button-error"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50"
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
