/**
 * @borjie/mcp-server — public API.
 */

// Types
export type {
  McpServerConfig,
  McpAuthContext,
  McpScope,
  McpTier,
  TierDefinition,
  McpToolDefinition,
  McpSchemaProperty,
  McpToolSuccess,
  McpToolFailure,
  McpToolResult,
  McpToolHandler,
  McpStaticResource,
  McpTemplateResource,
  McpResourceCategory,
  McpResourceResolver,
  McpCostEntry,
  McpCostSnapshot,
  CostLedgerPort,
  AuthPort,
  AuthRequestLike,
  AuthFailure,
  RunSkillInput,
  RunSkillResult,
} from './types.js';

// Auth
export {
  createMcpAuth,
  assertScopes,
  McpAuthError,
  hashApiKey,
  generateApiKey,
  type ApiKeyRecord,
  type ApiKeyRegistry,
  type JwtClaims,
  type JwtVerifier,
  type McpAuthDeps,
} from './mcp-auth.js';

// Tier router
export {
  createTierRouter,
  DEFAULT_TIER_DEFINITIONS,
  type TierRouter,
  type TierRouterConfig,
  type TierDecision,
} from './tier-router.js';

// Cost persistence
export {
  createCostBatcher,
  createInMemoryCostLedger,
  type CostBatcher,
  type CostBatcherConfig,
} from './cost-persistence.js';

// Resources
export {
  BORJIE_STATIC_RESOURCES,
  BORJIE_RESOURCE_TEMPLATES,
  resolveStaticResource,
  resolveTemplateResource,
  type ResourceResolvers,
} from './mcp-resources.js';

// Tool registry
export { BORJIE_TOOLS, findToolDefinition } from './tool-registry.js';

// Universal tool adapter
export {
  wrapToolHandler,
  createRunSkillHandler,
  type AdapterDeps,
  type WrappedToolInvocation,
} from './universal-tool-adapter.js';

// Server
export {
  createBorjieMcpServer,
  attachToMcpSdkServer,
  type BorjieMcpServer,
  type BorjieMcpDeps,
  type HandlerMap,
  type McpSdkServerLike,
  type McpSdkToolResponse,
  type McpSdkResourceResponse,
  type McpSdkPromptResponse,
} from './borjie-mcp-server.js';

// Prompts — MCP `prompts/list` + `prompts/get` capability
export {
  BORJIE_PROMPTS,
  CANONICAL_PROMPT_NAMES,
  findPromptDefinition,
  getPrompt,
  listPrompts,
  type McpPromptArgument,
  type McpPromptDefinition,
  type McpPromptGetResult,
  type McpPromptListEntry,
  type McpPromptListResult,
  type McpPromptMessage,
  type McpPromptOutcome,
  type McpPromptRole,
} from './prompts.js';
