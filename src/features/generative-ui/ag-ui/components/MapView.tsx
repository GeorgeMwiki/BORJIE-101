"use client";

/**
 * 8. map — react-leaflet + OpenStreetMap.
 *
 * NOT Mapbox — no token cost in TZ + works without auth.
 *
 * Dependencies (peer-dep on the consuming app):
 *   - react-leaflet ^4.2.1
 *   - leaflet ^1.9.4
 *
 * The package targets both Next.js and Vite, so we use `React.lazy` +
 * `ClientOnly` mount guard instead of `next/dynamic`. Leaflet
 * hard-depends on `window`; SSR rendering would crash.
 *
 * iter-50-final: offline tile cache wired in `MapInner` via
 * `OfflineTileLayer` + `lib/tile-cache.ts` (IndexedDB-backed, 25 MB LRU
 * budget). Lets TZ field staff keep inspecting properties through dead
 * zones — tiles loaded online are cached and replayed offline.
 */

import { lazy, Suspense } from "react";

import type { AgUiUiPartByKind } from "../types";
import { Frame, GenUiError } from "./Frame";
import { ClientOnly } from "./ClientOnly";
import { MapPartSchema } from "../schemas";

export type MapViewProps = AgUiUiPartByKind<"map">;

const MapInner = lazy(async () => {
  const m = await import("./MapInner");
  return { default: m.MapInner };
});

export function MapView(props: MapViewProps): JSX.Element {
  const parsed = MapPartSchema.safeParse(props);
  if (!parsed.success) {
    return (
      <GenUiError
        kind="map"
        message={parsed.error.issues.map((i) => i.message).join("; ")}
      />
    );
  }
  return (
    <Frame kind="map" {...(props.title ? { title: props.title } : {})}>
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
            <MapInner
              center={props.center}
              zoom={props.zoom}
              markers={props.markers}
            />
          </Suspense>
        </ClientOnly>
      </div>
    </Frame>
  );
}
