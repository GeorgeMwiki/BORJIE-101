'use client';

import { useCallback, useEffect, useState } from 'react';
import { Skeleton } from '@borjie/design-system';
import { DocumentList } from '@/documents/DocumentList';
import { DocumentUploadButton } from '@/documents/DocumentUploadButton';
import { DocumentExplorer } from '@/documents/DocumentExplorer';
import { listDocuments } from '@/documents/api';
import type { UploadedDocument } from '@/documents/types';
import { useLocale, pickByLocale } from '@/lib/locale';
import { EmptyState as ScreenEmptyState } from '@/components/shared/EmptyState';
import { routesAStrings as S } from '@/i18n/strings/routes-a';

/**
 * O-W-DOC-INTEL — "Documents as alive entities" cockpit surface.
 *
 * Two-column workspace: document list (left) + explorer (right). The
 * explorer is the canonical "alive" chat surface bound to a single
 * document.
 *
 * Mounted at /document-intelligence so it lives alongside the existing
 * O-W-04 /documents surface (which is read-only and renders a 3-column
 * doc workspace). The intelligence surface is the upload + chat seat.
 */
export default function DocumentIntelligencePage() {
  const locale = useLocale();
  const [docs, setDocs] = useState<ReadonlyArray<UploadedDocument>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listDocuments(100);
      setDocs(next);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Failed to load.';
      setError(message);
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selected =
    docs.find((d) => d.id === selectedId) ?? docs[0] ?? null;

  return (
    <main id="main-content" className="px-8 py-6">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {pickByLocale(locale, S.documentIntelligence.title)}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {pickByLocale(locale, S.documentIntelligence.subtitle)}
          </p>
        </div>
        <DocumentUploadButton
          locale={locale}
          onUploaded={(result) => {
            setDocs((prev) => [result.document, ...prev]);
            setSelectedId(result.document.id);
          }}
          onError={(message) => setError(message)}
        />
      </header>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <aside className="lg:col-span-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {pickByLocale(locale, S.documentIntelligence.documents)} · {docs.length}
          </h2>
          {loading ? (
            <Skeleton className="h-64 rounded-lg border border-border" />
          ) : (
            <DocumentList
              documents={docs}
              locale={locale}
              onSelect={(doc) => setSelectedId(doc.id)}
            />
          )}
        </aside>
        <section className="lg:col-span-8">
          {selected ? (
            <DocumentExplorer document={selected} locale={locale} />
          ) : (
            <ScreenEmptyState
              title={pickByLocale(locale, S.documentIntelligence.title)}
              description={pickByLocale(locale, S.documentIntelligence.emptyState)}
            />
          )}
        </section>
      </div>
    </main>
  );
}
