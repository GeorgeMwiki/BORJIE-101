'use client';

import { useRef, useState } from 'react';
import { Paperclip, Loader2 } from 'lucide-react';
import { registerUpload } from './api';
import { ALLOWED_MIMES, validateUpload, type UploadResult } from './types';
import type { Locale } from '@/lib/locale-shared';
import { DEFAULT_LOCALE } from '@/lib/locale-shared';
import { localizeError } from '@/lib/api-client';
import { tailStrings as S } from '@/i18n/strings/tail';

export interface DocumentUploadButtonProps {
  /** Surface label override; defaults to the locale-strict "Upload document". */
  readonly label?: string;
  /** Called once the upload row has been registered server-side. */
  readonly onUploaded?: (result: UploadResult) => void;
  /** Called on validation or network error. */
  readonly onError?: (message: string) => void;
  /** Paperclip variant emits a small icon button; default emits a labelled CTA. */
  readonly variant?: 'paperclip' | 'button';
  /** Active owner locale — drives strict EN/SW rendering (no mixing). */
  readonly locale?: Locale;
}

/**
 * DocumentUploadButton (owner-web).
 *
 * Browser-native File API: hidden <input type="file"> + a labelled
 * button. Validates mime + size client-side, then POSTs to
 * /api/v1/mining/document-intelligence/upload. The chat composer
 * (CH-* surfaces) renders this as the paperclip; the Documents page
 * renders it as the primary CTA.
 */
export function DocumentUploadButton({
  label,
  onUploaded,
  onError,
  variant = 'button',
  locale = DEFAULT_LOCALE,
}: DocumentUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handleChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = event.target.files?.[0] ?? null;
    if (!file || busy) {
      return;
    }
    setBusy(true);
    try {
      const validation = validateUpload({
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      });
      if (!validation.ok) {
        onError?.(validation.message);
        return;
      }
      const result = await registerUpload({
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      });
      onUploaded?.(result);
    } catch (cause) {
      // Localize the gateway error by its stable CODE — never the raw English
      // `.message` (rendering that under `sw` is language MIXING).
      onError?.(localizeError(cause, locale));
    } finally {
      setBusy(false);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  }

  function handleClick(): void {
    inputRef.current?.click();
  }

  const accept = ALLOWED_MIMES.join(',');
  const resolvedLabel = label ?? S.documentUploadButton.defaultLabel[locale];

  if (variant === 'paperclip') {
    return (
      <>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={handleChange}
          className="hidden"
          aria-hidden
          tabIndex={-1}
        />
        <button
          type="button"
          aria-label={resolvedLabel}
          aria-busy={busy}
          disabled={busy}
          onClick={handleClick}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-foreground transition hover:bg-surface/80 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Paperclip className="h-4 w-4" aria-hidden />
          )}
        </button>
      </>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleChange}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />
      <button
        type="button"
        aria-label={resolvedLabel}
        aria-busy={busy}
        disabled={busy}
        onClick={handleClick}
        className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-sm font-semibold text-background transition hover:bg-foreground/90 disabled:opacity-50"
      >
        <Paperclip className="h-4 w-4" aria-hidden />
        <span>{resolvedLabel}</span>
        {busy ? (
          <Loader2 className="ml-1 h-4 w-4 animate-spin" aria-hidden />
        ) : null}
      </button>
    </>
  );
}
