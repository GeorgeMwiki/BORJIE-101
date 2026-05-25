/**
 * Learned-Shortcuts library — barrel export.
 *
 * Consumers should import from `@borjie/chat-ui` (which re-exports
 * this module) rather than reaching into the lib subpath directly.
 * The barrel mirrors the structure of `lib/user-mastery` (UI-3) so the
 * two adjacent learning modules stay symmetric.
 */
export {
  rankActions,
  scoreAction,
  recencyWeight,
  confirmationRate,
} from './ranker.js';
export type {
  LearnedShortcut,
  LearnedShortcutsPanelProps,
  PinnedStorage,
  RankerOptions,
  ShortcutsCacheEntry,
  UseLearnedShortcutsOptions,
  UseLearnedShortcutsResult,
  UserActionTrackerRow,
} from './types.js';
