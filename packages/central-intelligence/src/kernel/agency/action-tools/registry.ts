/**
 * Agency — in-process action-tool registry.
 *
 * Tiny mutable map keyed by tool name. Re-registering the same name
 * overwrites — composition roots call `register(...)` once at boot,
 * tests can swap definitions between runs.
 */
import type { ActionToolDef, ActionToolRegistry } from './types.js';

export function createActionToolRegistry(): ActionToolRegistry {
  const map = new Map<string, ActionToolDef>();
  return {
    register(tool) {
      map.set(tool.name, tool as ActionToolDef);
    },
    list() {
      return [...map.values()];
    },
    get(name) {
      return map.get(name) ?? null;
    },
  };
}
