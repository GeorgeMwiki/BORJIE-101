/**
 * Cytoscape CoSE (Compound Spring Embedder) layout preset.
 *
 * Best general-purpose force-directed for small/medium graphs
 * (<= ~1000 nodes). See https://js.cytoscape.org/#layouts/cose
 * (Cytoscape.js 3.x, 2025).
 */

import type { Layout } from '../types';

export const COSE_LAYOUT: Layout = {
  name: 'cose',
  animate: true,
  options: {
    idealEdgeLength: 110,
    nodeRepulsion: 8_000,
    nodeOverlap: 24,
    gravity: 0.25,
    numIter: 1_500,
    initialTemp: 1_000,
    coolingFactor: 0.95,
    minTemp: 1.0,
    randomize: false,
    padding: 24,
  },
} as const;
