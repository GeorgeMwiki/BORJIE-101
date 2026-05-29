'use client';

/**
 * OwnerOSDocsPanel — Docs tab. Lists every owner-intake doc, surfaces
 * its category badge + ingestion status, and lets the owner click
 * "Explain" / "Ask" to spawn a brain call scoped to that doc.
 *
 * Wave OWNER-OS.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { FileText, MessageSquare, Sparkles } from 'lucide-react';
import { apiRequest } from '@/lib/api-client';

interface DocRow {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly fileSize: number;
  readonly ingestionStatus: string;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: string;
}

export interface OwnerOSDocsPanelProps {
  readonly languagePreference: 'sw' | 'en';
  readonly initialFocusDocumentId?: string;
  readonly onOpenDoc: (documentId: string, label: string) => void;
}

export function OwnerOSDocsPanel({
  languagePreference,
  initialFocusDocumentId,
  onOpenDoc,
}: OwnerOSDocsPanelProps): ReactElement {
  const [docs, setDocs] = useState<ReadonlyArray<DocRow> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<{
    documentId: string;
    summary: string;
  } | null>(null);
  const [explaining, setExplaining] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest<{ documents: ReadonlyArray<DocRow> }>(
          `/api/v1/owner/docs?limit=50`,
        );
        if (!cancelled) setDocs(res.documents ?? []);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load docs');
          setDocs([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!initialFocusDocumentId || !docs) return;
    const target = docs.find((d) => d.id === initialFocusDocumentId);
    if (target) {
      void explain(target.id);
    }
  }, [initialFocusDocumentId, docs]);

  async function explain(documentId: string): Promise<void> {
    setExplaining(documentId);
    try {
      const res = await apiRequest<{
        documentId: string;
        summary: string;
      }>(`/api/v1/owner/docs/${documentId}/explain`, {
        method: 'POST',
        body: { language: languagePreference },
      });
      setExplanation({ documentId: res.documentId, summary: res.summary });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Explain failed');
    } finally {
      setExplaining(null);
    }
  }

  function categoryOf(d: DocRow): string {
    const v = d.metadata && typeof d.metadata === 'object' ? (d.metadata as Record<string, unknown>).ownerCategory : null;
    return typeof v === 'string' ? v : 'other';
  }

  return (
    <div className="flex flex-col gap-3" data-testid="owner-os-docs-panel">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-warning">
          {languagePreference === 'sw' ? 'Hati zako' : 'Your documents'}
        </h2>
        <span className="text-tiny text-neutral-500">
          {languagePreference === 'sw'
            ? 'Drag-and-drop kwenye Chat ili kuongeza'
            : 'Drag-and-drop on Chat to add'}
        </span>
      </header>

      {error ? (
        <p
          role="alert"
          className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-tiny text-destructive"
        >
          {error}
        </p>
      ) : null}

      {docs === null ? (
        <p className="text-tiny text-neutral-500">Loading…</p>
      ) : docs.length === 0 ? (
        <p className="text-tiny text-neutral-500">
          {languagePreference === 'sw'
            ? 'Hakuna hati bado. Vuta moja kwenye Chat tab.'
            : 'No documents yet. Drop one in the Chat tab.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {docs.map((d) => (
            <li
              key={d.id}
              data-testid={`owner-os-doc-row-${d.id}`}
              className="flex flex-col gap-2 rounded border border-border bg-surface/40 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <FileText aria-hidden="true" className="h-4 w-4 text-warning" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{d.fileName}</p>
                    <p className="truncate text-tiny text-neutral-500">
                      {categoryOf(d)} · {Math.round(d.fileSize / 1024)} KB · {d.ingestionStatus}
                    </p>
                  </div>
                </div>
                <div className="flex flex-shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => onOpenDoc(d.id, d.fileName)}
                    className="inline-flex items-center gap-1 rounded border border-border bg-surface px-2 py-1 text-tiny hover:border-warning"
                  >
                    <MessageSquare aria-hidden="true" className="h-3 w-3" />
                    {languagePreference === 'sw' ? 'Uliza' : 'Ask'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void explain(d.id)}
                    disabled={explaining === d.id}
                    className="inline-flex items-center gap-1 rounded border border-warning/60 bg-warning/10 px-2 py-1 text-tiny font-medium text-warning hover:bg-warning/20 disabled:opacity-50"
                  >
                    <Sparkles aria-hidden="true" className="h-3 w-3" />
                    {explaining === d.id
                      ? languagePreference === 'sw'
                        ? 'Inafikiria…'
                        : 'Thinking…'
                      : languagePreference === 'sw'
                        ? 'Eleza'
                        : 'Explain'}
                  </button>
                </div>
              </div>
              {explanation?.documentId === d.id ? (
                <p
                  data-testid={`owner-os-doc-explain-${d.id}`}
                  className="rounded border border-warning/20 bg-warning/5 px-2 py-1.5 text-xs leading-relaxed text-foreground"
                >
                  {explanation.summary}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
