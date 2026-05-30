"use client";

/**
 * Map renderer. Tries mapbox-gl when `NEXT_PUBLIC_MAPBOX_TOKEN` is set;
 * falls back to react-leaflet when leaflet is available; falls back to a
 * lightweight SVG-projected schematic otherwise. All three paths render
 * the same marker set.
 */

import { useEffect, useRef, useState } from "react";
import type { MapSpec } from "@/core/brain/generative-ui/types";
import { SourceTrail } from "./SourceTrail";
import { tryOptionalImport } from "./_shared";

interface Props {
  spec: MapSpec;
}

type MapMode = "mapbox" | "leaflet" | "svg-fallback";

export default function MapMapbox({ spec }: Props) {
  const ariaLabel =
    spec.ariaLabel ??
    `Map centered at ${spec.center[0]}, ${spec.center[1]} with ${spec.markers?.length ?? 0} markers`;

  const [mode, setMode] = useState<MapMode>("svg-fallback");
  const [LeafletComponents, setLeafletComponents] = useState<{
    MapContainer: React.ComponentType<unknown>;
    TileLayer: React.ComponentType<unknown>;
    Marker: React.ComponentType<unknown>;
    Popup: React.ComponentType<unknown>;
  } | null>(null);

  const mapboxToken =
    typeof process !== "undefined"
      ? (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "")
      : "";

  useEffect(() => {
    let cancelled = false;
    if (mapboxToken) {
      tryOptionalImport("mapbox-gl").then((mod) => {
        if (mod && !cancelled) {
          setMode("mapbox");
        } else {
          void loadLeaflet();
        }
      });
    } else {
      void loadLeaflet();
    }

    async function loadLeaflet() {
      const mod = await tryOptionalImport<{
        MapContainer?: React.ComponentType<unknown>;
        TileLayer?: React.ComponentType<unknown>;
        Marker?: React.ComponentType<unknown>;
        Popup?: React.ComponentType<unknown>;
      }>("react-leaflet");
      if (cancelled || !mod) return;
      if (mod.MapContainer && mod.TileLayer && mod.Marker && mod.Popup) {
        setLeafletComponents({
          MapContainer: mod.MapContainer,
          TileLayer: mod.TileLayer,
          Marker: mod.Marker,
          Popup: mod.Popup,
        });
        setMode("leaflet");
      }
    }

    return () => {
      cancelled = true;
    };
  }, [mapboxToken]);

  return (
    <figure
      role="figure"
      aria-label={ariaLabel}
      className="my-3 rounded-lg border border-slate-200 bg-white p-4"
    >
      {spec.title ? (
        <figcaption className="mb-2 text-sm font-medium text-slate-800">
          {spec.title}
        </figcaption>
      ) : null}
      {mode === "mapbox" ? (
        <MapboxView spec={spec} token={mapboxToken} />
      ) : mode === "leaflet" && LeafletComponents ? (
        <LeafletView spec={spec} components={LeafletComponents} />
      ) : (
        <SvgFallback spec={spec} />
      )}
      <MarkerList spec={spec} />
      <SourceTrail {...(spec.source ?? {})} />
    </figure>
  );
}

function MapboxView({ spec, token }: { spec: MapSpec; token: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let map: { remove: () => void } | null = null;
    tryOptionalImport<{ default?: unknown } & Record<string, unknown>>(
      "mapbox-gl",
    ).then((mod) => {
      if (!mod || !ref.current) return;
      type MapboxMarker = {
        setLngLat: (ll: [number, number]) => MapboxMarker;
        addTo: (m: unknown) => MapboxMarker;
      };
      type MapboxNs = {
        accessToken: string;
        Map: new (cfg: Record<string, unknown>) => {
          remove: () => void;
          on: (ev: string, cb: () => void) => void;
        };
        Marker: new () => MapboxMarker;
      };
      const mapbox: MapboxNs = (mod.default ?? mod) as MapboxNs;
      mapbox.accessToken = token;
      const instance = new mapbox.Map({
        container: ref.current,
        style: "mapbox://styles/mapbox/light-v11",
        center: [spec.center[1], spec.center[0]],
        zoom: spec.zoom,
      });
      instance.on("load", () => {
        (spec.markers ?? []).forEach((m) => {
          new mapbox.Marker().setLngLat([m.lng, m.lat]).addTo(instance);
        });
      });
      map = instance;
    });
    return () => {
      map?.remove();
    };
  }, [spec, token]);
  return <div ref={ref} style={{ height: 320, width: "100%" }} />;
}

