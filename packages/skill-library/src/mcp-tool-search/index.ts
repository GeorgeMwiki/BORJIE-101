/**
 * @borjie/skill-library/mcp-tool-search — public API.
 *
 * R1 #9 closure: MCP ToolSearch primitive for deferred MCP tool-schema
 * loading. Targets the 50+ tool-per-server cliff documented in R1 §B.3.
 */

export type {
  McpToolDescriptor,
  ToolSearchCandidate,
  ToolSearchQuery,
  ToolSearchResult,
} from './types.js';

export { DEFAULT_DEFER_THRESHOLD } from './types.js';
export { rankCandidates, extractMinimalSchema, tokenize } from './ranking.js';
export {
  McpToolRegistry,
  type McpToolRegistryOptions,
  type ServerToolSet,
  type ContextProjection,
} from './registry.js';
