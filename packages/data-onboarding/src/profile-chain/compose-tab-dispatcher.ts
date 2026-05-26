/**
 * Stage 6.c — compose_tab_v1 dispatcher.
 *
 * Emits the canonical handoff envelope for the Wave 18B dynamic-ui
 * package. As with the Tier-2 gate, this module does not import the
 * UI package directly to keep scaffold-time deps minimal — the
 * runtime composition root binds the actual dispatcher.
 */

import type { SuggestedTabLayout } from '../types.js';

export interface ComposeTabHandoff {
  readonly recipe_id: 'compose_tab_v1';
  readonly tab_recipe_id: string;
  readonly list_view_fields: ReadonlyArray<string>;
  readonly detail_view_groups: SuggestedTabLayout['detail_view_groups'];
  readonly drill_through_targets: SuggestedTabLayout['drill_through_targets'];
  readonly authority_tier: 1;
}

export interface ComposeTabDispatcher {
  dispatch(handoff: ComposeTabHandoff): Promise<{ tab_proposal_id: string }>;
}

export function buildComposeTabHandoff(
  layout: SuggestedTabLayout,
): ComposeTabHandoff {
  return Object.freeze({
    recipe_id: 'compose_tab_v1' as const,
    tab_recipe_id: layout.tab_recipe_id,
    list_view_fields: layout.list_view_fields,
    detail_view_groups: layout.detail_view_groups,
    drill_through_targets: layout.drill_through_targets,
    authority_tier: 1 as const,
  });
}

export function createInMemoryComposeTabDispatcher(): ComposeTabDispatcher {
  let counter = 0;
  return Object.freeze({
    async dispatch(_handoff: ComposeTabHandoff) {
      counter += 1;
      return Object.freeze({ tab_proposal_id: `mock_tab_${counter}` });
    },
  });
}
