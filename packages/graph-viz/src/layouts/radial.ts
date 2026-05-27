/**
 * Cytoscape concentric (radial) layout preset.
 *
 * Hubs-and-spokes — e.g. one big mining company with many subsidiaries.
 * See https://js.cytoscape.org/#layouts/concentric (Cytoscape.js 3.x).
 */

import type { Layout } from '../types';

export const RADIAL_LAYOUT: Layout = {
  name: 'radial',
  animate: false,
  options: {
    minNodeSpacing: 18,
    padding: 24,
    startAngle: -Math.PI / 2,
    sweep: 2 * Math.PI,
    clockwise: true,
    equidistant: true,
    avoidOverlap: true,
    spacingFactor: 1.2,
    nodeDimensionsIncludeLabels: true,
  },
} as const;
