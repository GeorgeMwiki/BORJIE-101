/**
 * <BorjieMap> — React Native binding.
 *
 * Same surface as the web `BorjieMap` so screens compose against one
 * import-only contract. The native binding does NOT import
 * `react-native` directly — that would explode bundling in non-RN
 * environments (vitest, Next.js owner-web). Instead it accepts an
 * injected `<View>` + `<Text>` host primitives via a tiny adapter
 * pattern (`createBorjieNativeMap`) that consumers seed in their app
 * bootstrap.
 *
 * Companion to:
 *   - packages/borjie-maps/src/react/BorjieMap.tsx
 *   - Docs/RESEARCH/GEO_SOTA_2026-05-29.md §3
 */

import {
  BORJIE_DEFAULT_STYLE_URL,
  boundsOf,
  resolveStyleUrl,
  type BorjieMapProps,
  type BorjieMapStyleConfig,
  type BorjieMapLocale,
} from '../types/index.js';

type ReactComponent<P> = (props: P) => unknown;

export interface BorjieNativeHostPrimitives {
  readonly View: ReactComponent<Record<string, unknown>>;
  readonly Text: ReactComponent<Record<string, unknown>>;
}

const DEFAULT_STYLE: BorjieMapStyleConfig = Object.freeze({
  theme: 'light',
  locale: 'sw',
});

interface BorjieMapHydrateContext {
  readonly props: BorjieMapProps;
  readonly styleConfig: BorjieMapStyleConfig;
  readonly styleUrl: string;
}

type BorjieMapNativeHydrator = (ctx: BorjieMapHydrateContext) => unknown;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace globalThis {
    // eslint-disable-next-line vars-on-top, no-var
    var __borjieMapNativeHydrate: BorjieMapNativeHydrator | undefined;
  }
}

/**
 * Build a React component bound to the given host primitives. Pass
 * `{ View, Text }` from `react-native` in your app bootstrap:
 *
 *   import { View, Text } from 'react-native';
 *   export const BorjieMap = createBorjieNativeMap({ View, Text });
 *
 * The returned component renders a placeholder skeleton; the real
 * MapLibre view mounts via `globalThis.__borjieMapNativeHydrate`.
 */
export function createBorjieNativeMap(host: BorjieNativeHostPrimitives): (
  props: BorjieMapProps,
) => unknown {
  const { View, Text } = host;
  return function BorjieMapNative(props: BorjieMapProps): unknown {
    const locale: BorjieMapLocale =
      props.locale ?? props.style?.locale ?? DEFAULT_STYLE.locale;
    const styleConfig: BorjieMapStyleConfig = {
      ...DEFAULT_STYLE,
      ...(props.style ?? {}),
      locale,
    };
    const styleUrl = resolveStyleUrl(styleConfig);
    const bounds =
      props.fitToBounds ??
      boundsOf(props.markers, props.polygons, props.polylines) ??
      null;

    const hydrate = globalThis.__borjieMapNativeHydrate;
    if (typeof hydrate === 'function') {
      const mounted = hydrate({ props, styleConfig, styleUrl });
      if (mounted) return mounted;
    }

    const swCopy = `Ramani — tovuti ${(props.markers ?? []).length}, mipaka ${(
      props.polygons ?? []
    ).length}.`;
    const enCopy = `Map — ${(props.markers ?? []).length} markers, ${(
      props.polygons ?? []
    ).length} polygons.`;

    return View({
      'data-borjie-map': true,
      'data-borjie-map-theme': styleConfig.theme,
      'data-borjie-map-locale': styleConfig.locale,
      'data-borjie-map-style': styleUrl,
      'data-borjie-map-default-style': BORJIE_DEFAULT_STYLE_URL,
      style: {
        minHeight: 360,
        borderRadius: 12,
        overflow: 'hidden',
        backgroundColor:
          styleConfig.theme === 'dark' ? '#0b1320' : 'rgba(0,0,0,0.04)',
        padding: 16,
        alignItems: 'center',
        justifyContent: 'center',
        ...(props.viewStyle ?? {}),
      },
      children: Text({
        style: { color: styleConfig.theme === 'dark' ? '#f1f5f9' : '#1f2937' },
        children: locale === 'sw' ? swCopy : enCopy,
        'data-borjie-map-bounds': bounds
          ? `${bounds.southWest.lat.toFixed(2)},${bounds.southWest.lng.toFixed(2)}→${bounds.northEast.lat.toFixed(2)},${bounds.northEast.lng.toFixed(2)}`
          : undefined,
      }),
    });
  };
}
