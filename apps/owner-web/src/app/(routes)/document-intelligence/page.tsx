'use client';

import { useCallback, useEffect, useState } from 'react';
import { DocumentList } from '@/documents/DocumentList';
import { DocumentUploadButton } from '@/documents/DocumentUploadButton';
import { DocumentExplorer } from '@/documents/DocumentExplorer';
import { listDocuments } from '@/documents/api';
import type { UploadedDocument } from '@/documents/types';

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
          <h1 className="text-2xl font-bold text-foreground">Hati hai · Living documents</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Pakia mkataba, zabuni au barua. Brain itazungumza nazo kama vyombo hai.
          </p>
        </div>
        <DocumentUploadButton
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
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Documents · {docs.length}
          </h2>
          {loading ? (
            <div className="h-64 animate-pulse rounded-lg border border-border bg-surface/40" />
          ) : (
            <DocumentList
              documents={docs}
              onSelect={(doc) => setSelectedId(doc.id)}
            />
          )}
        </aside>
        <section className="lg:col-span-8">
          {selected ? (
            <DocumentExplorer document={selected} />
          ) : (
            <div className="rounded-lg border border-border bg-surface/40 p-8 text-center text-sm text-neutral-400">
              Chagua hati au pakia mpya kuanza.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
