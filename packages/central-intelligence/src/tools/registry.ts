/**
 * In-memory tool registry.
 *
 * Tools are added with a scope whitelist. The registry refuses to
 * return a tool to a caller whose ScopeContext.kind isn't in the
 * tool's `scopes` array — the first line of tenant-isolation defence
 * for tool use (the tools themselves enforce the second line via
 * their own auth checks against the ctx).
 *
 * Tools are grouped into families downstream for the LLM's system
 * prompt (graph-* / forecast-* / audit-* / docs-*) so the model
 * sees a coherent menu.
 */

import type { ScopeContext, Tool, ToolRegistry } from '../types.js';

export function createToolRegistry(
  tools: ReadonlyArray<Tool> = [],
): ToolRegistry & {
  register(tool: Tool): void;
  readonly size: number;
} {
  const byName = new Map<string, Tool>();
  for (const t of tools) {
    if (byName.has(t.name)) {
      throw new Error(`tool-registry: duplicate tool name '${t.name}'`);
    }
    byName.set(t.name, t);
  }

  return {
    register(tool: Tool): void {
      if (byName.has(tool.name)) {
        throw new Error(`tool-registry: duplicate tool name '${tool.name}'`);
      }
      byName.set(tool.name, tool);
    },
    list(ctx: ScopeContext): ReadonlyArray<Tool> {
      const out: Tool[] = [];
      for (const tool of byName.values()) {
        if (tool.scopes.includes(ctx.kind)) out.push(tool);
      }
      return Object.freeze(out);
    },
    get(toolName: string, ctx: ScopeContext): Tool | null {
      const tool = byName.get(toolName);
      if (!tool) return null;
      if (!tool.scopes.includes(ctx.kind)) return null;
      return tool;
    },
    get size(): number {
      return byName.size;
    },
  };
}
