'use client';

import { useEffect, useState } from 'react';
import type { DocumentRecord, DocumentChunk } from '@/lib/mocks/documents';

interface PdfPreviewProps {
  readonly document: DocumentRecord;
  readonly anchorChunkId: string | null;
}

/**
 * PDF preview pane.
 *
 * If the document carries a real URL, mount react-pdf via a dynamic
 * import (kept lazy because react-pdf ships a worker that should not
 * pre-load during SSR). Otherwise render a synthetic page surface
 * with the extracted chunks and bbox overlays so the chat citations
 * still highlight a specific paragraph.
 */
export function PdfPreview({ document, anchorChunkId }: PdfPreviewProps) {
  const [pdfModule, setPdfModule] = useState<typeof import('react-pdf') | null>(
    null,
  );

  useEffect(() => {
    if (!document.url) return;
    let cancelled = false;
    void (async () => {
      try {
        const mod = await import('react-pdf');
        if (!cancelled) setPdfModule(mod);
      } catch {
        if (!cancelled) setPdfModule(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [document.url]);

  if (document.url && pdfModule) {
    const { Document, Page } = pdfModule;
    return (
      <div className="h-full overflow-y-auto bg-background p-4">
        <Document file={document.url}>
          {Array.from({ length: Math.min(document.pages, 4) }).map((_, i) => (
            <Page key={i} pageNumber={i + 1} width={520} />
          ))}
        </Document>
      </div>
    );
  }

  return <SyntheticPdf document={document} anchorChunkId={anchorChunkId} />;
}

function SyntheticPdf({
  document,
  anchorChunkId,
}: {
  readonly document: DocumentRecord;
  readonly anchorChunkId: string | null;
}) {
  return (
    <div className="h-full overflow-y-auto bg-background p-6">
      <div className="mx-auto max-w-md space-y-6">
        {Array.from({ length: document.pages }).map((_, i) => {
          const page = i + 1;
          const pageChunks = document.chunks.filter((c) => c.page === page);
          return (
            <article
              key={page}
              className="relative aspect-[3/4] w-full rounded-md border border-border bg-surface p-4 text-[10px] text-neutral-400"
            >
              <div className="absolute right-2 top-2 text-[9px] text-neutral-500">
                page {page} of {document.pages}
              </div>
              <h3 className="mb-2 font-display text-sm text-foreground">
                {document.title}
              </h3>
              {pageChunks.map((chunk) => (
                <ChunkPara
                  key={chunk.id}
                  chunk={chunk}
                  highlighted={chunk.id === anchorChunkId}
                />
              ))}
              {pageChunks.length === 0 ? (
                <p className="italic text-neutral-500">
                  [page body — no extracted chunks shown for the preview]
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ChunkPara({
  chunk,
  highlighted,
}: {
  readonly chunk: DocumentChunk;
  readonly highlighted: boolean;
}) {
  return (
    <p
      className={`mt-2 rounded px-1 py-0.5 ${
        highlighted
          ? 'bg-warning-subtle/30 ring-1 ring-warning'
          : 'bg-transparent'
      }`}
    >
      <span className="text-neutral-300">{chunk.text}</span>
    </p>
  );
}
