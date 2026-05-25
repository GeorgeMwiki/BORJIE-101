/**
 * Skills — progressive-disclosure capability modules loaded per persona.
 *
 * A "skill" is a narrowly-scoped ToolHandler that performs a specific
 * domain operation (reconcile M-Pesa, draft a KRA summary, extract a lease,
 * etc.). Personas declare which skills they can call via `allowedTools`.
 *
 * This module is the entrypoint for registering the default skill bundle on
 * the ToolDispatcher.
 */

export * from './kenya/index.js';
export * from './domain/index.js';
export * from './graph/index.js';
export * from './estate/index.js';
export * from './admin/index.js';
export * from './org/index.js';

import { KENYA_SKILL_TOOLS } from './kenya/index.js';
import { DOMAIN_SKILL_TOOLS } from './domain/index.js';
import { ESTATE_SKILL_TOOLS } from './estate/index.js';
import { ADMIN_SKILL_TOOLS } from './admin/index.js';
import {
  buildGraphToolHandlers,
  GraphToolkitLike,
} from './graph/index.js';
import { ToolDispatcher } from '../orchestrator/tool-dispatcher.js';

/**
 * Register all default skills on a ToolDispatcher.
 *
 * If a graph toolkit is provided, the 9 graph tools are also registered.
 * Estate skills (valuation, scoring, forecasting) are registered by default.
 * Admin skills (write-through-chat) are registered by default.
 */
export function registerDefaultSkills(
  dispatcher: ToolDispatcher,
  opts: { graphToolkit?: GraphToolkitLike } = {}
): void {
  for (const tool of KENYA_SKILL_TOOLS) dispatcher.register(tool);
  for (const tool of DOMAIN_SKILL_TOOLS) dispatcher.register(tool);
  for (const tool of ESTATE_SKILL_TOOLS) dispatcher.register(tool);
  for (const tool of ADMIN_SKILL_TOOLS) dispatcher.register(tool);
  if (opts.graphToolkit) {
    for (const tool of buildGraphToolHandlers(opts.graphToolkit)) {
      dispatcher.register(tool);
    }
  }
}
