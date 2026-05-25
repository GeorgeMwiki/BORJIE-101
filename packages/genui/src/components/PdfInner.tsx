'use client';

/**
 * PdfInner — react-pdf Document/Page slice. Loaded behind ClientOnly +
 * React.lazy in the parent so the worker URL set-up stays out of SSR.
 */

import { useState, type ComponentType, type ReactNode } from 'react';
// @ts-ignore — module is a peer dep of the consuming app
import * as ReactPdf from 'react-pdf';

interface PdfjsGlobalWorkerOptions {
  workerSrc: string;
}
interface PdfjsLike {
  readonly version: string;
  readonly GlobalWorkerOptions?: PdfjsGlobalWorkerOptions;
}
interface ReactPdfShape {
  readonly Document: ComponentType<{
    readonly file: string;
    readonly onLoadSuccess?: (pdf: { readonly numPages: number }) => void;
    readonly loading?: ReactNode;
    readonly children?: ReactNode;
  }>;
  readonly Page: ComponentType<{
    readonly pageNumber: number;
    readonly width?: number;
  }>;
  readonly pdfjs: PdfjsLike;
}

const { Document, Page, pdfjs } = ReactPdf as unknown as ReactPdfShape;

// react-pdf needs a worker URL. Use the public unpkg CDN by default;
// admin-portal CSP allows it. Override by setting
// `NEXT_PUBLIC_PDFJS_WORKER_URL` (Next.js) or `VITE_PDFJS_WORKER_URL`
// (Vite) if a regulated environment forbids CDN script-src.
if (pdfjs?.GlobalWorkerOptions) {
  const fromProcess =
    typeof process !== 'undefined'
      ? (process.env?.NEXT_PUBLIC_PDFJS_WORKER_URL as string | undefined)
      : undefined;
  // import.meta is awkward in tsup CJS output; the host bundler (Next /
  // Vite) inlines NEXT_PUBLIC_*/VITE_* env vars itself, so the fallback
  // path is the unpkg CDN.
  pdfjs.GlobalWorkerOptions.workerSrc =
    fromProcess ??
    `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;
}

export interface PdfInnerProps {
  readonly url: string;
}

export function PdfInner({ url }: PdfInnerProps): JSX.Element {
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState<number | null>(null);

  return (
    <div className="text-xs">
      <Document
        file={url}
        onLoadSuccess={(pdf) => setPages(pdf.numPages)}
        loading={<span>loading PDF…</span>}
      >
        <Page pageNumber={page} width={520} />
      </Document>
      {pages && pages > 1 ? (
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-border bg-surface px-2 py-0.5"
          >
            ◀
          </button>
          <span>
            {page} / {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
            className="rounded border border-border bg-surface px-2 py-0.5"
          >
            ▶
          </button>
        </div>
      ) : null}
    </div>
  );
}
