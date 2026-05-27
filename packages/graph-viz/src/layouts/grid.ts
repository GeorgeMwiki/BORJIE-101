/**
 * Cytoscape grid layout preset — deterministic, no physics.
 *
 * Used for tests and snapshots where a stable layout matters more
 * than visual clustering. See https://js.cytoscape.org/#layouts/grid.
 */

import type { Layout } from '../types';

export const GRID_LAYOUT: Layout = {
  name: 'grid',
  animate: false,
  options: {
    padding: 16,
    avoidOverlap: true,
    avoidOverlapPadding: 12,
    nodeDimensionsIncludeLabels: true,
    spacingFactor: 1.1,
  },
} as const;
