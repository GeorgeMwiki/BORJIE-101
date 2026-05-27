'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Send, Square } from 'lucide-react';

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
}

/**
 * Composer at the bottom of the ask-Borjie surface. Zod-validated via
 * react-hook-form so blank submits are blocked and overlong prompts
 * fail fast. Enter sends; Shift+Enter inserts a newline.
 *
 * Disabled state (e.g. when the gateway env var is missing) renders
 * the textarea as read-only and the send button as inactive — no
 * silent failures, no mock fallback.
 */
export function AskComposer({
  onSubmit,
  onAbort,
  busy,
  disabled,
}: AskComposerProps) {
  const {
    register,
    handleSubmit,
    reset,
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
