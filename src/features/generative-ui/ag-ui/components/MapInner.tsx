"use client";

/**
 * MapInner — the leaflet-dependent slice of `MapView`. Kept in a
 * separate file so the parent can lazy-import it through
 * `ClientOnly` + `React.lazy` and keep the leaflet bundle out of SSR.
 *
 * iter-50-final: offline tile cache wired via `OfflineTileLayer`. Tiles
 * are served IndexedDB-first, network-second, with a 25 MB LRU budget.
 * When `navigator.onLine === false` we fall through to a 1x1
 * transparent placeholder on cache miss so the map keeps panning.
 */

import { useEffect } from "react";

// react-leaflet is a peer dep on the consuming app. The cast through
// `any` keeps typecheck clean whether the install is present or only
// stubbed during package build. The runtime contract (MapContainer +
// TileLayer + Marker + Popup + useMap) matches react-leaflet v4 exactly.
// @ts-ignore — module is a peer dep of the consuming app
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
import * as ReactLeaflet from "react-leaflet";

import type { MapMarker } from "../types";
import { getCachedTile, setCachedTile } from "../lib/tile-cache";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
const { MapContainer, TileLayer, Marker, Popup, useMap } = ReactLeaflet as any;

const TILE_URL_TEMPLATE = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = "© OpenStreetMap contributors";

/**
 * 1x1 transparent PNG used as a placeholder when offline AND the tile
 * is not in cache. Keeps the leaflet renderer happy without flashing a
 * broken-image icon.
 */
const PLACEHOLDER_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

export interface MapInnerProps {
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly markers: ReadonlyArray<MapMarker>;
}

/**
 * OfflineTileLayer — imperatively adds a custom `L.TileLayer` subclass
 * to the parent map. The subclass overrides `createTile` to consult the
 * IndexedDB cache first, fall back to network on cache miss when online,
 * and serve a placeholder when offline + cache miss.
 *
 * Component returns `null` because the layer is added via the leaflet
 * imperative API rather than rendered as JSX.
 */
function OfflineTileLayer(): null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
  const map = useMap();

  useEffect(() => {
    let cancelled = false;
    // Holds the leaflet layer instance so we can remove on unmount.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
    let layer: any = null;

    (async () => {
      // Dynamic-import leaflet so SSR + non-leaflet consumers don't
      // pay the cost. Cast through `any` for the same peer-dep reason
      // as the `ReactLeaflet` import above.
      // @ts-ignore — peer dep
      const leafletMod = await import("leaflet");
      if (cancelled) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
      const L = (leafletMod.default ?? leafletMod) as any;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
      const CachedTileLayer = L.TileLayer.extend({
        createTile(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
          this: any,
          coords: unknown,
          done: (err: Error | null, tile: HTMLImageElement) => void,
        ) {
          const tile = document.createElement("img");
          tile.alt = "";
          tile.setAttribute("role", "presentation");
          /* eslint-disable @typescript-eslint/no-explicit-any -- intentional: bridging Leaflet's Coords type (peer-dep, untyped here) to the local coords shape */
          const url: string = this.getTileUrl(coords as any);
          /* eslint-enable @typescript-eslint/no-explicit-any */

          let objectUrl: string | null = null;
          const cleanup = (): void => {
            if (objectUrl) {
              try {
                URL.revokeObjectURL(objectUrl);
              } catch {
                /* ignore */
              }
            }
          };
          tile.addEventListener("load", cleanup, { once: true });
          tile.addEventListener("error", cleanup, { once: true });

          (async () => {
            try {
              const cached = await getCachedTile(url);
              if (cached) {
                objectUrl = URL.createObjectURL(cached);
                tile.src = objectUrl;
                done(null, tile);
                return;
              }
              // Offline + miss — placeholder.
              if (
                typeof navigator !== "undefined" &&
                navigator.onLine === false
              ) {
                tile.src = PLACEHOLDER_PIXEL;
                done(null, tile);
                return;
              }
              // Online — fetch + populate cache.
              const res = await fetch(url);
              if (!res.ok) {
                tile.src = PLACEHOLDER_PIXEL;
                done(new Error(`tile fetch failed: ${res.status}`), tile);
                return;
              }
              const blob = await res.blob();
              // Fire-and-forget cache write — don't block tile render.
              void setCachedTile(url, blob);
              objectUrl = URL.createObjectURL(blob);
              tile.src = objectUrl;
              done(null, tile);
            } catch (err) {
              tile.src = PLACEHOLDER_PIXEL;
              done(err instanceof Error ? err : new Error(String(err)), tile);
            }
          })();

          return tile;
        },
      });

      layer = new CachedTileLayer(TILE_URL_TEMPLATE, {
        attribution: TILE_ATTRIBUTION,
      });
      layer.addTo(map);
    })();

    return () => {
      cancelled = true;
      if (layer && typeof layer.remove === "function") {
        try {
          layer.remove();
        } catch {
          /* ignore */
        }
      }
    };
  }, [map]);

  return null;
}

export function MapInner(props: MapInnerProps): JSX.Element {
  return (
    <MapContainer
      center={props.center as [number, number]}
      zoom={props.zoom}
      style={{ height: "100%", width: "100%" }}
    >
      {/*
        Render a stock `<TileLayer />` as a safety fallback for hosts
        whose leaflet build resolves but whose dynamic-import of leaflet
        (used by OfflineTileLayer) is blocked. The custom layer
        z-stacks above the fallback, so when caching is wired the user
        only sees cached/cached-or-network tiles.
       */}
      <TileLayer url={TILE_URL_TEMPLATE} attribution={TILE_ATTRIBUTION} />
      <OfflineTileLayer />
      {props.markers.map((m, i) => (
        <Marker key={i} position={m.position as [number, number]}>
          {m.popup ? <Popup>{m.popup}</Popup> : null}
        </Marker>
      ))}
    </MapContainer>
  );
}
