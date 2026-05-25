/**
 * @borjie/spatial-engine/react — client-only React surface.
 *
 * Import from `@borjie/spatial-engine/react` (NOT the root
 * entrypoint) when you need ParcelMap or ElementInspector. The root
 * is pure-logic only so Node consumers without a JSX toolchain build
 * cleanly.
 *
 * Next.js consumers MUST mark the importing file `'use client'` or
 * load via `dynamic(() => import('@borjie/spatial-engine/react'),
 * { ssr: false })` because MapLibre touches the DOM at module-load.
 */

export { ParcelMap } from './components/ParcelMap.js';
export type { ParcelMapProps, ParcelClickEvent } from './components/ParcelMap.js';

export { ElementInspector } from './components/ElementInspector.js';
export type { ElementInspectorProps } from './components/ElementInspector.js';
