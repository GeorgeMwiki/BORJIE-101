'use client';

import { useRef, useState } from 'react';
import { Button } from '@borjie/design-system';
import { useUploadCorpus } from '@/lib/internal/queries/corpus';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

const ACCEPTED = '.md,.markdown,.txt,.pdf';

const S = {
  prompt: { en: 'Drop markdown dossiers or PDFs here', sw: 'Dondosha majalada ya markdown au PDF hapa' },
  hint: {
    en: 'Files are versioned and routed through the re-ingest pipeline. Existing entries auto-supersede.',
    sw: 'Faili huwekewa matoleo na kupitishwa kwenye mfumo wa uingizaji upya. Maingizo yaliyopo hubadilishwa kiotomatiki.',
  },
  uploading: { en: 'Uploading…', sw: 'Inapakia…' },
  pick: { en: 'Pick files', sw: 'Chagua faili' },
  uploadFailed: { en: 'Upload failed', sw: 'Upakiaji umeshindwa' },
} as const;

interface DragState {
  readonly active: boolean;
}

export function CorpusDropZone({
  onUploaded,
  initialLocale,
}: {
  readonly onUploaded?: () => void;
  readonly initialLocale?: Locale;
}): JSX.Element {
  const locale = useLocale(initialLocale);
  const upload = useUploadCorpus();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [drag, setDrag] = useState<DragState>({ active: false });
  const [error, setError] = useState<string | null>(null);

  const accept = (files: FileList | null): void => {
    setError(null);
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      upload.mutate(
        { name: file.name, bytes: file.size },
        {
          onSuccess: () => onUploaded?.(),
          onError: (err) =>
            setError(err instanceof Error ? err.message : pickByLocale(locale, S.uploadFailed)),
        }
      );
    });
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!drag.active) setDrag({ active: true });
      }}
      onDragLeave={() => setDrag({ active: false })}
      onDrop={(e) => {
        e.preventDefault();
        setDrag({ active: false });
        accept(e.dataTransfer.files);
      }}
      className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
        drag.active
          ? 'border-signal-500 bg-signal-500/10'
          : 'border-border bg-surface-sunken hover:border-signal-500/40'
      }`}
    >
      <p className="text-sm text-foreground mb-1">{pickByLocale(locale, S.prompt)}</p>
      <p className="text-xs text-muted-foreground mb-4">{pickByLocale(locale, S.hint)}</p>
      <Button
        type="button"
        size="sm"
        onClick={() => inputRef.current?.click()}
        loading={upload.isPending}
        disabled={upload.isPending}
      >
        {upload.isPending ? pickByLocale(locale, S.uploading) : pickByLocale(locale, S.pick)}
      </Button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED}
        className="hidden"
        onChange={(e) => accept(e.target.files)}
      />
      {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
