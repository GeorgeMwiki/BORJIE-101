/**
 * Org skills bundle — "talk to your organization" tools for Mr. Mwikila.
 *
 * Registered by the app composition root via
 * `registerOrgSkills(dispatcher, service)` — kept out of
 * `registerDefaultSkills` because the service must be wired at boot.
 */

import type { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import type { ToolDispatcher } from '../../orchestrator/tool-dispatcher.js';
import {
  buildQueryOrganizationTool,
  type QueryOrganizationServiceLike,
} from './query-organization.js';

export * from './query-organization.js';

export function buildOrgSkillTools(
  service: QueryOrganizationServiceLike,
): readonly ToolHandler[] {
  return [buildQueryOrganizationTool(service)];
}

export function registerOrgSkills(
  dispatcher: ToolDispatcher,
  service: QueryOrganizationServiceLike,
): void {
  for (const tool of buildOrgSkillTools(service)) {
    dispatcher.register(tool);
  }
}
