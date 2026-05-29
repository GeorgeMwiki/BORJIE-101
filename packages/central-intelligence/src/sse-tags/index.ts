/**
 * Brain SSE tag protocol — public surface.
 *
 * Today this module exports the tab CRUD tags. Future additions will
 * sit next to them (e.g. `<tab_focus>`, `<tab_pin>`).
 */

export {
  extractTabTags,
  isTabProposal,
  isTabRemove,
  isTabSpawn,
  isTabUpdate,
  pickProposalReason,
  pickTagTitle,
  tabProposalSchema,
  tabRemoveSchema,
  tabSpawnSchema,
  tabTagSchema,
  tabTagsTypeSchema,
  tabUpdateSchema,
  type ExtractTabTagsResult,
  type TabProposalTag,
  type TabRemoveTag,
  type TabSpawnTag,
  type TabTag,
  type TabUpdateTag,
} from './tab-tags.js';
