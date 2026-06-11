'use client';

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Send, Square, Paperclip } from 'lucide-react';
import { VoiceMicButton } from '@/components/voice/VoiceMicButton';
import { pickByLocale } from '@/lib/locale';
import { askComposerStrings as S } from '@/i18n/strings/ask-composer';

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
   * When set, a locale-aware hands-free mic is mounted beside the send
   * control. It PREFERS a realtime-duplex "call" against the gateway voice
   * WS (mic streams up, Mr. Mwikila's audio plays back, barge-in) and
   * automatically FALLS BACK to browser Web-Speech STT when the live path
   * is unavailable or errors — in which case the owner's spoken sentence
   * streams into the textarea live and auto-submits through the same
   * `onSubmit` pipeline as typing. Omit the prop to render the composer
   * without voice. The mic self-hides when the browser lacks both paths.
   */
  readonly voiceLocale?: 'sw' | 'en';
  /**
   * Prefer the realtime-duplex gateway voice path when it can connect.
   * Defaults to true; set false to pin the browser Web-Speech fallback
   * (useful for surfaces or environments where the live WS is undesired).
   */
  readonly preferRealtimeVoice?: boolean;
  /**
   * Optional: receives the assistant's final reply TEXT for a realtime
   * voice turn (the spoken answer's transcript), so a parent surface can
   * render it in the conversation alongside the audio.
   */
  readonly onVoiceReply?: (text: string) => void;
  /**
   * Optional: when set, a paperclip attach button is mounted in the composer.
   * Clicking it opens a native file picker; the chosen files are handed to
   * this callback (the host owns the upload + transcript reflection). This
   * recovers the vertical space the old always-on dashed drop-zone consumed.
   */
  readonly onAttachFiles?: (files: ReadonlyArray<File>) => void;
  /** Localised label for the attach button (EN/SW). */
  readonly attachLabel?: string;
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
 * Hands-free voice (opt-in via `voiceLocale`): a `VoiceMicButton` runs in
 * the owner's active locale (en→en-TZ, sw→sw-TZ). It prefers the realtime
 * duplex call to the gateway brain; when that is unavailable it degrades
 * to browser STT, whose final transcript both fills the textarea (so the
 * owner sees the captured sentence) and auto-submits — so speaking a
 * sentence reaches the brain exactly like typing it.
 */
export function AskComposer({
  onSubmit,
  onAbort,
  busy,
  disabled,
  voiceLocale,
  preferRealtimeVoice = true,
  onVoiceReply,
  onAttachFiles,
  attachLabel,
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFilePicked = useCallback(
    (e: ChangeEvent<HTMLInputElement>): void => {
      const list = e.target.files;
      if (list && list.length > 0 && onAttachFiles) {
        onAttachFiles(Array.from(list));
      }
      // Reset so picking the same file twice still fires a change event.
      e.target.value = '';
    },
    [onAttachFiles],
  );

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
      {onAttachFiles ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={onFilePicked}
            data-testid="ask-composer-file-input"
            aria-hidden="true"
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={Boolean(busy || disabled)}
            aria-label={attachLabel ?? 'Attach a file'}
            data-testid="ask-composer-attach"
            className="inline-flex items-center justify-center rounded-md border border-border bg-surface/40 p-2 text-neutral-400 transition-colors hover:bg-surface/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Paperclip className="h-4 w-4" aria-hidden="true" />
          </button>
        </>
      ) : null}
      <div className="flex-1">
        <textarea
          {...register('content', {
            onChange: (e) => setDraft(e.target.value),
          })}
          value={draft}
          onKeyDown={onKey}
          rows={Math.min(6, Math.max(1, draft.split('\n').length))}
          placeholder={pickByLocale(voiceLocale ?? 'en', S.placeholder)}
          aria-label={pickByLocale(voiceLocale ?? 'en', S.textareaAria)}
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
          preferRealtime={preferRealtimeVoice}
          onTranscriptUpdate={onTranscriptUpdate}
          onTranscriptFinal={onTranscriptFinal}
          {...(onVoiceReply ? { onVoiceReply } : {})}
        />
      ) : null}
      {busy && onAbort ? (
        <button
          type="button"
          onClick={onAbort}
          aria-label={pickByLocale(voiceLocale ?? 'en', S.stopAria)}
          data-testid="ask-composer-stop"
          className="inline-flex items-center gap-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive hover:bg-destructive/20"
        >
          <Square className="h-4 w-4" aria-hidden="true" />{' '}
          {pickByLocale(voiceLocale ?? 'en', S.stop)}
        </button>
      ) : (
        <button
          type="submit"
          aria-label={pickByLocale(voiceLocale ?? 'en', S.sendAria)}
          disabled={busy || disabled}
          className="inline-flex items-center gap-1 rounded-md border border-warning bg-warning-subtle/30 px-3 py-2 text-sm text-warning hover:bg-warning-subtle/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden="true" />{' '}
          {pickByLocale(voiceLocale ?? 'en', S.send)}
        </button>
      )}
    </form>
  );
}
