/**
 * Segmentation barrel.
 */

export {
  sampleScale,
  sampleCategorical,
  normalizeToScale,
} from './color-scales.js';

export {
  createSegmentationView,
  buildHeatmap,
  buildClusters,
  type CreateSegmentationViewArgs,
  type HeatmapCell,
  type ClusterPoint,
  type ClusterArgs,
} from './segmentation-view.js';
