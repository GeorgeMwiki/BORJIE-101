'use client';

import type { DocumentRecord } from '@/lib/types/documents';
import { fmtDate } from '@/lib/format';

interface DocumentListProps {
  readonly documents: ReadonlyArray<DocumentRecord>;
  readonly selectedId: string | null;
  readonly compareId: string | null;
  readonly onSelect: (id: string) => void;
  readonly onToggleCompare: (id: string) => void;
}

const TYPE_PILL: Record<DocumentRecord['type'], string> = {
  PML: 'border-warning/40 text-warning',
  EPP: 'border-success/40 text-success',
  assay: 'border-info/40 text-info',
  invoice: 'border-border text-neutral-300',
  MoU: 'border-border text-neutral-300',
  audit: 'border-destructive/40 text-destructive',
};

/**
 * Searchable document list. Click → select for the PDF/chat panes;
 * shift-click (or compare button) → set as comparison target so the
 * surface flips into side-by-side mode.
 */
export function DocumentList({
  documents,
  selectedId,
  compareId,
  onSelect,
  onToggleCompare,
}: DocumentListProps) {
  return (
    <ul className="divide-y divide-border">
      {documents.map((doc) => {
        const isSelected = doc.id === selectedId;
        const isCompare = doc.id === compareId;
        return (
          <li key={doc.id}>
            <div
              className={`flex items-start gap-2 px-3 py-2 text-sm ${
                isSelected ? 'bg-warning-subtle/10' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(doc.id)}
                className="flex-1 text-left"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`pill border ${TYPE_PILL[doc.type]} px-1.5 py-0`}
                  >
                    {doc.type}
                  </span>
                  <span className="font-medium text-foreground">
                    {doc.title}
                  </span>
                </div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  {doc.mineral} · {doc.pages}p · uploaded {fmtDate(doc.uploadedAt)}
                </div>
              </button>
              <button
                type="button"
                onClick={() => onToggleCompare(doc.id)}
                className={`rounded-md border px-2 py-0.5 text-[10px] ${
                  isCompare
                    ? 'border-warning text-warning'
                    : 'border-border text-neutral-400 hover:text-foreground'
                }`}
              >
                {isCompare ? 'comparing' : 'compare'}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
