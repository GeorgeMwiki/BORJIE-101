"use client";

/**
 * 21. image-annotation — image + overlay markers.
 *
 * Markers are placed at normalised x/y in [0,1]. Hover shows the
 * label tooltip. Used for inspection-photo findings + AXTree overlays.
 */

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { ImageAnnotationPartSchema } from "../schemas";

export type ImageAnnotationProps = AgUiUiPartByKind<"image-annotation">;

const SEVERITY_RING: Record<string, string> = {
  info: "bg-blue-500 ring-blue-500/40",
  warning: "bg-yellow-500 ring-yellow-500/40",
  critical: "bg-red-500 ring-red-500/40",
};

export function ImageAnnotation(props: ImageAnnotationProps): JSX.Element {
  const parsed = ImageAnnotationPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="image-annotation"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }
  return (
    <Frame
      kind="image-annotation"
      {...(props.title ? { title: props.title } : {})}
    >
      <div className="relative inline-block max-w-full">
        {/* eslint-disable-next-line @next/next/no-img-element -- intentional plain `<img>`: the source URL is a dynamic AG-UI image not known at build time, so next/image's required-domain config does not apply */}
        <img
          src={props.imageUrl}
          alt={props.title ?? "annotated image"}
          className="block max-w-full rounded border border-border"
        />
        {props.annotations.map((a, i) => (
          <span
            key={i}
            title={a.label}
            className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-4 ${
              SEVERITY_RING[a.severity] ?? SEVERITY_RING.info
            }`}
            style={{
              left: `${(a.x * 100).toFixed(2)}%`,
              top: `${(a.y * 100).toFixed(2)}%`,
            }}
            data-genui-annotation-severity={a.severity}
            aria-label={a.label}
          />
        ))}
      </div>
      {props.annotations.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-[11px] text-muted-foreground">
          {props.annotations.map((a, i) => (
            <li key={i} data-genui-annotation-severity={a.severity}>
              <span className="text-foreground">{a.label}</span>
              <span className="ml-1 text-muted-foreground">· {a.severity}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Frame>
  );
}
