"use client";

/**
 * 10. file-preview — inline PDF (via react-pdf) + image preview.
 *
 * Dependencies (peer-dep on the consuming app):
 *   - react-pdf ^9.1.0
 *
 * The package targets both Next.js and Vite, so we use `React.lazy` +
 * `ClientOnly` mount guard instead of `next/dynamic`. react-pdf needs
 * Worker access only available in the browser.
 */

import { lazy, Suspense } from "react";

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { ClientOnly } from "./ClientOnly";
import { FilePreviewPartSchema } from "../schemas";

export type FilePreviewProps = AgUiUiPartByKind<"file-preview">;

const PdfInner = lazy(async () => {
  const m = await import("./PdfInner");
  return { default: m.PdfInner };
});

function isImage(mime: string): boolean {
  return mime.startsWith("image/");
}

function isPdf(mime: string): boolean {
  return mime === "application/pdf";
}

export function FilePreview(props: FilePreviewProps): JSX.Element {
  const parsed = FilePreviewPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="file-preview"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }
  const title = props.title ?? props.name;

  if (isImage(props.mimeType)) {
    return (
      <Frame kind="file-preview" title={title}>
        {/* eslint-disable-next-line @next/next/no-img-element -- intentional plain `<img>`: the source URL is a dynamic AG-UI file URL not known at build time, so next/image's required-domain config does not apply */}
        <img
          src={props.url}
          alt={props.name}
          className="max-w-full rounded border border-border"
        />
        <div className="mt-1 text-[11px] text-muted-foreground">
          {props.name} · {props.mimeType}
          {props.sizeBytes ? ` · ${Math.round(props.sizeBytes / 1024)} KB` : ""}
        </div>
      </Frame>
    );
  }

  if (isPdf(props.mimeType)) {
    return (
      <Frame kind="file-preview" title={title}>
        <ClientOnly
          fallback={
            <span className="text-xs text-muted-foreground">loading PDF…</span>
          }
        >
          <Suspense
            fallback={
              <span className="text-xs text-muted-foreground">
                loading PDF…
              </span>
            }
          >
            <PdfInner url={props.url} />
          </Suspense>
        </ClientOnly>
        <div className="mt-1 text-[11px] text-muted-foreground">
          <a
            href={props.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-foreground"
          >
            {props.name}
          </a>
          {props.sizeBytes ? ` · ${Math.round(props.sizeBytes / 1024)} KB` : ""}
        </div>
      </Frame>
    );
  }

  return (
    <Frame kind="file-preview" title={title}>
      <a
        href={props.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs underline text-foreground"
      >
        {props.name}
      </a>
      <div className="text-[11px] text-muted-foreground">
        {props.mimeType}
        {props.sizeBytes ? ` · ${Math.round(props.sizeBytes / 1024)} KB` : ""}
      </div>
    </Frame>
  );
}
