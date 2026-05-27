'use client';

import { ingestionStatusLabel, kindLabel, type UploadedDocument } from './types';

export interface DocumentListProps {
  readonly documents: ReadonlyArray<UploadedDocument>;
  readonly onSelect?: (doc: UploadedDocument) => void;
}

export function DocumentList({ documents, onSelect }: DocumentListProps) {
  if (documents.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-surface/40 p-8 text-center">
        <p className="text-base font-semibold text-foreground">Hakuna hati bado</p>
        <p className="mt-1 text-sm text-neutral-400">
          Pakia mkataba, zabuni au barua kuanza mazungumzo na hati hizo.
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-label="Uploaded documents">
      {documents.map((doc) => (
        <li key={doc.id}>
          <button
            type="button"
            onClick={() => onSelect?.(doc)}
            aria-label={`Open document ${doc.fileName}`}
            className="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-4 py-3 text-left transition hover:bg-surface/80"
          >
            <span className="flex flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-foreground">
                {doc.fileName}
              </span>
              <span className="mt-1 flex flex-wrap gap-2">
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground">
                  {kindLabel(doc.kind)}
                </span>
                <span
                  className={
                    'rounded-full border px-2 py-0.5 text-xs text-foreground ' +
                    (doc.ingestionStatus === 'ready'
                      ? 'border-success bg-success/10'
                      : doc.ingestionStatus === 'failed'
                        ? 'border-destructive bg-destructive/10'
                        : 'border-border bg-background')
                  }
                >
                  {ingestionStatusLabel(doc.ingestionStatus)}
                </span>
              </span>
            </span>
            <time className="text-xs text-neutral-400">{formatShortDate(doc.createdAt)}</time>
          </button>
        </li>
      ))}
    </ul>
  );
}

function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  } catch {
    return '';
  }
}
