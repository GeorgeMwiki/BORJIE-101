/**
 * Cytoscape breadthfirst layout preset.
 *
 * Tree-like graphs (licence hierarchies, supply-chain DAGs).
 * See https://js.cytoscape.org/#layouts/breadthfirst (Cytoscape.js 3.x, 2025).
 */

import type { Layout } from '../types';

export const BREADTHFIRST_LAYOUT: Layout = {
  name: 'breadthfirst',
  animate: false,
  options: {
    directed: true,
    padding: 24,
    spacingFactor: 1.25,
    avoidOverlap: true,
    nodeDimensionsIncludeLabels: true,
    grid: true,
  },
} as const;
