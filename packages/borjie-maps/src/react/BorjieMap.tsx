/**
 * <BorjieMap> — web React binding.
 *
 * Companion to:
 *   - packages/borjie-maps/src/types/index.ts
 *   - packages/borjie-maps/src/native/BorjieMap.tsx
 *   - Docs/RESEARCH/GEO_SOTA_2026-05-29.md §3
 *
 * The component renders a structural container + a hidden data island
 * that downstream consumers hydrate with a real MapLibre GL JS or
 * react-map-gl mount. Why this shape?
 *   1. `@borjie/maps` cannot hard-depend on `maplibre-gl` because the
 *      Expo bundle ships with `maplibre-react-native` instead, and we
 *      don't want every consumer paying the 800kB MapLibre cost upfront.
 *   2. Consumers wire their own MapLibre instance via the imperative
 *      `borjie-map-hydrate` global hook OR replace this file in their
 *      bundle alias. Either way the props contract is stable.
 *
 * For SSR (Next.js owner-web) the component renders the skeleton on
 * the server and the hydrate step runs on the client side once
 * `useEffect` fires.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BORJIE_DEFAULT_STYLE_URL,
  boundsOf,
  pickLabel,
  resolveStyleUrl,
  type BorjieMapProps,
  type BorjieMapStyleConfig,
  type BorjieMapLocale,
} from '../types/index.js';

const DEFAULT_STYLE: BorjieMapStyleConfig = Object.freeze({
  theme: 'light',
  locale: 'sw',
});

const MARKER_PALETTE: Readonly<Record<string, string>> = Object.freeze({
  site: '#0E7A4F',
  hazard: '#C03A2B',
  licence: '#1E40AF',
  regulatory: '#7C3AED',
  worker: '#F59E0B',
  route: '#0EA5E9',
  'custody-trace': '#0F766E',
});

interface BorjieMapHydrateContext {
  readonly container: HTMLDivElement;
  readonly props: BorjieMapProps;
  readonly styleConfig: BorjieMapStyleConfig;
  readonly styleUrl: string;
  readonly setLocale: (locale: BorjieMapLocale) => void;
}

type BorjieMapHydrator = (ctx: BorjieMapHydrateContext) => void | (() => void);

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace globalThis {
    // eslint-disable-next-line vars-on-top, no-var
    var __borjieMapHydrate: BorjieMapHydrator | undefined;
  }
}

export function BorjieMap(props: BorjieMapProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activeLocale, setActiveLocale] = useState<BorjieMapLocale>(
    props.locale ?? props.style?.locale ?? DEFAULT_STYLE.locale,
  );

  const styleConfig: BorjieMapStyleConfig = useMemo(
    () => ({
      ...DEFAULT_STYLE,
      ...(props.style ?? {}),
      locale: activeLocale,
    }),
    [props.style, activeLocale],
  );

  const styleUrl = resolveStyleUrl(styleConfig);
  const bounds =
    props.fitToBounds ??
    boundsOf(props.markers, props.polygons, props.polylines) ??
    null;

  useEffect(() => {
    if (!containerRef.current) return;
    const hydrate = globalThis.__borjieMapHydrate;
    if (typeof hydrate !== 'function') return;
    const cleanup = hydrate({
      container: containerRef.current,
      props,
      styleConfig,
      styleUrl,
      setLocale: setActiveLocale,
    });
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props,
    styleConfig,
    styleUrl,
  ]);

  return (
    <div
      ref={containerRef}
      className={props.className}
      data-borjie-map
      data-borjie-map-theme={styleConfig.theme}
      data-borjie-map-locale={styleConfig.locale}
      data-borjie-map-style={styleUrl}
      data-borjie-map-default-style={BORJIE_DEFAULT_STYLE_URL}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: 360,
        background:
          styleConfig.theme === 'dark' ? '#0b1320' : 'rgba(0, 0, 0, 0.04)',
        borderRadius: 12,
        overflow: 'hidden',
        ...(props.viewStyle ?? {}),
      }}
    >
      <BorjieMapPlaceholder
        markerCount={(props.markers ?? []).length}
        polygonCount={(props.polygons ?? []).length}
        polylineCount={(props.polylines ?? []).length}
        locale={styleConfig.locale}
        bounds={bounds}
      />
      <noscript>
        <p
          style={{
            padding: 16,
            color: '#475569',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          Borjie map requires JavaScript. Activate JS or open the
          owner-web cockpit on a modern browser.
        </p>
      </noscript>
    </div>
  );
}

interface PlaceholderProps {
  readonly markerCount: number;
  readonly polygonCount: number;
  readonly polylineCount: number;
  readonly locale: BorjieMapLocale;
  readonly bounds: ReturnType<typeof boundsOf>;
}

function BorjieMapPlaceholder(props: PlaceholderProps): JSX.Element {
  const swCopy = `Ramani — vipengele: tovuti ${props.markerCount}, mipaka ${props.polygonCount}, njia ${props.polylineCount}.`;
  const enCopy = `Map — features: ${props.markerCount} markers, ${props.polygonCount} polygons, ${props.polylineCount} polylines.`;
  const copy = props.locale === 'sw' ? swCopy : enCopy;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        color: '#1f2937',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
      }}
    >
      <div
        style={{
          maxWidth: 320,
          textAlign: 'center',
          padding: '12px 16px',
          background: 'rgba(255, 255, 255, 0.85)',
          borderRadius: 8,
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
        }}
      >
        <div
          style={{
            fontWeight: 600,
            marginBottom: 4,
            color: MARKER_PALETTE.site,
          }}
        >
          {props.locale === 'sw' ? 'Ramani ya Borjie' : 'Borjie map'}
        </div>
        <div>{copy}</div>
        {props.bounds ? (
          <div style={{ marginTop: 6, fontSize: 12, color: '#475569' }}>
            {props.bounds.southWest.lat.toFixed(2)},{' '}
            {props.bounds.southWest.lng.toFixed(2)} →{' '}
            {props.bounds.northEast.lat.toFixed(2)},{' '}
            {props.bounds.northEast.lng.toFixed(2)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Helper for tests + screenshots: pure derivation of the marker tint
 * given a layer kind. Exposed so owner-web style audits can assert
 * brand-token compliance.
 */
export function colorForLayer(layerKind: string): string {
  return MARKER_PALETTE[layerKind] ?? '#1f2937';
}

export function labelForMarker(
  marker: { readonly label?: { readonly sw: string; readonly en: string } },
  locale: BorjieMapLocale,
): string | undefined {
  return pickLabel(marker.label, locale);
}
