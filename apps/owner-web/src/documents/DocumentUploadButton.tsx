'use client';

import { useRef, useState } from 'react';
import { registerUpload } from './api';
import { ALLOWED_MIMES, validateUpload, type UploadResult } from './types';

export interface DocumentUploadButtonProps {
  /** Surface label override; defaults to bilingual "Pakia hati / Upload". */
  readonly label?: string;
  /** Called once the upload row has been registered server-side. */
  readonly onUploaded?: (result: UploadResult) => void;
  /** Called on validation or network error. */
  readonly onError?: (message: string) => void;
  /** Paperclip variant emits a small icon button; default emits a labelled CTA. */
  readonly variant?: 'paperclip' | 'button';
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
      const message =
        cause instanceof Error ? cause.message : 'Upload failed.';
      onError?.(message);
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
  const resolvedLabel = label ?? 'Pakia hati · Upload document';

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
          <span aria-hidden>{busy ? '…' : '📎'}</span>
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
        <span aria-hidden>📎</span>
        <span>{resolvedLabel}</span>
        {busy ? <span className="ml-1 animate-pulse">…</span> : null}
      </button>
    </>
  );
}
