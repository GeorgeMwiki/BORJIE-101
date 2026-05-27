/**
 * Dagre layout preset — directed acyclic graphs, top-to-bottom.
 *
 * Best for medium DAGs (~100-2000 nodes) such as supply-chain flows
 * and royalty cascades. Cytoscape adapter:
 * https://github.com/cytoscape/cytoscape.js-dagre (2025-08 release).
 */

import type { Layout } from '../types';

export const DAGRE_LAYOUT: Layout = {
  name: 'dagre',
  animate: false,
  options: {
    rankDir: 'TB',
    nodeSep: 56,
    rankSep: 72,
    edgeSep: 18,
    padding: 24,
    spacingFactor: 1.1,
    nodeDimensionsIncludeLabels: true,
  },
} as const;
