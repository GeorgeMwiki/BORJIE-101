/**
 * Stage 6.b — Tab-layout suggester.
 *
 * Thin helper that produces a `SuggestedTabLayout` from a chain graph,
 * delegating the actual `compose_tab_v1` invocation to the dispatcher
 * in `compose-tab-dispatcher.ts`. Kept separate so the layout heuristic
 * can evolve independently of the dispatcher contract.
 */

import type { ProfileChainGraph, SuggestedTabLayout } from '../types.js';

export function extractTabLayout(
  graph: ProfileChainGraph,
): SuggestedTabLayout {
  return graph.suggested_tab_layout;
}
