/**
 * Graph tool adapters — wrap `@borjie/graph-sync`'s GraphAgentToolkit
 * (9 tools) as Brain `ToolHandler`s so the Orchestrator's ToolDispatcher can
 * route persona tool calls to them.
 *
 * Decoupling note: we do NOT import from `@borjie/graph-sync` here
 * (avoids build-time circular / optional-peer coupling). Instead, this
 * module exposes a factory that accepts an opaque "toolkit-like" object
 * satisfying the minimal interface we need. Hosts pass the real toolkit in.
 */

import { ToolHandler } from '../../orchestrator/tool-dispatcher.js';

/**
 * Minimal subset of GraphAgentToolkit the Brain needs. Kept in sync with
 * `packages/graph-sync/src/queries/graph-agent-toolkit.ts`.
 */
export interface GraphToolkitLike {
  getOpenAITools(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  executeTool(
    toolName: string,
    params: Record<string, unknown>,
    auth: {
      tenantId: string;
      userId: string;
      role: string;
      propertyAccess: string[] | ['*'];
    }
  ): Promise<{
    toolName: string;
    success: boolean;
    data: unknown;
    evidenceSummary: string;
    executionTimeMs: number;
    error?: string;
  }>;
}

/**
 * Build Brain ToolHandlers from a GraphAgentToolkit-like instance.
 */
export function buildGraphToolHandlers(
  toolkit: GraphToolkitLike,
  opts: { defaultPropertyAccess?: string[] | ['*'] } = {}
): ToolHandler[] {
  const access = opts.defaultPropertyAccess ?? ['*'];
  return toolkit.getOpenAITools().map((def) => ({
    name: def.function.name,
    description: def.function.description,
    parameters: def.function.parameters,
    async execute(params, context) {
      const result = await toolkit.executeTool(def.function.name, params, {
        tenantId: context.tenant.tenantId,
        userId: context.actor.id,
        role: context.actor.roles?.[0] ?? 'user',
        propertyAccess: access,
      });
      return {
        ok: result.success,
        data: result.data,
        evidenceSummary: result.evidenceSummary,
        ...(result.error !== undefined ? { error: result.error } : {}),
      };
    },
  }));
}
