'use client';

import { useState } from 'react';
import { Skeleton } from '@borjie/design-system';
import { useDocumentList } from '@/lib/queries/documents';
import { DocumentList } from './DocumentList';
import { PdfPreview } from './PdfPreview';
import { DocChatPane } from './DocChatPane';
import { OpenInChatButton } from '@/components/shared/OpenInChatButton';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import { documentsSurfaceStrings as S } from '@/i18n/strings/documents-surface';

/**
 * Owner document workspace (O-W-04).
 *
 * 3-column layout: list left, PDF + chat centre/right. Compare mode
 * splits the PDF column into two side-by-side panes.
 */
export function DocumentSurface({ initialLocale }: { readonly initialLocale?: Locale }) {
  const locale = useLocale(initialLocale);
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
    return <Skeleton className="h-chart-xl rounded-lg border border-border" />;
  }
  if (!selected) {
    return (
      <ScreenEmptyState
        title={pickByLocale(locale, S.emptyTitle)}
        description={pickByLocale(locale, S.emptyBody)}
      />
    );
  }

  return (
    <div className="grid h-chart-2xl grid-cols-12 gap-4">
      <aside className="col-span-3 overflow-y-auto rounded-lg border border-border bg-surface/40">
        <header className="border-b border-border px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          {pickByLocale(locale, S.documents)} · {documents.length}
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
        <header className="flex items-center justify-between border-b border-border px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
          <span>{pickByLocale(locale, S.chat)} · {selected.title}</span>
          <OpenInChatButton entityRef={`document-${selected.id}`} compact />
        </header>
        <DocChatPane document={selected} onAnchor={setAnchorChunkId} />
      </section>
    </div>
  );
}
