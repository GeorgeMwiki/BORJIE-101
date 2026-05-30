/**
 * Workforce-mobile user superpowers — v1 mobile-adapted port of the
 * eight web superpowers (SuperpowerChips) the owner-web already ships.
 *
 * The eight superpowers, adapted to touch-first UX:
 *
 *  1. navigate    — long-press on any card surfaces a "go to X" menu
 *                   (FAB also exposes a quick-navigate sheet).
 *  2. prefill     — forms subscribe via {@link useSuperpowerPrefill}.
 *  3. highlight   — pulse animation hook ({@link useSuperpowerHighlight}).
 *  4. share       — React-Native `Share` sheet + deep-link generator
 *                   ({@link shareEntity}).
 *  5. bulk        — list multi-select chip mount + batch action sheet
 *                   ({@link useBulkSelection} + <BulkActionMount>).
 *  6. undo        — toast queue with a single-tap "Undo" button
 *                   ({@link enqueueUndoToast}, 24h server-side window).
 *  7. search-FAB  — pull-down universal search ({@link SearchFab}).
 *  8. bookmark    — long-press / pin gesture on lists
 *                   ({@link useBookmarkGesture}).
 *
 * Persona: workforce-mobile is worker-scoped → bulk + bookmark are
 * limited to the worker's own tasks (server-side enforcement). The
 * shape mirrors the action-runtime + agent-platform contracts so any
 * future shared `@borjie/superpowers-mobile` package can drop these in
 * verbatim.
 */
export * from './bus'
export * from './navigate'
export * from './prefill'
export * from './highlight'
export * from './share'
export * from './bulk'
export * from './undo'
export * from './search'
export * from './bookmark'
export { SuperpowersBootstrap } from './SuperpowersBootstrap'