function LeafletView({
  spec,
  components,
}: {
  spec: MapSpec;
  components: {
    MapContainer: React.ComponentType<unknown>;
    TileLayer: React.ComponentType<unknown>;
    Marker: React.ComponentType<unknown>;
    Popup: React.ComponentType<unknown>;
  };
}) {
  const { MapContainer, TileLayer, Marker, Popup } = components;
  const MC = MapContainer as unknown as React.ComponentType<{
    center: [number, number];
    zoom: number;
    style?: React.CSSProperties;
    children?: React.ReactNode;
  }>;
  const TL = TileLayer as unknown as React.ComponentType<{
    attribution: string;
    url: string;
  }>;
  const MK = Marker as unknown as React.ComponentType<{
    position: [number, number];
    children?: React.ReactNode;
  }>;
  const PP = Popup as unknown as React.ComponentType<{
    children?: React.ReactNode;
  }>;
  return (
    <MC
      center={spec.center}
      zoom={spec.zoom}
      style={{ height: 320, width: "100%" }}
    >
      <TL
        attribution="&copy; OpenStreetMap"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {(spec.markers ?? []).map((m, idx) => (
        <MK key={`mk-${idx}`} position={[m.lat, m.lng]}>
          {m.label ? <PP>{m.label}</PP> : null}
        </MK>
      ))}
    </MC>
  );
}

function SvgFallback({ spec }: { spec: MapSpec }) {
  const markers = spec.markers ?? [];
  const lats = markers.map((m) => m.lat).concat(spec.center[0]);
  const lngs = markers.map((m) => m.lng).concat(spec.center[1]);
  const minLat = Math.min(...lats) - 0.5;
  const maxLat = Math.max(...lats) + 0.5;
  const minLng = Math.min(...lngs) - 0.5;
  const maxLng = Math.max(...lngs) + 0.5;
  const project = (lat: number, lng: number) => ({
    x: ((lng - minLng) / Math.max(0.001, maxLng - minLng)) * 600,
    y: 240 - ((lat - minLat) / Math.max(0.001, maxLat - minLat)) * 240,
  });
  return (
    <svg
      viewBox="0 0 600 240"
      role="img"
      aria-hidden
      className="h-60 w-full rounded border border-slate-200 bg-slate-50"
    >
      {markers.map((m, idx) => {
        const p = project(m.lat, m.lng);
        return (
          <circle key={`pt-${idx}`} cx={p.x} cy={p.y} r={4} fill="#2563eb" />
        );
      })}
      {(() => {
        const c = project(spec.center[0], spec.center[1]);
        return (
          <circle
            cx={c.x}
            cy={c.y}
            r={6}
            fill="none"
            stroke="#dc2626"
            strokeWidth={2}
          />
        );
      })()}
    </svg>
  );
}

function MarkerList({ spec }: { spec: MapSpec }) {
  if (!spec.markers || spec.markers.length === 0) return null;
  return (
    <details className="mt-2 text-xs text-slate-500">
      <summary className="cursor-pointer">
        Marker list ({spec.markers.length})
      </summary>
      <ul className="mt-1 list-disc pl-5">
        {spec.markers.slice(0, 200).map((m, idx) => (
          <li key={`ml-${idx}`}>
            {m.label ?? "(unnamed)"} - {m.lat.toFixed(3)}, {m.lng.toFixed(3)}
            {m.kind ? ` (${m.kind})` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}
