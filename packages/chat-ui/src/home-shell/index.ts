/**
 * home-shell barrel — full-screen Home tab for every Borjie portal + app.
 *
 * Wave 18W reference scaffold. Spec: Docs/DESIGN/HOME_DASHBOARD_STANDARD.md.
 *
 * Public API consumed by host apps:
 *   - HomeShell, HomeShellProps, HomeShellState
 *   - PersonaHeader, HomeComposer, HomeMessageList, HomeProactiveBanner
 *   - HistoryRail, HistoryItem
 *   - resolveAudience, defaultSurfaceForRole
 */

export { HomeShell } from './HomeShell.js';
export { PersonaHeader } from './PersonaHeader.js';
export type { PersonaHeaderProps } from './PersonaHeader.js';
export { HomeComposer } from './HomeComposer.js';
export type { HomeComposerProps } from './HomeComposer.js';
export { HomeMessageList } from './HomeMessageList.js';
export type { HomeMessageListProps } from './HomeMessageList.js';
export { HomeProactiveBanner } from './HomeProactiveBanner.js';
export type { HomeProactiveBannerProps } from './HomeProactiveBanner.js';
export { HistoryRail } from './history-rail/HistoryRail.js';
export type {
  HistoryRailProps,
  HistoryRailConversation,
} from './history-rail/HistoryRail.js';
export { HistoryItem } from './history-rail/HistoryItem.js';
export type { HistoryItemProps } from './history-rail/HistoryItem.js';
export {
  resolveAudience,
  defaultSurfaceForRole,
} from './resolve/audience-resolver.js';
export type { ResolveAudienceInput } from './resolve/audience-resolver.js';
export type {
  HomeShellProps,
  HomeShellState,
  HomeShellUserRole,
  HomeShellLanguage,
  HomeShellVariant,
  ChatMessage,
  ProactiveProposal,
  ResolvedAgent,
} from './types.js';
