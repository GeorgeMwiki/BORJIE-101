/**
 * Client-only barrel — re-exports the three React components.
 *
 * Consumers that don't need React (e.g. the Node server) import
 * `@borjie/geo-platform` (the root barrel) and never pull
 * `maplibre-gl` / `react` into their bundle.
 */

export { LiveMap, type LiveMapProps } from './components/LiveMap.js';
export {
  ParcelPaintingPanel,
  type ParcelPaintingPanelProps,
  type ParcelElement,
  type ElementKind,
} from './components/ParcelPaintingPanel.js';
export {
  GeofenceDesigner,
  type GeofenceDesignerProps,
} from './components/GeofenceDesigner.js';
