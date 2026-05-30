"use client";

/**
 * 31. geo-fence — drawable map for defining an alert zone.
 *
 * Reuses the same react-leaflet peer-dep MapView depends on. Click on
 * the map to drop fence vertices when `editable=true`; the leaflet
 * Polygon connects them. The inner slice is loaded behind ClientOnly +
 * React.lazy so leaflet stays out of SSR.
 */

import { lazy, Suspense } from "react";

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { ClientOnly } from "./ClientOnly";
import { GeoFencePartSchema } from "../schemas";

export type GeoFenceProps = AgUiUiPartByKind<"geo-fence">;

const GeoFenceInner = lazy(async () => {
  const m = await import("./GeoFenceInner");
  return { default: m.GeoFenceInner };
});

export function GeoFence(props: GeoFenceProps): JSX.Element {
  const parsed = GeoFencePartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="geo-fence"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }
  return (
    <Frame kind="geo-fence" {...(props.title ? { title: props.title } : {})}>
      <div className="w-full" style={{ height: 320 }}>
        <ClientOnly
          fallback={
            <span className="text-xs text-muted-foreground">loading map…</span>
          }
        >
          <Suspense
            fallback={
              <span className="text-xs text-muted-foreground">
                loading map…
              </span>
            }
          >
            <GeoFenceInner
              center={props.center}
              zoom={props.zoom}
              fence={props.fence ?? []}
              editable={Boolean(props.editable)}
              onChangeAction={props.onChangeAction}
            />
          </Suspense>
        </ClientOnly>
      </div>
      {props.editable ? (
        <div className="mt-1 text-[10px] text-muted-foreground">
          Click on the map to drop fence vertices.
        </div>
      ) : null}
    </Frame>
  );
}
