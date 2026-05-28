export * from './chat-modes';
export * from './generative-ui';
export * from './blackboard';
export * from './hooks';
export * from './widget';
export * from './voice';
export * from './shared';
// Shared brain-degraded UI marker — consumed by customer-app/brain-degraded.ts.
export { DegradedBanner } from './components/DegradedBanner';
export type { DegradedBannerProps, DegradedMarker } from './components/DegradedBanner';
// Wave-3 INT-4 — Proactive UX surfaces for the MD-vision packages.
export { ProactiveHint } from './components/ProactiveHint';
export type {
  ProactiveHintProps,
  HintCandidate,
  HintTrigger,
  HintAction,
  HintStorage,
} from './components/ProactiveHint';
export { selectHint, matchesThreshold, readDismissed } from './components/ProactiveHint';
// ChatArtifactStream + NeedSpawnBanner are surfaces consumed by the
// three frontends to render kernel-emitted artifacts + Piece O spawn
// proposals inline in the chat.
export { ChatArtifactStream } from './components/ChatArtifactStream';
export type {
  ChatArtifactStreamProps,
  ChatArtifact,
  ArtifactRenderer,
} from './components/ChatArtifactStream';
export { NeedSpawnBanner, sortProposals } from './components/NeedSpawnBanner';
export type {
  NeedSpawnBannerProps,
  TabSpawnProposal,
} from './components/NeedSpawnBanner';
// Progressive-disclosure mastery gate — UI shrinks for novices and
// expands as the user accrues actions. See lib/user-mastery/.
export { MasteryGate } from './components/MasteryGate';
export type { MasteryGateProps } from './components/MasteryGate';
export * from './lib/user-mastery/index.js';
// Learned-shortcuts panel — per-route ranked frequent actions. Reads
// from the `user_action_tracker` table owned by UI-3's migration in
// packages/database; chat-ui only consumes denormalised rows via a
// fetcher supplied by the consuming app.
export { LearnedShortcutsPanel } from './components/LearnedShortcutsPanel.js';
export { useLearnedShortcuts } from './hooks/useLearnedShortcuts.js';
export {
  rankActions,
  scoreAction,
  recencyWeight,
  confirmationRate,
} from './lib/learned-shortcuts/index.js';
export type {
  LearnedShortcut,
  LearnedShortcutsPanelProps,
  PinnedStorage,
  RankerOptions,
  ShortcutsCacheEntry,
  UseLearnedShortcutsOptions,
  UseLearnedShortcutsResult,
  UserActionTrackerRow,
} from './lib/learned-shortcuts/index.js';
export * as Dopamine from './dopamine/index.js';
// FloatingAskBorjie — bespoke Borjie-branded floating chat widget.
// Mounted by apps/marketing (public/anonymous variant), apps/owner-web,
// and apps/admin-web (authenticated variant). See `./borjie/` for the
// component, panel, mode selector, bubble, and SSE hook.
export * from './borjie/index.js';
// Canonical display identity — locked by founder directive. Every UI
// surface that renders the persona name/title must source from here so
// the string never drifts. See `./canonical-display.ts`.
export {
  MR_MWIKILA_CANONICAL_DISPLAY,
  type MrMwikilaCanonicalDisplay,
} from './canonical-display.js';
// Composer primitives — shared slash command + `@`-reference menus
// surfaced across every Borjie chat surface (marketing / owner-web /
// admin-web / workforce-mobile / buyer-mobile). The trigger-parser is
// pure; SlashMenu / AtMenu are renderer-only. See ./composer/index.ts.
export {
  parseTrigger,
  filterSlashCommands,
  filterEntities,
  applySelection,
  buildTriggerProbe,
  SlashMenu,
  AtMenu,
} from './composer/index.js';
export type {
  TriggerKind,
  TriggerState,
  SlashCommand,
  EntityReference,
  ComposerSelection,
  SlashMenuProps,
  AtMenuProps,
  MenuItemLabel,
} from './composer/index.js';
