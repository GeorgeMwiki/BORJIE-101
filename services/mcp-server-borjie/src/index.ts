/**
 * @borjie/mcp-server-borjie — public entry point.
 */

export type {
  BorjieScope,
  BorjieMcpAuthContext,
  BorjieMcpToolDescriptor,
  BorjieMcpJsonSchema,
  BorjieMcpJsonProperty,
  BorjieMcpResource,
  BorjieMcpResourceContent,
  BorjieMcpPrompt,
  BorjieMcpPromptArgument,
  BorjieMcpPromptMessage,
  BorjieMcpToolSuccess,
  BorjieMcpToolFailure,
  BorjieMcpToolResult,
  BorjieMcpToolContentBlock,
  BorjieMcpProvenance,
} from './types.js';

export {
  BORJIE_SCOPES,
} from './types.js';

export {
  BORJIE_SCOPE_CATALOG,
  grantableScopesForOwner,
  hasRequiredScopes,
  type BorjieScopeDescriptor,
} from './scopes.js';

export {
  BORJIE_PUBLIC_MCP_TOOLS,
  findPublicTool,
} from './tool-catalog.js';

export {
  BORJIE_PUBLIC_MCP_RESOURCES,
  findResource,
} from './resources.js';

export {
  BORJIE_PUBLIC_MCP_PROMPTS,
  findPrompt,
  renderPrompt,
} from './prompts.js';

export {
  TOOL_ROUTE_MAP,
  substitutePath,
  shapeRequest,
  type ToolRoute,
  type ShapedRequest,
} from './tool-router.js';

export {
  createGatewayClient,
  buildGatewayUrl,
  GatewayError,
  type GatewayClient,
  type GatewayClientConfig,
  type GatewayCallInput,
} from './gateway-client.js';

export {
  createDispatcher,
  type DispatcherDeps,
  type DispatcherInput,
} from './dispatcher.js';

export {
  createHttpHandler,
  type HttpHandlerDeps,
  type HttpRequestLike,
  type HttpResponseLike,
} from './transports/http.js';

export { runStdio, type StdioOptions } from './transports/stdio.js';

export {
  buildManifest,
  type BorjieMcpManifest,
  type ManifestOptions,
} from './manifest.js';

export {
  isJsonRpcRequest,
  parseJsonRpcLine,
  buildSuccess,
  buildError,
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_UNAUTHORIZED,
  JSON_RPC_FORBIDDEN,
  JSON_RPC_KILL_SWITCH_OPEN,
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcSuccess,
  type JsonRpcError,
} from './jsonrpc.js';
