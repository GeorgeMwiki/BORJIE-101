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
 *   - Optimistic UI: closes immediately on Send; re-opens with an
 *     error line on failure.
 *
 * Mounting policy: this file ONLY exports the component. Pages opt in
 * by importing and placing the button — there is no auto-mount.
 *
 * LitFin DNA: the trigger is the signal-gold CTA we use for any
 * primary affordance (rounded-xl, primary text, ring-on-focus). The
 * modal uses our standard `bg-card border-border ring-inset` panel so
 * it sits inside the navy cockpit instead of breaking out into a
 * white sheet.
 *
 * Bilingual: Swahili-first labels per CLAUDE.md.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquarePlus, Star, X } from 'lucide-react';
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

  // Close on Escape — modal convention.
  useEffect((): (() => void) => {
    if (!open) return () => undefined;
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [open, close]);

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
        className="fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg transition-all hover:bg-signal-400 hover:shadow-xl active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={pick(LABELS.open, lang)}
        data-testid="feedback-button-open"
      >
        <MessageSquarePlus aria-hidden="true" className="h-4 w-4" />
        {pick(LABELS.open, lang)}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="feedback-modal-title"
          data-testid="feedback-button-modal"
          onClick={close}
        >
          <div
            className="relative w-full max-w-md rounded-t-2xl border border-border bg-card p-6 shadow-xl sm:rounded-2xl"
            onClick={(e): void => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={close}
              className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40"
              aria-label={pick(LABELS.cancel, lang)}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
            <h2
              id="feedback-modal-title"
              className="font-display text-xl font-medium tracking-tight text-foreground"
            >
              {pick(LABELS.title, lang)}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {pick(LABELS.ratingPrompt, lang)}
            </p>

            <div
              className="mt-4 flex gap-2"
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
                        ? 'inline-flex h-11 w-11 items-center justify-center rounded-xl bg-signal-500 text-primary-foreground shadow-sm transition-transform hover:scale-[1.04] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40'
                        : 'inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-muted/30 text-muted-foreground transition-colors hover:border-border-strong hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40'
                    }
                    data-testid={`feedback-button-star-${star}`}
                  >
                    <Star
                      aria-hidden="true"
                      className="h-4 w-4"
                      fill={active ? 'currentColor' : 'none'}
                    />
                    <span className="sr-only">{star}</span>
                  </button>
                );
              })}
            </div>

            <label
              htmlFor="feedback-message"
              className="mt-5 block text-sm font-medium text-foreground"
            >
              {lang === 'en' ? 'Your note' : 'Ujumbe wako'}
            </label>
            <textarea
              id="feedback-message"
              value={message}
              onChange={(e): void => setMessage(e.target.value.slice(0, 1500))}
              placeholder={pick(LABELS.messagePlaceholder, lang)}
              className="mt-1.5 min-h-[96px] w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-signal-500 focus:outline-none focus:ring-2 focus:ring-signal-500/20"
              maxLength={1500}
              aria-label={pick(LABELS.messagePlaceholder, lang)}
              data-testid="feedback-button-message"
            />
            <p className="mt-1 text-right font-mono text-[10px] tabular-nums text-muted-foreground/70">
              {message.length} / 1500
            </p>

            {error ? (
              <p
                role="alert"
                className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                data-testid="feedback-button-error"
              >
                {error}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:border-border-strong hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40"
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
                className="rounded-xl bg-signal-500 px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md transition-all hover:bg-signal-400 hover:shadow-lg active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
