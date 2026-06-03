/**
 * Model-card renderer — public surface (LP-22b).
 *
 * Mitchell et al. 2019 model-card RENDERER. Complements (does not replace)
 * the existing model-card coverage auditor (`scripts/audit-model-card-
 * coverage.mjs`), which only checks card-file existence per jurisdiction.
 */

export {
  renderModelCard,
  renderModelCardFromUnknown,
  type RenderModelCardOptions,
} from './renderer.js';

export {
  modelCardRecordSchema,
  modelCardFeatureSchema,
  modelCardMetricSchema,
  modelCardFairnessSliceSchema,
  type ModelCardRecord,
  type ModelCardFeature,
  type ModelCardMetric,
  type ModelCardFairnessSlice,
  type RenderedModelCard,
} from './types.js';
