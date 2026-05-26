'use client';

/**
 * PdfInner — react-pdf Document/Page slice. Loaded behind ClientOnly +
 * React.lazy in the parent so the worker URL set-up stays out of SSR.
 *
 * Hardening (Wave 15E): `react-pdf` is loaded via dynamic `import()`
 * inside `useEffect` rather than via a top-level `import`. When this
 * package is bundled with tsup `splitting: false`, a top-level
 * `import 'react-pdf'` collapses into the dist barrel and crashes
 * SSR (pdf.js touches `window` at module load). Loading after mount
 * keeps SSR safe even if the bundler eagerly inlines this module.
 */

import { useEffect, useState, type ComponentType, type ReactNode } from 'react';

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

export interface PdfInnerProps {
  readonly url: string;
}

export function PdfInner({ url }: PdfInnerProps): JSX.Element {
  const [RP, setRP] = useState<ReactPdfShape | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // @ts-ignore — peer dep of the consuming app
        const mod = (await import('react-pdf')) as unknown as ReactPdfShape;
        // react-pdf needs a worker URL. Use the public unpkg CDN by
        // default; admin-portal CSP allows it. Override by setting
        // NEXT_PUBLIC_PDFJS_WORKER_URL (Next.js) or
        // VITE_PDFJS_WORKER_URL (Vite) if a regulated environment
        // forbids CDN script-src.
        if (mod.pdfjs?.GlobalWorkerOptions) {
          const fromProcess =
            typeof process !== 'undefined'
              ? (process.env?.NEXT_PUBLIC_PDFJS_WORKER_URL as string | undefined)
              : undefined;
          mod.pdfjs.GlobalWorkerOptions.workerSrc =
            fromProcess ??
            `https://unpkg.com/pdfjs-dist@${mod.pdfjs.version}/build/pdf.worker.min.js`;
        }
        if (!cancelled) setRP(mod);
      } catch {
        /* peer dep missing — render fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!RP) {
    return <span className="text-xs text-muted-foreground">loading PDF…</span>;
  }

  const { Document, Page } = RP;

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
