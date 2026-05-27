/**
 * `@borjie/blackboard-viz` — public barrel.
 *
 * Re-exports the public surface of the four blackboard views, every
 * sub-component, the OKLCH theme, the a11y primitives, and the GenUI
 * block dispatcher. Anything not exported here is considered internal
 * and may change between minor versions.
 *
 * Spec: `Docs/DESIGN/BLACKBOARD_VIZ_SOTA_2026.md`.
 */

// Types — engine-agnostic core
export type {
  KnowledgeState,
  RegionStatus,
  BlackboardAuthor,
  BlackboardPost,
  BlackboardViewMode,
  BlackboardMode,
  EntityRef,
  LiveCursorState,
  BlackboardFilter,
  BlackboardEntityClickEventDetail,
  BlackboardMutationAuthority,
  ViewProps,
  BlackboardVizBlockPayload,
} from './types';

export {
  KNOWLEDGE_STATES,
  REGION_STATUSES,
  BLACKBOARD_VIEW_MODES,
  BlackboardPostSchema,
  BlackboardVizBlockSchema,
  EMPTY_FILTER,
} from './types';

// Theme
export {
  BLACKBOARD_OKLCH_THEME,
  tokenForKind,
  tokenForStatus,
  tokenForCursor,
  isValidThemeColor,
  type OklchToken,
  type BlackboardOklchTheme,
} from './themes/blackboard-oklch';

// Views
export { TimelineView } from './views/TimelineView';
export { ThreadedView } from './views/ThreadedView';
export { KanbanView } from './views/KanbanView';
export { TreeGraphView } from './views/TreeGraphView';

// Sub-components
export { PostCard, type PostCardProps } from './components/PostCard';
export { EntityLink, type EntityLinkProps } from './components/EntityLink';
export { LiveCursors, type LiveCursorsProps } from './components/LiveCursors';
export {
  SearchBar,
  applyFilter,
  type SearchBarProps,
} from './components/SearchBar';
export {
  Permalink,
  scrollToPost,
  readPostQueryParam,
  type PermalinkProps,
} from './components/Permalink';
export { parseEntities, type EntityToken } from './components/entity-parser';

// Accessibility primitives
export { announce } from './a11y/announcer';
export {
  mapKeyboardEvent,
  applyNav,
  type BlackboardKeyAction,
} from './a11y/keyboard-nav';

// GenUI block dispatcher
export {
  BlackboardVizBlock,
  pickViewForPayload,
  type BlackboardVizBlockProps,
} from './genui-block/blackboard-viz-block';
