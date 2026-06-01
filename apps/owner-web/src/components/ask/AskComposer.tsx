'use client';

import { useCallback, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Send, Square } from 'lucide-react';
import { VoiceMicButton } from '@/components/voice/VoiceMicButton';

const schema = z.object({
  content: z
    .string()
    .min(1, 'Type a question to send.')
    .max(2000, 'Keep prompts under 2000 chars.'),
});
type FormValues = z.infer<typeof schema>;

interface AskComposerProps {
  readonly onSubmit: (content: string) => void;
  readonly onAbort?: () => void;
  readonly busy: boolean;
  readonly disabled?: boolean;
  /**
   * When set, a locale-aware hands-free mic (Web Speech STT) is mounted
   * beside the send control. The owner's spoken sentence streams into
   * the textarea live and auto-submits through the same `onSubmit`
   * pipeline as typing. Omit the prop to render the composer without
   * voice (the default for surfaces that are not a primary chat entry).
   * The mic self-hides when the browser lacks SpeechRecognition.
   */
  readonly voiceLocale?: 'sw' | 'en';
}

/**
 * Composer at the bottom of the ask-Borjie surface. Zod-validated via
 * react-hook-form so blank submits are blocked and overlong prompts
 * fail fast. Enter sends; Shift+Enter inserts a newline.
 *
 * Disabled state (e.g. when the gateway env var is missing) renders
 * the textarea as read-only and the send button as inactive — no
 * silent failures, no mock fallback.
 *
 * Hands-free voice (opt-in via `voiceLocale`): a `VoiceMicButton`
 * dictates in the owner's active locale (en→en-TZ, sw→sw-TZ). The final
 * transcript both fills the textarea (so the owner sees the captured
 * sentence) and auto-submits, so speaking a sentence reaches the brain
 * exactly like typing it.
 */
export function AskComposer({
  onSubmit,
  onAbort,
  busy,
  disabled,
  voiceLocale,
}: AskComposerProps) {
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { content: '' },
  });
  const [draft, setDraft] = useState('');

  const submit = (values: FormValues): void => {
    onSubmit(values.content);
    reset({ content: '' });
    setDraft('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey && !busy && !disabled) {
      e.preventDefault();
      void handleSubmit(submit)();
    }
  };

  // Live interim transcript → mirror into the textarea so the owner sees
  // what is being captured (no submit yet).
  const onTranscriptUpdate = useCallback(
    (text: string): void => {
      setValue('content', text, { shouldValidate: false });
      setDraft(text);
    },
    [setValue],
  );

  // Final transcript → submit it straight through the same pipeline as a
  // typed message, then clear the composer. Guarded by busy/disabled so a
  // late recogniser callback can never fire a turn mid-stream.
  const onTranscriptFinal = useCallback(
    (transcript: string): void => {
      const trimmed = transcript.trim();
      if (trimmed.length === 0 || busy || disabled) return;
      onSubmit(trimmed);
      reset({ content: '' });
      setDraft('');
    },
    [busy, disabled, onSubmit, reset],
  );

  return (
    <form
      onSubmit={(e: FormEvent<HTMLFormElement>) => void handleSubmit(submit)(e)}
      className="flex items-end gap-2 border-t border-border bg-surface/40 px-3 py-3"
      data-testid="ask-composer"
      noValidate
    >
      <div className="flex-1">
        <textarea
          {...register('content', {
            onChange: (e) => setDraft(e.target.value),
          })}
          value={draft}
          onKeyDown={onKey}
          rows={Math.min(6, Math.max(1, draft.split('\n').length))}
          placeholder="Ask Borjie Brain — Swahili or English. Enter to send, Shift+Enter for a new line."
          aria-label="Ask Borjie"
          disabled={disabled}
          className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-warning disabled:cursor-not-allowed disabled:opacity-50"
        />
        {errors.content ? (
          <div className="mt-1 text-xs text-destructive">
            {errors.content.message}
          </div>
        ) : null}
      </div>
      {voiceLocale ? (
        <VoiceMicButton
          languagePreference={voiceLocale}
          disabled={Boolean(busy || disabled)}
          onTranscriptUpdate={onTranscriptUpdate}
          onTranscriptFinal={onTranscriptFinal}
        />
      ) : null}
      {busy && onAbort ? (
        <button
          type="button"
          onClick={onAbort}
          aria-label="Stop generating"
          className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive hover:bg-destructive/20"
        >
          <Square className="h-4 w-4" aria-hidden="true" /> Stop
        </button>
      ) : (
        <button
          type="submit"
          aria-label="Send message"
          disabled={busy || disabled}
          className="inline-flex items-center gap-1 rounded-md border border-warning bg-warning-subtle/30 px-3 py-2 text-sm text-warning hover:bg-warning-subtle/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden="true" /> Send
        </button>
      )}
    </form>
  );
}
