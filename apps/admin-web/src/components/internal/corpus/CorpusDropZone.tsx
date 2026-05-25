'use client';

import { useRef, useState } from 'react';
import { useUploadCorpus } from '@/lib/internal/queries/corpus';

const ACCEPTED = '.md,.markdown,.txt,.pdf';

interface DragState {
  readonly active: boolean;
}

export function CorpusDropZone({ onUploaded }: { readonly onUploaded?: () => void }): JSX.Element {
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
          onError: (err) => setError(err instanceof Error ? err.message : 'Upload failed'),
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
      <p className="text-sm text-foreground mb-1">Drop markdown dossiers or PDFs here</p>
      <p className="text-xs text-neutral-500 mb-4">
        Files are versioned and routed through the re-ingest pipeline. Existing entries auto-supersede.
      </p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={upload.isPending}
        className="rounded-md bg-signal-500 px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-signal-500/90 disabled:opacity-50"
      >
        {upload.isPending ? 'Uploading…' : 'Pick files'}
      </button>
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
