'use client';

import { useState } from 'react';
import { useDocumentList } from '@/lib/queries/documents';
import { DocumentList } from './DocumentList';
import { PdfPreview } from './PdfPreview';
import { DocChatPane } from './DocChatPane';
import { OpenInChatButton } from '@/components/shared/OpenInChatButton';

/**
 * Owner document workspace (O-W-04).
 *
 * 3-column layout: list left, PDF + chat centre/right. Compare mode
 * splits the PDF column into two side-by-side panes.
 */
export function DocumentSurface() {
  const { data, isLoading } = useDocumentList();
  const documents = data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [anchorChunkId, setAnchorChunkId] = useState<string | null>(null);

  const selected =
    documents.find((d) => d.id === selectedId) ?? documents[0] ?? null;
  const comparing = compareId
    ? documents.find((d) => d.id === compareId) ?? null
    : null;

  if (isLoading) {
    return (
      <div className="h-chart-xl animate-pulse rounded-lg border border-border bg-surface/40" />
    );
  }
  if (!selected) {
    return (
      <div className="rounded-lg border border-border bg-surface/40 p-6 text-sm text-neutral-400">
        No documents yet. Upload PMLs, EPP reports, assays and invoices on the
        Onboarding surface to begin.
      </div>
    );
  }

  return (
    <div className="grid h-chart-2xl grid-cols-12 gap-4">
      <aside className="col-span-3 overflow-y-auto rounded-lg border border-border bg-surface/40">
        <header className="border-b border-border px-3 py-2 text-xs uppercase tracking-wide text-neutral-500">
          Documents · {documents.length}
        </header>
        <DocumentList
          documents={documents}
          selectedId={selected.id}
          compareId={compareId}
          onSelect={(id) => {
            setSelectedId(id);
            setAnchorChunkId(null);
          }}
          onToggleCompare={(id) =>
            setCompareId((prev) => (prev === id ? null : id))
          }
        />
      </aside>
      <section
        className={`overflow-hidden rounded-lg border border-border bg-surface/40 ${
          comparing ? 'col-span-6' : 'col-span-6'
        }`}
      >
        {comparing ? (
          <div className="grid h-full grid-cols-2 divide-x divide-border">
            <PdfPreview document={selected} anchorChunkId={anchorChunkId} />
            <PdfPreview document={comparing} anchorChunkId={null} />
          </div>
        ) : (
          <PdfPreview document={selected} anchorChunkId={anchorChunkId} />
        )}
      </section>
      <section className="col-span-3 overflow-hidden rounded-lg border border-border bg-surface/40">
        <header className="flex items-center justify-between border-b border-border px-3 py-2 text-xs uppercase tracking-wide text-neutral-500">
          <span>Chat · {selected.title}</span>
          <OpenInChatButton entityRef={`document-${selected.id}`} compact />
        </header>
        <DocChatPane document={selected} onAnchor={setAnchorChunkId} />
      </section>
    </div>
  );
}
