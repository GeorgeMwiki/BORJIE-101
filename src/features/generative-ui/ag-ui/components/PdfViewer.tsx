"use client";

/**
 * 23. pdf-viewer — full PDF viewer (vs the preview-only file-preview).
 *
 * Reuses the existing `PdfInner` lazy wrapper around `react-pdf` (a peer
 * dep of the consuming portal). Adds explicit pan/zoom controls and an
 * annotate toggle that emits a `genui:pdf-annotate` CustomEvent so the
 * host portal can layer its own annotation surface on top. When
 * react-pdf is not installed (e.g. lightweight CI builds) the component
 * gracefully degrades to a link with metadata, mirroring
 * `FilePreview`'s fallback.
 */

import { lazy, Suspense, useState } from "react";

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { ClientOnly } from "./ClientOnly";
import { PdfViewerPartSchema } from "../schemas";

export type PdfViewerProps = AgUiUiPartByKind<"pdf-viewer">;

const PdfInner = lazy(async () => {
  const m = await import("./PdfInner");
  return { default: m.PdfInner };
});

function dispatchAnnotate(url: string): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(
      new CustomEvent("genui:pdf-annotate", { detail: { url } }),
    );
  } catch {
    /* ignore */
  }
}

export function PdfViewer(props: PdfViewerProps): JSX.Element {
  const [zoom, setZoom] = useState(1);
  const parsed = PdfViewerPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="pdf-viewer"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }

  const title = props.title ?? props.name;
  return (
    <Frame kind="pdf-viewer" title={title}>
      <div className="mb-2 flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
          className="rounded border border-border bg-surface px-2 py-0.5"
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
          className="rounded border border-border bg-surface px-2 py-0.5"
          aria-label="Zoom in"
        >
          +
        </button>
        {props.allowAnnotate ? (
          <button
            type="button"
            onClick={() => dispatchAnnotate(props.url)}
            className="ml-auto rounded border border-border bg-surface px-2 py-0.5"
          >
            Annotate
          </button>
        ) : null}
        <a
          href={props.url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-border bg-surface px-2 py-0.5 underline"
        >
          Open
        </a>
      </div>
      <div
        className="overflow-auto rounded border border-border bg-surface-sunken"
        style={{ maxHeight: 600 }}
      >
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
            width: "fit-content",
          }}
        >
          <ClientOnly
            fallback={
              <span className="block p-3 text-xs text-muted-foreground">
                loading PDF…
              </span>
            }
          >
            <Suspense
              fallback={
                <span className="block p-3 text-xs text-muted-foreground">
                  loading PDF…
                </span>
              }
            >
              <PdfInner url={props.url} />
            </Suspense>
          </ClientOnly>
        </div>
      </div>
    </Frame>
  );
}
