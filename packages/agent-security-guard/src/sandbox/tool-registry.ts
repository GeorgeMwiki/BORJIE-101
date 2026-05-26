/**
 * Tool registry shape used by the sandbox validator.
 *
 * In production composition the registry is sourced from
 * `capability-catalogue`. For SEC-4's purposes we only need the
 * authority tier + zod argument schema per tool. Importing concrete
 * tools here would create a circular dependency, so we accept a port.
 */
import type { ZodTypeAny } from 'zod';
import type { AuthorityTier } from '../types.js';

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly requiredTier: AuthorityTier;
  /** Zod schema validating the tool's arguments object. */
  readonly argsSchema: ZodTypeAny;
  /** If true, T2 tools require explicit `confirmed=true` arg from runtime. */
  readonly requiresConfirmation: boolean;
}

export interface ToolRegistry {
  readonly get: (name: string) => ToolDefinition | undefined;
  readonly has: (name: string) => boolean;
  readonly list: () => ReadonlyArray<ToolDefinition>;
}

/**
 * In-memory registry — useful for tests and bootstrap configurations.
 */
export function createInMemoryToolRegistry(
  tools: ReadonlyArray<ToolDefinition>,
): ToolRegistry {
  const map = new Map<string, ToolDefinition>();
  for (const t of tools) map.set(t.name, t);
  return Object.freeze({
    get: (name: string) => map.get(name),
    has: (name: string) => map.has(name),
    list: () => Object.freeze([...map.values()]),
  });
}
